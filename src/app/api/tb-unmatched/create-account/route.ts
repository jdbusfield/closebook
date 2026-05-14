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
  // Well-known bank-name fragments. These are specific enough that they
  // strongly imply a deposit account even when the QBO label doesn't include
  // the literal word "bank" / "checking" — e.g. "Chase BusCking (Legacy)"
  // collapses "Business Checking" into "BusCking" with no separator, so the
  // generic "checking" substring misses. Keep this list tight to avoid
  // false positives (e.g. don't add bare "operating" — it hits expenses).
  if (
    has(
      "chase",
      "wells fargo",
      "bank of america",
      "bofa",
      "citibank",
      "u.s. bank",
      "us bank",
      "pnc bank",
      "first republic",
      "jpmorgan",
      "jp morgan",
      "manufacturers bank",
      "buscking",
      "bus cking",
      "bus ckg",
      "buschecking"
    )
  ) {
    return { classification: "Asset", accountType: "Bank" };
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

  // Find sibling unresolved rows for the same logical QBO account across
  // other periods so we can back-fill the new mapping in one shot. Match by
  // qbo_account_id when present (most precise), otherwise fall back to the
  // qbo_account_name string — many "(deleted)" QBO accounts arrive without an
  // id and are only correlated by name.
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

  // Upsert gl_balances for the current row and every sibling
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

  // Mark every matched unmatched row (current + siblings) as resolved
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
    autoResolvedCount: siblings?.length ?? 0,
  });
}
