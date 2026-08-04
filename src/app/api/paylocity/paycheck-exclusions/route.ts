import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * PUT /api/paylocity/paycheck-exclusions
 *
 * Toggle a paycheck's manual exclusion from all payroll cost views.
 * Body: { employeeId, companyId, checkDate, transactionNumber, excluded, reason? }
 *
 * Matches on (employee_id, paylocity_company_id, check_date, transaction_number)
 * across ALL `year` values — the same check can be stored under two sync years
 * (a January check appears in both the prior-year and current-year syncs), and
 * both copies must carry the flag.
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { employeeId, companyId, checkDate, transactionNumber, excluded, reason } = body;

    if (!employeeId || !companyId || !checkDate || !transactionNumber || typeof excluded !== "boolean") {
      return NextResponse.json(
        { error: "employeeId, companyId, checkDate, transactionNumber, and excluded (boolean) are required" },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("employee_paycheck_details")
      .update({
        excluded,
        excluded_reason: excluded ? (reason ? String(reason) : null) : null,
        excluded_at: excluded ? new Date().toISOString() : null,
      })
      .eq("employee_id", String(employeeId))
      .eq("paylocity_company_id", String(companyId))
      .eq("check_date", String(checkDate))
      .eq("transaction_number", String(transactionNumber))
      .select("id");

    if (error && /excluded/.test(error.message ?? "")) {
      return NextResponse.json(
        { error: "Run DB migration 20260804_paycheck_exclusions.sql in Supabase Studio first." },
        { status: 400 }
      );
    }
    if (error) throw error;
    if (!data || data.length === 0) {
      return NextResponse.json({ error: "No matching paycheck found" }, { status: 404 });
    }

    return NextResponse.json({ updated: data.length, excluded });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update exclusion" },
      { status: 500 }
    );
  }
}
