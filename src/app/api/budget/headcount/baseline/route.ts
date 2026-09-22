import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requirePlanAccess } from "@/lib/budget/access";
import { loadPlanRows } from "@/lib/budget/recompute";
import { readBaselineFields, snapshotFields } from "@/lib/budget/baseline";

/**
 * POST /api/budget/headcount/baseline { planId }
 * Gives every seeded row that has no baseline snapshot one made from its
 * current values (rows seeded before snapshots existed). Rows that already
 * have one are left alone.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json().catch(() => ({}));
    const planId: string | undefined = body?.planId;
    if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });
    const admin = createAdminClient();
    const plan = await requirePlanAccess(admin, actor, planId, true);
    const rows = await loadPlanRows(admin, plan.id);
    let written = 0;
    for (const r of rows) {
      if (!r.employee_id || readBaselineFields(r.seeded_from)) continue;
      const seededFrom = { ...((r.seeded_from as Record<string, unknown> | null) ?? {}), fields: snapshotFields(r as unknown as Record<string, unknown>) };
      const { error } = await admin.from("budget_headcount").update({ seeded_from: seededFrom }).eq("id", r.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      written++;
    }
    return NextResponse.json({ written, rows: rows.length });
  } catch (err) {
    console.error("POST /api/budget/headcount/baseline error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
