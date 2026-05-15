import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/accounts — create a new entity account on the trial balance.
//
// When `masterAccountId` is supplied we copy classification + account_type
// from that master and insert a master_account_mappings row in the same
// call. Otherwise the caller must supply explicit classification +
// accountType.
//
// After creating the account we look for any unresolved tb_unmatched_rows
// for the same entity whose qbo_account_name matches the new account's
// name (case-insensitive, trimmed) and resolve them in one shot — posting
// gl_balances for every matched period and marking the rows resolved.
// That gives the user a single "Create + back-fill" action.

const VALID_CLASSIFICATIONS = new Set([
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    entityId,
    name,
    accountNumber,
    masterAccountId,
    classification: suppliedClassification,
    accountType: suppliedAccountType,
  } = body as {
    entityId?: string;
    name?: string;
    accountNumber?: string | null;
    masterAccountId?: string;
    classification?: string;
    accountType?: string;
  };

  if (!entityId) {
    return NextResponse.json({ error: "entityId is required" }, { status: 400 });
  }
  const trimmedName = (name ?? "").trim();
  if (trimmedName.length === 0) {
    return NextResponse.json(
      { error: "Account name is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Look up the entity's organization and verify the caller is a member.
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

  // Resolve classification + account_type — either copy from the chosen
  // master account or take explicit input. No name-based inference.
  let classification: string;
  let accountType: string;
  let masterRow: { id: string; organization_id: string } | null = null;

  if (masterAccountId) {
    const { data: master, error: masterErr } = await admin
      .from("master_accounts")
      .select("id, organization_id, classification, account_type")
      .eq("id", masterAccountId)
      .single();
    if (masterErr || !master) {
      return NextResponse.json(
        { error: "Master account not found" },
        { status: 404 }
      );
    }
    if (master.organization_id !== entity.organization_id) {
      return NextResponse.json(
        { error: "Master account belongs to a different organization" },
        { status: 400 }
      );
    }
    classification = master.classification;
    accountType = (master.account_type ?? "").toString().trim() || "Other";
    masterRow = { id: master.id, organization_id: master.organization_id };
  } else {
    if (
      !suppliedClassification ||
      !VALID_CLASSIFICATIONS.has(suppliedClassification)
    ) {
      return NextResponse.json(
        {
          error:
            "Either pick a master GL account or provide classification (Asset, Liability, Equity, Revenue, or Expense)",
        },
        { status: 400 }
      );
    }
    if (!suppliedAccountType || suppliedAccountType.trim().length === 0) {
      return NextResponse.json(
        { error: "accountType is required when not using a master GL account" },
        { status: 400 }
      );
    }
    classification = suppliedClassification;
    accountType = suppliedAccountType.trim();
  }

  // Create the entity account.
  const trimmedAccountNumber =
    accountNumber != null && String(accountNumber).trim().length > 0
      ? String(accountNumber).trim()
      : null;

  const { data: created, error: createErr } = await admin
    .from("accounts")
    .insert({
      entity_id: entityId,
      account_number: trimmedAccountNumber,
      name: trimmedName,
      classification,
      account_type: accountType,
      is_active: true,
    })
    .select("id, account_number, name, classification, account_type")
    .single();
  if (createErr || !created) {
    return NextResponse.json(
      { error: createErr?.message ?? "Failed to create account" },
      { status: 500 }
    );
  }

  // Optionally insert the master mapping. Duplicate is a no-op.
  if (masterRow) {
    const { error: mappingErr } = await admin
      .from("master_account_mappings")
      .insert({
        master_account_id: masterRow.id,
        entity_id: entityId,
        account_id: created.id,
        created_by: user.id,
      });
    if (
      mappingErr &&
      (mappingErr as { code?: string }).code !== "23505"
    ) {
      return NextResponse.json(
        { error: mappingErr.message ?? "Failed to create master mapping" },
        { status: 500 }
      );
    }
  }

  // Find unresolved unmatched rows for this entity that match the new
  // account by name (case-insensitive). Resolve them all in one shot —
  // post gl_balances per period and flip resolved_account_id.
  const { data: candidateRows } = await admin
    .from("tb_unmatched_rows")
    .select("id, qbo_account_name, period_year, period_month, debit, credit")
    .eq("entity_id", entityId)
    .is("resolved_account_id", null);

  const matchKey = trimmedName.toLowerCase();
  const matches = (candidateRows ?? []).filter(
    (r) => (r.qbo_account_name ?? "").trim().toLowerCase() === matchKey
  );

  let autoResolvedCount = 0;
  if (matches.length > 0) {
    const nowIso = new Date().toISOString();
    const balanceRows = matches.map((r) => {
      const d = Number(r.debit ?? 0);
      const c = Number(r.credit ?? 0);
      return {
        entity_id: entityId,
        account_id: created.id,
        period_year: r.period_year,
        period_month: r.period_month,
        debit_total: d,
        credit_total: c,
        ending_balance: d - c,
        net_change: d - c,
        synced_at: nowIso,
      };
    });
    await admin.from("gl_balances").upsert(balanceRows, {
      onConflict: "entity_id,account_id,period_year,period_month",
    });
    await admin
      .from("tb_unmatched_rows")
      .update({
        resolved_account_id: created.id,
        resolved_at: nowIso,
        resolved_by: user.id,
      })
      .in(
        "id",
        matches.map((r) => r.id)
      );
    autoResolvedCount = matches.length;
  }

  return NextResponse.json({
    success: true,
    account: created,
    masterAccountId: masterRow?.id ?? null,
    autoResolvedCount,
  });
}
