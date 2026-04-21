import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Resolve an unmatched QBO trial balance row by CREATING a new account in
// the entity's chart of accounts (rather than mapping to an existing one).
// Also writes the GL balance for the period so the trial balance ties.

const VALID_CLASSIFICATIONS = new Set([
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
]);

// Heuristic classification from account name. Order matters — "Deferred
// Revenue" must resolve to Liability before "Revenue" matches.
function inferClassification(nameRaw: string): {
  classification: string;
  accountType: string;
} {
  const n = nameRaw.toLowerCase();
  const has = (...terms: string[]) => terms.some((t) => n.includes(t));

  if (has("accumulated depreciation", "accum depr", "accum. depr")) {
    return { classification: "Asset", accountType: "Fixed Asset" };
  }
  if (has("accounts payable", "a/p", "ap ")) {
    return { classification: "Liability", accountType: "Accounts Payable" };
  }
  if (has("accounts receivable", "a/r", "ar ")) {
    return { classification: "Asset", accountType: "Accounts Receivable" };
  }
  if (has("deferred revenue", "deferred income", "unearned")) {
    return { classification: "Liability", accountType: "Other Current Liability" };
  }
  if (has("credit card")) {
    return { classification: "Liability", accountType: "Credit Card" };
  }
  if (
    has(
      "payable",
      "accrued",
      "loan",
      "note payable",
      "line of credit",
      "mortgage",
      "tax payable"
    )
  ) {
    return { classification: "Liability", accountType: "Other Current Liability" };
  }
  if (
    has(
      "equity",
      "capital",
      "retained earnings",
      "member",
      "partner",
      "shareholder",
      "distribution",
      "draw",
      "contribution"
    )
  ) {
    return { classification: "Equity", accountType: "Equity" };
  }
  if (
    has(
      "cash",
      "bank",
      "checking",
      "savings",
      "money market"
    )
  ) {
    return { classification: "Asset", accountType: "Bank" };
  }
  if (has("prepaid", "deposit")) {
    return { classification: "Asset", accountType: "Other Current Asset" };
  }
  if (has("inventory")) {
    return { classification: "Asset", accountType: "Other Current Asset" };
  }
  if (
    has(
      "fixed asset",
      "equipment",
      "vehicle",
      "furniture",
      "building",
      "land",
      "leasehold"
    )
  ) {
    return { classification: "Asset", accountType: "Fixed Asset" };
  }
  if (has("goodwill", "intangible")) {
    return { classification: "Asset", accountType: "Other Asset" };
  }
  if (has("revenue", "sales", "income")) {
    return { classification: "Revenue", accountType: "Income" };
  }
  if (has("cost of goods", "cogs", "cost of sales")) {
    return { classification: "Expense", accountType: "Cost of Goods Sold" };
  }
  // Default bucket
  return { classification: "Expense", accountType: "Expense" };
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
  const {
    unmatchedRowId,
    classification: suppliedClassification,
    accountType: suppliedAccountType,
    accountNumber,
    name: suppliedName,
  } = body as {
    unmatchedRowId?: string;
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
    // Match a leading number-like token: digits with optional `.` or `-`
    // separators (e.g. "10100", "10100.1", "10100-01"), followed by one of
    // `- : . ·` or whitespace, then the rest of the name.
    const m = rawName.match(/^(\d+(?:[.\-]\d+)*)\s*[-:·.]?\s+(.+)$/);
    if (m && m[2].trim().length > 0) {
      parsedNumber = m[1];
      name = m[2].trim();
    }
  }
  const resolvedAccountNumber =
    accountNumber !== undefined ? (accountNumber ?? null) : parsedNumber;

  // Resolve classification / account_type — either supplied by the caller or
  // inferred from the name.
  const inferred = inferClassification(name);
  const classification =
    suppliedClassification && VALID_CLASSIFICATIONS.has(suppliedClassification)
      ? suppliedClassification
      : inferred.classification;
  const accountType =
    suppliedAccountType && suppliedAccountType.trim().length > 0
      ? suppliedAccountType.trim()
      : inferred.accountType;

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
        // Preserve the original QBO-display string as fully_qualified_name
        // so existing match-by-name logic continues to work on re-sync.
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

  // Write the GL balance for the period
  const debit = Number(unmatchedRow.debit ?? 0);
  const credit = Number(unmatchedRow.credit ?? 0);
  await admin.from("gl_balances").upsert(
    {
      entity_id: unmatchedRow.entity_id,
      account_id: accountId,
      period_year: unmatchedRow.period_year,
      period_month: unmatchedRow.period_month,
      debit_total: debit,
      credit_total: credit,
      ending_balance: debit - credit,
      net_change: debit - credit,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "entity_id,account_id,period_year,period_month" }
  );

  // Mark the unmatched row as resolved
  await admin
    .from("tb_unmatched_rows")
    .update({
      resolved_account_id: accountId,
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
    })
    .eq("id", unmatchedRowId);

  return NextResponse.json({
    success: true,
    accountId,
    classification,
    accountType,
    name,
  });
}
