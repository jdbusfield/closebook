import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Revenue and Payroll BUDGET per entity for one month, from the budgeting
 * module: active budget_versions for the fiscal year → budget_amounts for the
 * month → master_accounts, where
 *   Revenue = classification='Revenue' AND account_type='Income'
 *     (the same rule as the financial statements "Revenue" section), and
 *   Payroll = classification='Expense' with a personnel/payroll-type name
 *     (the budget chart's "Personnel Costs" line; also matches
 *     payroll/salaries/wages lines on other charts).
 *
 * Mirrors the app's column fallback: live DB uses budget_amounts.master_account_id,
 * the original migration used account_id (mapped via master_account_mappings).
 */
const PAYROLL_ACCOUNT_NAME = /personnel|payroll|salar|wage/i;

async function fetchBudgets(
  supabase: AdminClient,
  year: number,
  month: number
): Promise<{ revenueBudgets: Record<string, number>; payrollBudgets: Record<string, number> }> {
  const revenueBudgets: Record<string, number> = {};
  const payrollBudgets: Record<string, number> = {};
  const result = { revenueBudgets, payrollBudgets };
  try {
    const { data: versions, error: vErr } = await supabase
      .from("budget_versions")
      .select("id, entity_id")
      .eq("is_active", true)
      .eq("fiscal_year", year);
    if (vErr || !versions || versions.length === 0) return result;
    const versionEntity = new Map(versions.map((v) => [v.id, v.entity_id]));
    const versionIds = versions.map((v) => v.id);

    // Revenue master accounts (main Revenue section: Income only)
    const { data: revAccounts, error: rErr } = await supabase
      .from("master_accounts")
      .select("id")
      .eq("classification", "Revenue")
      .eq("account_type", "Income");
    if (rErr || !revAccounts) return result;
    const revenueIds = new Set(revAccounts.map((a) => a.id));

    // Payroll master accounts (expense lines named personnel/payroll/salaries/wages)
    const { data: expAccounts, error: eErr } = await supabase
      .from("master_accounts")
      .select("id, name")
      .eq("classification", "Expense");
    if (eErr || !expAccounts) return result;
    const payrollIds = new Set(
      expAccounts.filter((a) => PAYROLL_ACCOUNT_NAME.test(a.name ?? "")).map((a) => a.id)
    );

    // Try the live column name first, fall back to the original
    interface BudgetAmountRow {
      budget_version_id: string;
      amount: number;
      master_account_id?: string | null;
      account_id?: string | null;
    }
    let rows: BudgetAmountRow[] = [];
    let usedLegacy = false;
    const primary = await supabase
      .from("budget_amounts")
      .select("budget_version_id, master_account_id, amount")
      .in("budget_version_id", versionIds)
      .eq("period_year", year)
      .eq("period_month", month);
    if (!primary.error) {
      rows = (primary.data ?? []) as unknown as BudgetAmountRow[];
    } else {
      const legacy = await supabase
        .from("budget_amounts")
        .select("budget_version_id, account_id, amount")
        .in("budget_version_id", versionIds)
        .eq("period_year", year)
        .eq("period_month", month);
      if (legacy.error) return result;
      rows = (legacy.data ?? []) as unknown as BudgetAmountRow[];
      usedLegacy = true;
    }

    // Legacy path: entity account ids → master account ids
    let entityToMaster: Map<string, string> | null = null;
    if (usedLegacy) {
      entityToMaster = new Map();
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data: maps, error: mErr } = await supabase
          .from("master_account_mappings")
          .select("account_id, master_account_id")
          .range(from, from + pageSize - 1);
        if (mErr || !maps) break;
        for (const m of maps) entityToMaster.set(m.account_id, m.master_account_id);
        if (maps.length < pageSize) break;
        from += pageSize;
      }
    }

    for (const row of rows) {
      const masterId = usedLegacy
        ? entityToMaster?.get(row.account_id ?? "") ?? null
        : row.master_account_id ?? null;
      if (!masterId) continue;
      const entityId = versionEntity.get(row.budget_version_id);
      if (!entityId) continue;
      if (revenueIds.has(masterId)) {
        revenueBudgets[entityId] = (revenueBudgets[entityId] ?? 0) + Number(row.amount ?? 0);
      } else if (payrollIds.has(masterId)) {
        payrollBudgets[entityId] = (payrollBudgets[entityId] ?? 0) + Number(row.amount ?? 0);
      }
    }
    for (const k of Object.keys(revenueBudgets))
      revenueBudgets[k] = Math.round(revenueBudgets[k] * 100) / 100;
    for (const k of Object.keys(payrollBudgets))
      payrollBudgets[k] = Math.round(payrollBudgets[k] * 100) / 100;
  } catch (err) {
    console.error("Budget fetch error:", err);
  }
  return result;
}

/**
 * GET /api/payroll/preview-inputs?year=2026&month=4
 *
 * Returns the manually-entered Month Preview figures (revenue estimate,
 * deduction, payroll budget) per entity for a month, plus revenueBudgets and
 * payrollBudgets pulled live from the budgeting module (active version;
 * Revenue/Income accounts and Personnel/payroll expense lines respectively).
 * Gracefully returns empty inputs if the table doesn't exist yet
 * (migration 20260706_payroll_preview_inputs).
 */
export async function GET(req: NextRequest) {
  try {
    const year = Number(req.nextUrl.searchParams.get("year"));
    const month = Number(req.nextUrl.searchParams.get("month"));
    if (!year || !month) {
      return NextResponse.json({ error: "year and month are required" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const [inputsRes, budgets] = await Promise.all([
      supabase.from("payroll_preview_inputs").select("*").eq("year", year).eq("month", month),
      fetchBudgets(supabase, year, month),
    ]);
    const { revenueBudgets, payrollBudgets } = budgets;

    const { data, error } = inputsRes;
    if (error && error.message?.includes("payroll_preview_inputs")) {
      return NextResponse.json({ inputs: [], tableExists: false, revenueBudgets, payrollBudgets });
    }
    if (error) throw error;

    return NextResponse.json({ inputs: data ?? [], tableExists: true, revenueBudgets, payrollBudgets });
  } catch (err) {
    console.error("Preview inputs GET error:", err);
    return NextResponse.json({ inputs: [], tableExists: false, revenueBudgets: {}, payrollBudgets: {} });
  }
}

/**
 * PUT /api/payroll/preview-inputs
 *
 * Body: { year, month, inputs: [{ entityId, revenueEstimate?, revenueBudget?,
 *          revenueDeduction?, payrollBudget? }] }
 * Upserts one row per entity for the month.
 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { year, month, inputs } = body;
    if (!year || !month || !Array.isArray(inputs)) {
      return NextResponse.json(
        { error: "year, month, and inputs[] are required" },
        { status: 400 }
      );
    }

    const num = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
    };

    const rows = inputs
      .filter((i: { entityId?: unknown }) => typeof i?.entityId === "string" && i.entityId)
      .map((i: Record<string, unknown>) => ({
        year: Number(year),
        month: Number(month),
        entity_id: String(i.entityId),
        revenue_estimate: num(i.revenueEstimate),
        revenue_budget: num(i.revenueBudget),
        revenue_deduction: num(i.revenueDeduction),
        payroll_budget: num(i.payrollBudget),
        updated_at: new Date().toISOString(),
      }));

    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid input rows" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("payroll_preview_inputs")
      .upsert(rows, { onConflict: "year,month,entity_id" })
      .select();

    if (error && error.message?.includes("payroll_preview_inputs")) {
      return NextResponse.json(
        { error: "Run DB migration 20260706_payroll_preview_inputs.sql in Supabase Studio first." },
        { status: 400 }
      );
    }
    if (error) throw error;

    return NextResponse.json({ inputs: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save preview inputs" },
      { status: 500 }
    );
  }
}
