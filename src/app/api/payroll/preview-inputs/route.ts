import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ENTITY_ORDER } from "@/lib/paylocity/entities";
import { PERSONNEL_PARENT_NUMBER, isPersonnelMaster } from "@/lib/budget/personnel-accounts";
import { fetchBudgetAmountRows, resolveActiveVersions, type ResolvedVersion } from "@/lib/budget/versions";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Revenue and Payroll BUDGET per entity for one month, from the budgeting
 * module. Versions are resolved per reporting entity (entity versions as the
 * fallback, see src/lib/budget/versions.ts); a reporting entity's budget is
 * attributed to its lead operating entity (the first member in ENTITY_ORDER)
 * because the preview report is keyed by operating entity.
 *   Revenue = master classification 'Revenue' AND account_type 'Income'
 *   Payroll = master 6100 and its 61x0 sub-masters (name fallback elsewhere)
 */
async function fetchBudgets(
  supabase: AdminClient,
  year: number,
  month: number
): Promise<{ revenueBudgets: Record<string, number>; payrollBudgets: Record<string, number> }> {
  const revenueBudgets: Record<string, number> = {};
  const payrollBudgets: Record<string, number> = {};
  const result = { revenueBudgets, payrollBudgets };
  try {
    const { data: orgs } = await supabase.from("organizations").select("id");
    const { data: reMembers } = await supabase
      .from("reporting_entity_members")
      .select("reporting_entity_id, entity_id");
    const membersByRe = new Map<string, string[]>();
    for (const m of reMembers ?? []) {
      const list = membersByRe.get(m.reporting_entity_id) ?? [];
      list.push(m.entity_id);
      membersByRe.set(m.reporting_entity_id, list);
    }
    const { data: allEntities } = await supabase.from("entities").select("id");
    const allEntityIds = (allEntities ?? []).map((e) => e.id);

    const versions: ResolvedVersion[] = [];
    for (const org of orgs ?? []) {
      versions.push(
        ...(await resolveActiveVersions(supabase, {
          organizationId: org.id,
          years: [year],
          scope: "organization",
          entityIds: allEntityIds,
        }))
      );
    }
    if (versions.length === 0) return result;

    // Lead operating entity for an RE version
    const leadEntity = (v: ResolvedVersion): string | null => {
      if (v.entityId) return v.entityId;
      const members = membersByRe.get(v.reportingEntityId ?? "") ?? [];
      return ENTITY_ORDER.find((id) => members.includes(id)) ?? members[0] ?? null;
    };
    const versionEntity = new Map(versions.map((v) => [v.id, leadEntity(v)]));

    const { data: masters } = await supabase
      .from("master_accounts")
      .select("id, name, account_number, classification, account_type, parent_account_id");
    const revenueIds = new Set(
      (masters ?? [])
        .filter((a) => a.classification === "Revenue" && a.account_type === "Income")
        .map((a) => a.id)
    );
    const personnelParentIds = new Set(
      (masters ?? []).filter((a) => a.account_number === PERSONNEL_PARENT_NUMBER).map((a) => a.id)
    );
    const payrollIds = new Set(
      (masters ?? [])
        .filter((a) => a.classification === "Expense" && isPersonnelMaster(a, personnelParentIds))
        .map((a) => a.id)
    );

    const rows = await fetchBudgetAmountRows(supabase, versions.map((v) => v.id), {
      years: [year],
      months: [month],
    });
    for (const row of rows) {
      const entityId = versionEntity.get(row.budget_version_id);
      if (!entityId) continue;
      if (revenueIds.has(row.master_account_id)) {
        revenueBudgets[entityId] = (revenueBudgets[entityId] ?? 0) + Number(row.amount ?? 0);
      } else if (payrollIds.has(row.master_account_id)) {
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
