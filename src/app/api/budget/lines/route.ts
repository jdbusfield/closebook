import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { buildVersionModel } from "@/lib/budget/model";

// Last year comes from a Financial Model build (bounded at 25s per group, then the GL)
export const maxDuration = 120;

const NIL_CLASS = "00000000-0000-0000-0000-000000000000";

/**
 * GET /api/budget/lines?versionId=
 * The version's model (see src/lib/budget/model.ts).
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get("versionId");
    const withActuals = searchParams.get("actuals") !== "0";
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, false);
    const model = await buildVersionModel(admin, owner, { withActuals });
    return NextResponse.json(model);
  } catch (err) {
    console.error("GET /api/budget/lines error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** PUT /api/budget/lines  { versionId, masterAccountId, classId?, note?, reviewFlag? } */
export async function PUT(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const { versionId, masterAccountId, classId, note, reviewFlag } = body ?? {};
    if (!versionId || !masterAccountId) return NextResponse.json({ error: "versionId and masterAccountId are required" }, { status: 400 });
    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    let find = admin.from("budget_line_notes").select("id").eq("budget_version_id", owner.id).eq("master_account_id", masterAccountId);
    find = classId ? find.eq("qbo_class_id", classId) : find.eq("class_key", NIL_CLASS);
    const { data: existing } = await find.limit(1);
    const payload = { budget_version_id: owner.id, master_account_id: masterAccountId, qbo_class_id: classId ?? null, note: note ?? null, review_flag: reviewFlag ?? null, updated_by: actor.userId };
    const res = existing && existing.length
      ? await admin.from("budget_line_notes").update(payload).eq("id", existing[0].id)
      : await admin.from("budget_line_notes").insert(payload);
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PUT /api/budget/lines error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
