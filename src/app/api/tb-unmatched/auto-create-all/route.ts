import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/tb-unmatched/auto-create-all
//
// One-shot button: for every unresolved tb_unmatched_rows record on this
// entity, fetch the source account from QBO (using its qbo_account_id),
// create a local entity account using QBO's classification + account type,
// and back-fill gl_balances across every period that referenced the same
// QBO account. Rows whose QBO account no longer exists (or that lack a
// qbo_account_id) are skipped and left for manual resolution — the user
// still owns those edge cases via the per-row picker.

interface QboAccount {
  Id: string;
  Name: string;
  FullyQualifiedName?: string;
  AcctNum?: string;
  Classification: string;
  AccountType: string;
  AccountSubType?: string;
  Active?: boolean;
  CurrencyRef?: { value?: string };
  CurrentBalance?: number;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { entityId } = body as { entityId?: string };
  if (!entityId) {
    return NextResponse.json(
      { error: "entityId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Membership check
  const { data: entity } = await admin
    .from("entities")
    .select("id, organization_id")
    .eq("id", entityId)
    .single();
  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }
  const { data: membership } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", entity.organization_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load all unresolved unmatched rows for this entity.
  const { data: unresolved } = await admin
    .from("tb_unmatched_rows")
    .select("id, qbo_account_id, qbo_account_name, period_year, period_month, debit, credit")
    .eq("entity_id", entityId)
    .is("resolved_account_id", null);

  if (!unresolved || unresolved.length === 0) {
    return NextResponse.json({
      success: true,
      createdAccounts: 0,
      resolvedRows: 0,
      skipped: 0,
      message: "No unmatched rows to resolve",
    });
  }

  // Group rows by qbo_account_id. Rows missing a qbo_id can't be resolved
  // via QBO lookup and stay unresolved.
  type Group = {
    qboId: string;
    qboName: string;
    rows: typeof unresolved;
  };
  const groups = new Map<string, Group>();
  let missingIdCount = 0;

  for (const r of unresolved) {
    const qboId = r.qbo_account_id;
    if (!qboId) {
      missingIdCount++;
      continue;
    }
    const existing = groups.get(qboId);
    if (existing) {
      existing.rows.push(r);
    } else {
      groups.set(qboId, {
        qboId,
        qboName: r.qbo_account_name,
        rows: [r],
      });
    }
  }

  if (groups.size === 0) {
    return NextResponse.json({
      success: true,
      createdAccounts: 0,
      resolvedRows: 0,
      skipped: missingIdCount,
      message:
        "No unmatched rows carry a QBO account id — pick a master GL account manually",
    });
  }

  // Get the entity's QBO connection.
  const { data: conn } = await admin
    .from("qbo_connections")
    .select(
      "id, access_token, refresh_token, access_token_expires_at, realm_id"
    )
    .eq("entity_id", entityId)
    .single();
  if (!conn) {
    return NextResponse.json(
      { error: "No QuickBooks connection for this entity" },
      { status: 400 }
    );
  }

  const accessToken = await refreshTokenIfNeeded(conn, admin);
  const apiBaseUrl = "https://quickbooks.api.intuit.com";

  // QBO query: SELECT * FROM Account WHERE Id IN ('1','2',...). Batch in
  // chunks to keep URLs short — 50 ids per query is well under any limit.
  const qboAccountsById = new Map<string, QboAccount>();
  const idList = Array.from(groups.keys());
  const CHUNK = 50;

  for (let i = 0; i < idList.length; i += CHUNK) {
    const chunk = idList.slice(i, i + CHUNK);
    const inClause = chunk.map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
    const query = `SELECT * FROM Account WHERE Id IN (${inClause})`;

    const resp = await fetch(
      `${apiBaseUrl}/v3/company/${conn.realm_id}/query?query=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );
    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json(
        { error: `QBO query failed (HTTP ${resp.status}): ${text}` },
        { status: 502 }
      );
    }
    const json = await resp.json();
    const accounts: QboAccount[] = json.QueryResponse?.Account ?? [];
    for (const a of accounts) {
      qboAccountsById.set(String(a.Id), a);
    }
  }

  // For each group, either reuse an existing local account (matched by
  // qbo_id) or create one, then back-fill gl_balances and mark rows resolved.
  let createdAccounts = 0;
  let reusedAccounts = 0;
  let resolvedRows = 0;
  let notFoundInQbo = 0;
  const nowIso = new Date().toISOString();
  const errors: string[] = [];

  for (const group of groups.values()) {
    const qboAccount = qboAccountsById.get(group.qboId);

    let accountId: string | null = null;

    // Check if we already have a local account for this qbo_id (the source
    // of unmatched rows is usually that sync-accounts hasn't run lately, so
    // sometimes the account is already there and the match logic just missed).
    const { data: existing } = await admin
      .from("accounts")
      .select("id")
      .eq("entity_id", entityId)
      .eq("qbo_id", group.qboId)
      .maybeSingle();

    if (existing?.id) {
      accountId = existing.id;
      reusedAccounts++;
    } else if (qboAccount) {
      // Create from QBO data — full fidelity.
      const { data: created, error: createErr } = await admin
        .from("accounts")
        .insert({
          entity_id: entityId,
          qbo_id: group.qboId,
          account_number: qboAccount.AcctNum ?? null,
          name: qboAccount.Name,
          fully_qualified_name:
            qboAccount.FullyQualifiedName ?? qboAccount.Name,
          classification: qboAccount.Classification,
          account_type: qboAccount.AccountType,
          account_sub_type: qboAccount.AccountSubType ?? null,
          is_active: qboAccount.Active ?? true,
          currency: qboAccount.CurrencyRef?.value ?? "USD",
          current_balance: qboAccount.CurrentBalance ?? 0,
        })
        .select("id")
        .single();
      if (createErr || !created) {
        errors.push(
          `Failed to create "${group.qboName}" (id ${group.qboId}): ${createErr?.message ?? "unknown"}`
        );
        continue;
      }
      accountId = created.id;
      createdAccounts++;
    } else {
      notFoundInQbo++;
      continue;
    }

    // Upsert balances for every period this group covers.
    const balanceRows = group.rows.map((r) => {
      const d = Number(r.debit ?? 0);
      const c = Number(r.credit ?? 0);
      return {
        entity_id: entityId,
        account_id: accountId!,
        period_year: r.period_year,
        period_month: r.period_month,
        debit_total: d,
        credit_total: c,
        ending_balance: d - c,
        net_change: d - c,
        synced_at: nowIso,
      };
    });
    const { error: balErr } = await admin
      .from("gl_balances")
      .upsert(balanceRows, {
        onConflict: "entity_id,account_id,period_year,period_month",
      });
    if (balErr) {
      errors.push(
        `Failed to post balances for "${group.qboName}": ${balErr.message}`
      );
      continue;
    }

    await admin
      .from("tb_unmatched_rows")
      .update({
        resolved_account_id: accountId,
        resolved_at: nowIso,
        resolved_by: user.id,
      })
      .in(
        "id",
        group.rows.map((r) => r.id)
      );

    resolvedRows += group.rows.length;
  }

  return NextResponse.json({
    success: true,
    createdAccounts,
    reusedAccounts,
    resolvedRows,
    notFoundInQbo,
    missingId: missingIdCount,
    skipped: notFoundInQbo + missingIdCount,
    errors: errors.length > 0 ? errors : undefined,
  });
}

async function refreshTokenIfNeeded(
  connection: {
    id: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at: string;
  },
  admin: ReturnType<typeof createAdminClient>
) {
  const expiresAt = new Date(connection.access_token_expires_at);
  const now = new Date();
  const buffer = 5 * 60 * 1000;
  if (expiresAt.getTime() - now.getTime() > buffer) {
    return connection.access_token;
  }
  const clientId = process.env.QBO_CLIENT_ID!;
  const clientSecret = process.env.QBO_CLIENT_SECRET!;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(
    "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
      }),
    }
  );
  if (!response.ok) {
    throw new Error("QBO token refresh failed");
  }
  const tokens = await response.json();
  const newExpiry = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString();
  await admin
    .from("qbo_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: newExpiry,
    })
    .eq("id", connection.id);
  return tokens.access_token as string;
}
