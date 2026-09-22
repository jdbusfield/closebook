import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  accessErrorResponse,
  getBudgetActor,
  loadPlanForVersion,
  requirePlanAccess,
  requireVersionAccess,
  type PlanOwner,
} from "@/lib/budget/access";
import { effectiveAllocations, shareForEntities } from "@/lib/budget/allocation";
import { planShape } from "@/lib/budget/plan-shape";
import { loadAssumptions, loadMemberEntityIds, loadPlanRows, resolveVersionChartId, toEngineRow } from "@/lib/budget/recompute";
import { comparisonYear, loadPersonnelActuals, type PersonnelActuals } from "@/lib/budget/personnel-actuals";
import { AssumptionSet } from "@/lib/budget/assumption-keys";
import { pricePosition, sumPositions } from "@/lib/budget/personnel-engine";
import { baselineRow } from "@/lib/budget/baseline";

const EDITABLE_FIELDS = new Set([
  "name", "title", "department", "is_requisition", "status", "pay_type", "base_rate", "annual_salary",
  "std_hours_week", "fte_pct", "start_month", "end_month", "merit_pct", "merit_month", "bonus_target",
  "commission_annual", "ot_pct", "dt_pct", "meal_pct", "other_earnings_monthly", "benefits_monthly",
  "match_pct", "life_disability_monthly", "wc_class_code", "pto_hours_per_period", "other_costs_monthly",
  "entity_allocations", "class_allocations", "notes",
  "comp_adj_kind", "comp_adj_value", "comp_adj_month", "comp_adj_reason",
  "amount_monthly", "amount_is_loaded", "open_role",
  "location_allocations", "function_allocations", "allocation_mode",
]);

const GROSS_COMPONENTS = ["wages", "overtime", "doubletime", "meal", "bonus", "commission", "other_earnings"] as const;

function pickEditable(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (EDITABLE_FIELDS.has(k)) out[k] = v;
  return out;
}

/** Assumptions for pricing on the plan page: the active budget version of the year if any, else defaults. */
async function planAssumptions(admin: ReturnType<typeof createAdminClient>, plan: PlanOwner): Promise<AssumptionSet> {
  const { data: v } = await admin
    .from("budget_versions")
    .select("id")
    .eq("organization_id", plan.organizationId)
    .eq("fiscal_year", plan.fiscalYear)
    .eq("kind", "budget")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (v?.id) return loadAssumptions(admin, v.id);
  return new AssumptionSet([]);
}

/**
 * GET /api/budget/headcount?planId=   the shared plan: every row at 100%, plus each reporting group's share
 * GET /api/budget/headcount?versionId=  a version's view: the plan's rows priced at this group's share
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get("planId");
    const versionId = searchParams.get("versionId");
    const admin = createAdminClient();

    let plan: PlanOwner | null;
    let assumptions: AssumptionSet;
    let fiscalYear: number;
    let memberEntityIds: Set<string> | null = null;
    let version = null as Awaited<ReturnType<typeof requireVersionAccess>> | null;
    if (planId) {
      plan = await requirePlanAccess(admin, actor, planId, false);
      assumptions = await planAssumptions(admin, plan);
      fiscalYear = plan.fiscalYear;
    } else if (versionId) {
      version = await requireVersionAccess(admin, actor, versionId, false);
      plan = await loadPlanForVersion(admin, version);
      [assumptions, memberEntityIds] = await Promise.all([loadAssumptions(admin, version.id), loadMemberEntityIds(admin, version)]);
      fiscalYear = version.fiscalYear;
    } else {
      return NextResponse.json({ error: "planId or versionId is required" }, { status: 400 });
    }

    const organizationId = plan?.organizationId ?? version?.organizationId ?? null;
    const shape = organizationId ? await planShape(admin, organizationId) : { entities: [], reportingEntities: [], membersByGroup: {} };
    const revenueShares = plan?.revenueShares ?? [];
    const allRows = plan ? await loadPlanRows(admin, plan.id) : [];

    // On a version, keep only the rows this group has a share of
    const rows = memberEntityIds
      ? allRows.filter((r) => shareForEntities(effectiveAllocations(r, revenueShares), memberEntityIds!) > 0)
      : allRows;

    const baselines: Record<string, { total: number; gross: number }> = {};
    const groupTotals: Record<string, number> = {};
    const rowGroupTotals: Record<string, Record<string, number>> = {};
    let unallocatedTotal = 0;
    const priced = rows.map((r) => {
      const input = toEngineRow(r);
      const allocs = effectiveAllocations(r, revenueShares);
      const reShare = memberEntityIds ? shareForEntities(allocs, memberEntityIds) : 1;
      const ctx = { year: fiscalYear, assumptions, reShare };
      const p = pricePosition(input, ctx);
      // Baseline: the row as seeded, without its comp adjustment. Hand-added rows have none.
      const base = baselineRow(r);
      if (base) {
        const b = pricePosition(toEngineRow(base), ctx);
        baselines[r.id] = { total: b.total, gross: GROSS_COMPONENTS.reduce((t, c) => t + (b.componentTotals[c] ?? 0), 0) };
      } else {
        baselines[r.id] = { total: 0, gross: 0 };
      }
      if (!memberEntityIds) {
        // Plan view: how the full cost splits across reporting groups
        const perGroup: Record<string, number> = {};
        let allocated = 0;
        for (const g of shape.reportingEntities) {
          const share = shareForEntities(allocs, new Set(shape.membersByGroup[g.id] ?? []));
          if (share <= 0) continue;
          const amt = Math.round(p.total * share * 100) / 100;
          perGroup[g.id] = amt;
          groupTotals[g.id] = (groupTotals[g.id] ?? 0) + amt;
          allocated += share;
        }
        if (allocated < 0.999) unallocatedTotal += p.total * (1 - allocated);
        rowGroupTotals[r.id] = perGroup;
      }
      return p;
    });
    const totals = sumPositions(priced);

    // What the projection is up against: personnel cost booked in the last complete year
    let actuals: PersonnelActuals | null = null;
    try {
      const actualEntityIds = memberEntityIds ? [...memberEntityIds] : shape.entities.map((e) => e.id);
      let chartId: string | null = null;
      if (version) chartId = await resolveVersionChartId(admin, version);
      else if (organizationId) {
        const { data: chart } = await admin.from("master_charts").select("id").eq("organization_id", organizationId).eq("kind", "management").maybeSingle();
        chartId = chart?.id ?? null;
      }
      if (chartId) actuals = await loadPersonnelActuals(admin, { chartId, entityIds: actualEntityIds, year: comparisonYear(fiscalYear) });
    } catch (err) {
      console.error("headcount actuals failed:", err);
    }

    return NextResponse.json({
      plan,
      version,
      actuals,
      rows,
      priced,
      totals,
      baselines,
      groupTotals,
      rowGroupTotals,
      unallocatedTotal: Math.round(unallocatedTotal * 100) / 100,
      meritDefault: { pct: assumptions.get("merit_pct_default"), month: assumptions.get("merit_month_default") },
      assumptionRows: assumptions.toRows(),
      memberEntityIds: memberEntityIds ? [...memberEntityIds] : [],
      ...shape,
    });
  } catch (err) {
    console.error("GET /api/budget/headcount error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * POST: add a row to the plan (requisition or manual employee).
 * Body: { planId, ...fields }. An open role sends { open_role: true, title: <role>, count?: n }
 * and gets named "Open role: <role>" (numbered when count > 1) until a person is filled in.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const planId: string | undefined = body?.planId;
    if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });
    const openRole = body?.open_role === true;
    const role = typeof body?.title === "string" ? body.title.trim() : "";
    if (!openRole && !body?.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (openRole && !role) return NextResponse.json({ error: "Give the open role a title" }, { status: 400 });
    const count = openRole ? Math.min(50, Math.max(1, Math.floor(Number(body.count ?? 1)) || 1)) : 1;

    const admin = createAdminClient();
    const plan = await requirePlanAccess(admin, actor, planId, true);
    const fields = pickEditable(body);
    const base = {
      payroll_plan_id: plan.id,
      is_requisition: body.is_requisition ?? true,
      status: body.status ?? (body.is_requisition === false ? "active" : "planned"),
      ...fields,
    };
    const inserts = Array.from({ length: count }, (_, i) => ({
      ...base,
      open_role: openRole,
      name: openRole ? `Open role: ${role}${count > 1 ? ` (${i + 1})` : ""}` : String(body.name),
    }));
    const { data, error } = await admin.from("budget_headcount").insert(inserts).select("*");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data?.[0] ?? null, rows: data ?? [], inserted: data?.length ?? 0 }, { status: 201 });
  } catch (err) {
    console.error("POST /api/budget/headcount error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

async function requireRowWrite(admin: ReturnType<typeof createAdminClient>, actor: Awaited<ReturnType<typeof getBudgetActor>>, id: string) {
  const { data: existing } = await admin
    .from("budget_headcount")
    .select("id, budget_version_id, payroll_plan_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return null;
  if (existing.payroll_plan_id) await requirePlanAccess(admin, actor, existing.payroll_plan_id, true);
  else if (existing.budget_version_id) await requireVersionAccess(admin, actor, existing.budget_version_id, true);
  return existing;
}

/** PATCH: update fields. Body: { id, ...fields } */
export async function PATCH(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const id: string | undefined = body?.id;
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const admin = createAdminClient();
    const existing = await requireRowWrite(admin, actor, id);
    if (!existing) return NextResponse.json({ error: "Row not found" }, { status: 404 });

    const fields = pickEditable(body);
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No editable fields in request" }, { status: 400 });
    }
    const { data, error } = await admin
      .from("budget_headcount")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ row: data });
  } catch (err) {
    console.error("PATCH /api/budget/headcount error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** DELETE /api/budget/headcount?id= */
export async function DELETE(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const admin = createAdminClient();
    const existing = await requireRowWrite(admin, actor, id);
    if (!existing) return NextResponse.json({ error: "Row not found" }, { status: 404 });

    const { error } = await admin.from("budget_headcount").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/budget/headcount error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
