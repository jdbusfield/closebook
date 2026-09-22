import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, getOrCreatePlan, requirePlanAccess } from "@/lib/budget/access";
import { planShape } from "@/lib/budget/plan-shape";

/**
 * GET /api/budget/payroll-plan?fiscalYear=&organizationId=
 * The shared payroll plan for the year (created on first visit by an editor)
 * plus the entities and reporting groups it can allocate to.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const fiscalYear = Number(searchParams.get("fiscalYear"));
    if (!fiscalYear) return NextResponse.json({ error: "fiscalYear is required" }, { status: 400 });
    const organizationId = searchParams.get("organizationId") ?? [...actor.orgRoles.keys()][0];
    const admin = createAdminClient();
    const plan = await getOrCreatePlan(admin, actor, organizationId, fiscalYear);
    const shape = await planShape(admin, plan.organizationId);
    const role = actor.orgRoles.get(plan.organizationId) ?? "";
    return NextResponse.json({ plan, ...shape, canEdit: ["admin", "controller", "preparer"].includes(role) });
  } catch (err) {
    console.error("GET /api/budget/payroll-plan error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** PATCH /api/budget/payroll-plan { planId, status?, notes? } */
export async function PATCH(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const planId: string | undefined = body?.planId;
    if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });
    const admin = createAdminClient();
    await requirePlanAccess(admin, actor, planId, true);
    const fields: Record<string, unknown> = {};
    if (typeof body.status === "string") fields.status = body.status;
    if (typeof body.notes === "string" || body.notes === null) fields.notes = body.notes;
    if (Object.keys(fields).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    const { error } = await admin.from("budget_payroll_plans").update(fields).eq("id", planId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/budget/payroll-plan error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
