import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requirePlanAccess } from "@/lib/budget/access";
import { loadMasters, loadMonthlyActuals } from "@/lib/budget/actuals";

export const maxDuration = 120;

/**
 * POST /api/budget/payroll-plan/revenue-shares { planId }
 * Refreshes the plan's revenue shares: each entity's part of the
 * organization's revenue over the last twelve closed months. Rows set to
 * "By revenue" follow these shares.
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
    const { data: entities } = await admin.from("entities").select("id, name").eq("organization_id", plan.organizationId);
    const masters = await loadMasters(admin, chart.id);
    const revenueMasters = new Set(masters.filter((m) => m.classification === "Revenue").map((m) => m.id));

    // Last twelve full months before this one
    const now = new Date();
    const endYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const endMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();
    const startYear = endMonth === 12 ? endYear : endYear - 1;
    const startMonth = endMonth === 12 ? 1 : endMonth + 1;

    const revenue: Array<{ entity_id: string; name: string; amount: number }> = [];
    for (const e of entities ?? []) {
      const a = await loadMonthlyActuals(admin, { chartId: chart.id, entityIds: [e.id], startYear, startMonth, endYear, endMonth, masters });
      let total = 0;
      for (const [masterId, series] of a.byMaster) {
        if (!revenueMasters.has(masterId)) continue;
        for (const v of series.values()) total += v;
      }
      if (total > 0) revenue.push({ entity_id: e.id, name: e.name, amount: total });
    }
    const grand = revenue.reduce((t, r) => t + r.amount, 0);
    if (grand <= 0) return NextResponse.json({ error: "No revenue found in the last twelve months" }, { status: 400 });
    const shares = revenue
      .map((r) => ({ entity_id: r.entity_id, pct: Math.round((r.amount / grand) * 10000) / 100 }))
      .sort((a, b) => b.pct - a.pct);
    const asOf = `Trailing twelve months, ${String(startMonth).padStart(2, "0")}/${startYear} to ${String(endMonth).padStart(2, "0")}/${endYear}`;
    const { error } = await admin
      .from("budget_payroll_plans")
      .update({ revenue_shares: shares, revenue_shares_as_of: asOf })
      .eq("id", plan.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ shares, asOf, revenue: revenue.map((r) => ({ ...r, amount: Math.round(r.amount) })) });
  } catch (err) {
    console.error("POST /api/budget/payroll-plan/revenue-shares error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
