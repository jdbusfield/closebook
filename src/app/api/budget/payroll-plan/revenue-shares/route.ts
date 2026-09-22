import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requirePlanAccess } from "@/lib/budget/access";
import { loadMasters, loadMonthlyActuals } from "@/lib/budget/actuals";
import { planShape } from "@/lib/budget/plan-shape";

export const maxDuration = 120;

/**
 * POST /api/budget/payroll-plan/revenue-shares { planId }
 * Refreshes the plan's revenue shares: each REPORTING GROUP's part of the
 * organization's revenue over the last twelve closed months (JD: allocate
 * between groups, not entities). A group's share is carried on its
 * principal entity, the member with the most revenue, so a row set to
 * "By revenue" prices into that group's budget. Rows set to "By revenue"
 * follow these shares.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json().catch(() => ({}));
    const planId: string | undefined = body?.planId;
    if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });
    const admin = createAdminClient();
    const plan = await requirePlanAccess(admin, actor, planId, true);

    const { data: chart } = await admin
      .from("master_charts")
      .select("id")
      .eq("organization_id", plan.organizationId)
      .eq("kind", "management")
      .maybeSingle();
    if (!chart?.id) return NextResponse.json({ error: "Management chart not found" }, { status: 400 });
    const shape = await planShape(admin, plan.organizationId);
    const masters = await loadMasters(admin, chart.id);
    // Revenue as the Financial Model reports it: the Revenue section (Income
    // accounts only, so no Other Income) with intercompany accounts eliminated.
    const revenueMasters = new Set(
      masters.filter((m) => m.classification === "Revenue" && m.accountType === "Income" && !m.isIntercompany).map((m) => m.id),
    );

    // Last twelve full months before this one
    const now = new Date();
    const endYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const endMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
    const startYear = endMonth === 12 ? endYear : endYear - 1;
    const startMonth = endMonth === 12 ? 1 : endMonth + 1;

    // Revenue per entity, then rolled up to its reporting group
    const revenueByEntity = new Map<string, number>();
    for (const e of shape.entities) {
      const a = await loadMonthlyActuals(admin, { chartId: chart.id, entityIds: [e.id], startYear, startMonth, endYear, endMonth, masters });
      let total = 0;
      for (const [masterId, series] of a.byMaster) {
        if (!revenueMasters.has(masterId)) continue;
        for (const v of series.values()) total += v;
      }
      revenueByEntity.set(e.id, total);
    }
    const groups = shape.reportingEntities.map((g) => {
      const members = shape.membersByGroup[g.id] ?? [];
      const amount = members.reduce((t, id) => t + (revenueByEntity.get(id) ?? 0), 0);
      const principal = [...members].sort((x, y) => (revenueByEntity.get(y) ?? 0) - (revenueByEntity.get(x) ?? 0))[0] ?? null;
      return { reporting_entity_id: g.id, name: g.name, amount, principalEntityId: principal };
    });
    const grand = groups.reduce((t, g) => t + Math.max(0, g.amount), 0);
    if (grand <= 0) return NextResponse.json({ error: "No revenue found in the last twelve months" }, { status: 400 });
    const shares = groups
      .filter((g) => g.amount > 0 && g.principalEntityId)
      .map((g) => ({
        reporting_entity_id: g.reporting_entity_id,
        entity_id: g.principalEntityId as string,
        pct: Math.round((g.amount / grand) * 10000) / 100,
      }))
      .sort((a, b) => b.pct - a.pct);
    const asOf = `Trailing twelve months, ${String(startMonth).padStart(2, "0")}/${startYear} to ${String(endMonth).padStart(2, "0")}/${endYear}, by reporting group`;
    const { error } = await admin
      .from("budget_payroll_plans")
      .update({ revenue_shares: shares, revenue_shares_as_of: asOf })
      .eq("id", plan.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      shares,
      asOf,
      revenue: groups.map((g) => ({ reporting_entity_id: g.reporting_entity_id, name: g.name, amount: Math.round(g.amount) })),
    });
  } catch (err) {
    console.error("POST /api/budget/payroll-plan/revenue-shares error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
