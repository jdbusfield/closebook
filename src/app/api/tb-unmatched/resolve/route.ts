import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { unmatchedRowId, accountId } = body;

  if (!unmatchedRowId || !accountId) {
    return NextResponse.json(
      { error: "unmatchedRowId and accountId are required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  // 1. Fetch the unmatched row
  const { data: unmatchedRow, error: fetchError } = await adminClient
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

  // 2. Verify the target account exists and belongs to the same entity
  const { data: targetAccount, error: acctError } = await adminClient
    .from("accounts")
    .select("id, entity_id, qbo_id")
    .eq("id", accountId)
    .single();

  if (acctError || !targetAccount) {
    return NextResponse.json(
      { error: "Target account not found" },
      { status: 404 }
    );
  }

  if (targetAccount.entity_id !== unmatchedRow.entity_id) {
    return NextResponse.json(
      { error: "Account does not belong to the same entity" },
      { status: 400 }
    );
  }

  // 3. Update accounts.qbo_id for future auto-matching (if QBO ID available)
  if (unmatchedRow.qbo_account_id && !targetAccount.qbo_id) {
    await adminClient
      .from("accounts")
      .update({ qbo_id: unmatchedRow.qbo_account_id })
      .eq("id", accountId);
  }

  // 4. Find sibling unresolved rows for the same logical QBO account across
  //    other periods so we can back-fill the same mapping in one shot.
  let siblingsQuery = adminClient
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

  // 5. Upsert gl_balances for the current row + every sibling period
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
  await adminClient.from("gl_balances").upsert(balanceRows, {
    onConflict: "entity_id,account_id,period_year,period_month",
  });

  // 6. Mark every matched unmatched row (current + siblings) as resolved
  await adminClient
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

  const debit = Number(unmatchedRow.debit ?? 0);
  const credit = Number(unmatchedRow.credit ?? 0);

  return NextResponse.json({
    success: true,
    message: "Account mapped and GL balance created",
    autoResolvedCount: siblings?.length ?? 0,
    resolvedRow: {
      id: unmatchedRowId,
      accountId,
      debit,
      credit,
      periodYear: unmatchedRow.period_year,
      periodMonth: unmatchedRow.period_month,
    },
  });
}
