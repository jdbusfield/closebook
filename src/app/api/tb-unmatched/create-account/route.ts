import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Resolve an unmatched QBO trial balance row by CREATING a new account in
// the entity's chart of accounts (rather than mapping to an existing one).
// Also writes the GL balance for the period so the trial balance ties.
//
// Classification + account_type come from the caller — no auto-classifier.
// Either pass `masterAccountId` (we copy classification + account_type from
// that master and also create the mapping in master_account_mappings) or
// pass explicit `classification` + `accountType`.

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
    unmatchedRowId,
    masterAccountId,
    classification: suppliedClassification,
    accountType: suppliedAccountType,
    accountNumber,
    name: suppliedName,
  } = body as {
    unmatchedRowId?: string;
    masterAccountId?: string;
    classification?: string;
    accountType?: string;
    accountNumber?: string | null;
    name?: string;
  };

  if (!unmatchedRowId) {
    return NextResponse.json(
      { error: "unmatchedRowId is required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: unmatchedRow, error: fetchError } = await admin
    .from("tb_unmatched_rows")
    .select("*")
    .eq("id", unmatchedRowId)
    .single();
  if (fetchError || !unmatchedRow) {
    return NextResponse.json(
      { error: "Unmatched row not found" },
      { status: 404 }
    );
  }
  if (unmatchedRow.resolved_account_id) {
    return NextResponse.json(
      { error: "This row has already been resolved" },
      { status: 400 }
    );
  }

  // Resolve classification + account_type either from a chosen master account
  // (preferred — also yields a mapping for free) or from explicit caller
  // input. No name-based inference fallback.
  let classification: string;
  let accountType: string;
  let masterAccountRow: { id: string; organization_id: string } | null = null;

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

    // Sanity-check that the chosen master belongs to the same org as the
    // entity owning the unmatched row.
    const { data: entityOrg } = await admin
      .from("entities")
      .select("organization_id")
      .eq("id", unmatchedRow.entity_id)
      .single();
    if (
      !entityOrg ||
      entityOrg.organization_id !== master.organization_id
    ) {
      return NextResponse.json(
        { error: "Master account belongs to a different organization" },
        { status: 400 }
      );
    }

    classification = master.classification;
    accountType = (master.account_type ?? "").toString().trim() || "Other";
    masterAccountRow = { id: master.id, organization_id: master.organization_id };
  } else {
    if (
      !suppliedClassification ||
      !VALID_CLASSIFICATIONS.has(suppliedClassification)
    ) {
      return NextResponse.json(
        {
          error:
            "Either pick a master GL account or provide a classification (Asset, Liability, Equity, Revenue, or Expense).",
        },
        { status: 400 }
      );
    }
    if (!suppliedAccountType || suppliedAccountType.trim().length === 0) {
      return NextResponse.json(
        { error: "accountType is required when not using a master GL account." },
        { status: 400 }
      );
    }
    classification = suppliedClassification;
    accountType = suppliedAccountType.trim();
  }

  const rawName = (suppliedName ?? unmatchedRow.qbo_account_name ?? "").trim();
  if (!rawName) {
    return NextResponse.json({ error: "Account name is required" }, { status: 400 });
  }

  // QBO trial balance reports collapse the account number into the name
  // field (e.g. "10100 Cash" or "10100 - Cash - Operating"). If the caller
  // didn't pass an explicit accountNumber, try to split a leading numeric
  // prefix off the name so the account_number column is populated correctly
  // and the remaining text is used as the display name.
  let parsedNumber: string | null = null;
  let name = rawName;
  if (accountNumber === undefined) {
    const m = rawName.match(/^(\d+(?:[.\-]\d+)*)\s*[-:·.]?\s+(.+)$/);
    if (m && m[2].trim().length > 0) {
      parsedNumber = m[1];
      name = m[2].trim();
    }
  }
  const resolvedAccountNumber =
    accountNumber !== undefined ? (accountNumber ?? null) : parsedNumber;

  // If an account with the same qbo_id already exists for this entity, reuse
  // it rather than creating a duplicate.
  let accountId: string | null = null;
  if (unmatchedRow.qbo_account_id) {
    const { data: existing } = await admin
      .from("accounts")
      .select("id")
      .eq("entity_id", unmatchedRow.entity_id)
      .eq("qbo_id", unmatchedRow.qbo_account_id)
      .maybeSingle();
    if (existing?.id) accountId = existing.id;
  }

  if (!accountId) {
    const { data: created, error: createErr } = await admin
      .from("accounts")
      .insert({
        entity_id: unmatchedRow.entity_id,
        qbo_id: unmatchedRow.qbo_account_id ?? null,
        account_number: resolvedAccountNumber,
        name,
        fully_qualified_name: rawName,
        classification,
        account_type: accountType,
        is_active: true,
      })
      .select("id")
      .single();
    if (createErr || !created) {
      return NextResponse.json(
        { error: createErr?.message ?? "Failed to create account" },
        { status: 500 }
      );
    }
    accountId = created.id;
  }

  // If the caller picked a master account, also create the mapping (or leave
  // it alone if one already exists).
  if (masterAccountRow) {
    const { error: mappingErr } = await admin
      .from("master_account_mappings")
      .insert({
        master_account_id: masterAccountRow.id,
        entity_id: unmatchedRow.entity_id,
        account_id: accountId,
        created_by: user.id,
      });
    // 23505 = unique-violation: the mapping already exists, which is fine.
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

  // Find sibling unresolved rows for the same logical QBO account across
  // other periods so we can back-fill the new mapping in one shot. Match by
  // qbo_account_id when present (most precise), otherwise fall back to the
  // qbo_account_name string.
  let siblingsQuery = admin
    .from("tb_unmatched_rows")
    .select("id, period_year, period_month, debit, credit")
    .eq("entity_id", unmatchedRow.entity_id)
    .is("resolved_account_id", null)
    .neq("id", unmatchedRowId);

  if (unmatchedRow.qbo_account_id) {
    siblingsQuery = siblingsQuery.eq(
      "qbo_account_id",
      unmatchedRow.qbo_account_id
    );
  } else {
    siblingsQuery = siblingsQuery
      .is("qbo_account_id", null)
      .eq("qbo_account_name", unmatchedRow.qbo_account_name);
  }

  const { data: siblings } = await siblingsQuery;
  const allRows = [unmatchedRow, ...(siblings ?? [])];
  const nowIso = new Date().toISOString();

  const balanceRows = allRows.map((r) => {
    const d = Number(r.debit ?? 0);
    const c = Number(r.credit ?? 0);
    return {
      entity_id: unmatchedRow.entity_id,
      account_id: accountId,
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
      resolved_account_id: accountId,
      resolved_at: nowIso,
      resolved_by: user.id,
    })
    .in(
      "id",
      allRows.map((r) => r.id)
    );

  return NextResponse.json({
    success: true,
    accountId,
    classification,
    accountType,
    name,
    masterAccountId: masterAccountRow?.id ?? null,
    autoResolvedCount: siblings?.length ?? 0,
  });
}
