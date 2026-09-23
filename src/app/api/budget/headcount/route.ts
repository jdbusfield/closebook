import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  accessErrorResponse,
  getBudgetActor,
  getOrCreatePlan,
  loadPlanForVersion,
  requirePlanAccess,
  requireVersionAccess,
  type PlanOwner,
  assertOrgManager,
  canManageOrg,
} from "@/lib/budget/access";
import { effectiveAllocations, shareForEntities } from "@/lib/budget/allocation";
import { planShape } from "@/lib/budget/plan-shape";
import { loadAssumptions, loadMemberEntityIds, loadPlanRows, resolveVersionChartId, toEngineRow } from "@/lib/budget/recompute";
import {
  allocateActualsByEmployer,
  comparisonYear,
  loadPersonnelActualsByEntity,
  sumActuals,
  withAllocated,
  type AllocationWeight,
  type PersonnelActuals,
  type PersonnelActualsByEntity,
} from "@/lib/budget/personnel-actuals";
import { employerEntityId } from "@/lib/paylocity/companies";
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
 * GET /api/budget/headcount?fiscalYear=  the same, finding (or creating) the caller's plan for the year in one round trip
 * GET /api/budget/headcount?versionId=  a version's view: the plan's rows priced at this group's share
 */
export async function GET(request: Request) {
  // Phase timings go out as a Server-Timing header so a slow load can be read from the browser
  const t0 = Date.now();
  const marks: Array<[string, number]> = [];
  let last = t0;
  const mark = (name: string) => {
    const now = Date.now();
    marks.push([name, now - last]);
    last = now;
  };
  try {
    const actor = await getBudgetActor();
    mark("actor");
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get("planId");
    const versionId = searchParams.get("versionId");
    const planYear = Number(searchParams.get("fiscalYear"));
    const admin = createAdminClient();

    let plan: PlanOwner | null = null;
    let fiscalYear: number;
    let memberEntityIds: Set<string> | null = null;
    let version = null as Awaited<ReturnType<typeof requireVersionAccess>> | null;
    if (planId) {
      plan = await requirePlanAccess(admin, actor, planId, false);
      fiscalYear = plan.fiscalYear;
    } else if (planYear) {
      const orgId = searchParams.get("organizationId") ?? [...actor.orgRoles.keys()][0];
      plan = await getOrCreatePlan(admin, actor, orgId, planYear);
      fiscalYear = plan.fiscalYear;
    } else if (versionId) {
      version = await requireVersionAccess(admin, actor, versionId, false);
      fiscalYear = version.fiscalYear;
    } else {
      return NextResponse.json({ error: "planId, fiscalYear or versionId is required" }, { status: 400 });
    }

    mark("owner");
    const organizationId = plan?.organizationId ?? version?.organizationId ?? null;
    const compareYear = comparisonYear(fiscalYear);
    // Everything below depends only on the owner: load it all at once
    const [shapeResult, planFromVersion, versionAssumptions, versionMembers, chartId, planRows] = await Promise.all([
      organizationId ? planShape(admin, organizationId) : Promise.resolve({ entities: [], reportingEntities: [], membersByGroup: {} as Record<string, string[]> }),
      version ? loadPlanForVersion(admin, version) : Promise.resolve(plan),
      version ? loadAssumptions(admin, version.id) : plan ? planAssumptions(admin, plan) : Promise.resolve(new AssumptionSet([])),
      version ? loadMemberEntityIds(admin, version) : Promise.resolve(null),
      version
        ? resolveVersionChartId(admin, version).catch(() => null)
        : organizationId
          ? admin.from("master_charts").select("id").eq("organization_id", organizationId).eq("kind", "management").maybeSingle().then((r) => r.data?.id ?? null)
          : Promise.resolve(null),
      // The plan view knows its plan already; a version finds it above and loads rows after
      plan ? loadPlanRows(admin, plan.id) : Promise.resolve(null),
    ]);
    mark("batch");
    const shape = shapeResult;
    plan = planFromVersion;
    const assumptions: AssumptionSet = versionAssumptions;
    memberEntityIds = versionMembers;
    const revenueShares = plan?.revenueShares ?? [];
    // Booked personnel cost for the comparison year, per entity, alongside the rows
    const [allRows, bookedByEntity] = await Promise.all([
      planRows ? Promise.resolve(planRows) : plan ? loadPlanRows(admin, plan.id) : Promise.resolve([]),
      chartId
        ? loadPersonnelActualsByEntity(admin, { chartId, entityIds: shape.entities.map((e) => e.id), year: compareYear }).catch((err) => {
            console.error("headcount actuals failed:", err);
            return null as PersonnelActualsByEntity | null;
          })
        : Promise.resolve(null as PersonnelActualsByEntity | null),
    ]);

    mark("rows+actuals");
    // On a version, keep only the rows this group has a share of
    const rows = memberEntityIds
      ? allRows.filter((r) => shareForEntities(effectiveAllocations(r, revenueShares), memberEntityIds!) > 0)
      : allRows;

    const baselines: Record<string, { total: number; gross: number; byMonth: number[] }> = {};
    const groupTotals: Record<string, number> = {};
    const groupByMonth: Record<string, number[]> = {};
    const unallocatedByMonth: number[] = new Array(12).fill(0);
    const rowGroupTotals: Record<string, Record<string, number>> = {};
    let unallocatedTotal = 0;
    const weights: AllocationWeight[] = [];
    const priced = rows.map((r) => {
      const input = toEngineRow(r);
      const allocs = effectiveAllocations(r, revenueShares);
      const reShare = memberEntityIds ? shareForEntities(allocs, memberEntityIds) : 1;
      const ctx = { year: fiscalYear, assumptions, reShare };
      const p = pricePosition(input, ctx);
      if (!memberEntityIds) weights.push({ employerEntityId: employerEntityId(r.paylocity_company_id), costByMonth: p.totalByMonth, allocations: allocs });
      // Baseline: the row as seeded, without its comp adjustment. Hand-added rows have none.
      const base = baselineRow(r);
      if (base) {
        const b = pricePosition(toEngineRow(base), ctx);
        baselines[r.id] = { total: b.total, gross: GROSS_COMPONENTS.reduce((t, c) => t + (b.componentTotals[c] ?? 0), 0), byMonth: b.totalByMonth };
      } else {
        baselines[r.id] = { total: 0, gross: 0, byMonth: new Array(12).fill(0) };
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
          const series = groupByMonth[g.id] ?? (groupByMonth[g.id] = new Array(12).fill(0));
          for (let i = 0; i < 12; i++) series[i] += p.totalByMonth[i] * share;
          allocated += share;
        }
        if (allocated < 0.999) {
          unallocatedTotal += p.total * (1 - allocated);
          for (let i = 0; i < 12; i++) unallocatedByMonth[i] += p.totalByMonth[i] * (1 - allocated);
        }
        rowGroupTotals[r.id] = perGroup;
      }
      return p;
    });
    const totals = sumPositions(priced);

    // What the projection is up against: personnel cost booked in the
    // comparison year, moved from the entity that ran the payroll to the
    // entities the plan allocates those people to (JD: the by-company
    // comparison has to respect allocations, not where the ledger booked it).
    // A version's own rows are priced at its share, so its weights come from
    // every plan row at 100%.
    let actuals: PersonnelActuals | null = null;
    const groupActuals: Record<string, PersonnelActuals> = {};
    let unallocatedActuals: number[] | null = null;
    if (bookedByEntity) {
      if (memberEntityIds) {
        for (const r of allRows) {
          const p = pricePosition(toEngineRow(r), { year: fiscalYear, assumptions, reShare: 1 });
          weights.push({ employerEntityId: employerEntityId(r.paylocity_company_id), costByMonth: p.totalByMonth, allocations: effectiveAllocations(r, revenueShares) });
        }
      }
      const moved = allocateActualsByEmployer(bookedByEntity, weights);
      const allocated = withAllocated(bookedByEntity, moved.byEntity);
      if (memberEntityIds) {
        actuals = sumActuals(allocated, memberEntityIds);
      } else {
        actuals = sumActuals(bookedByEntity, bookedByEntity.byEntity.keys());
        for (const g of shape.reportingEntities) {
          const members = shape.membersByGroup[g.id] ?? [];
          if (members.length === 0) continue;
          groupActuals[g.id] = sumActuals(allocated, members);
        }
        unallocatedActuals = moved.unallocated;
      }
    }

    mark("price");
    const role = organizationId ? actor.orgRoles.get(organizationId) ?? "" : "";
    return NextResponse.json({
      plan,
      version,
      canEdit: ["admin", "controller", "preparer"].includes(role),
      canManage: canManageOrg(actor, organizationId),
      actuals,
      groupActuals,
      unallocatedActuals,
      rows,
      priced,
      totals,
      baselines,
      groupTotals,
      groupByMonth: Object.fromEntries(Object.entries(groupByMonth).map(([k, v]) => [k, v.map((x) => Math.round(x * 100) / 100)])),
      unallocatedByMonth: unallocatedByMonth.map((x) => Math.round(x * 100) / 100),
      rowGroupTotals,
      unallocatedTotal: Math.round(unallocatedTotal * 100) / 100,
      meritDefault: { pct: assumptions.get("merit_pct_default"), month: assumptions.get("merit_month_default") },
      assumptionRows: assumptions.toRows(),
      memberEntityIds: memberEntityIds ? [...memberEntityIds] : [],
      ...shape,
    }, { headers: { "Server-Timing": [...marks, ["total", Date.now() - t0] as [string, number]].map(([n, d]) => `${n};dur=${d}`).join(", ") } });
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
    // Removing a person is a manager's call; preparers adjust and tag
    if (existing.payroll_plan_id) {
      const plan = await requirePlanAccess(admin, actor, existing.payroll_plan_id, true);
      assertOrgManager(actor, plan.organizationId);
    }

    const { error } = await admin.from("budget_headcount").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/budget/headcount error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
