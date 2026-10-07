import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { syncLinesFromBuilds } from "@/lib/budget/recompute";
import { setZeroMonths } from "@/lib/budget/line-zero-months";
import { buildContext } from "@/lib/budget/builds";
import { recomputeMethodBuilds } from "@/lib/budget/method-builds";

// Saving re-prices the items that are a % of a line
export const maxDuration = 120;

/**
 * POST /api/budget/lines/zero-months  { versionId, masterAccountId, months: number[] }
 * Holds the line at $0 in those months (an empty list clears it), refreshes the items
 * that are a % of a line, then rewrites the lines.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const { versionId, masterAccountId } = body ?? {};
    const months = Array.isArray(body?.months) ? (body.months as unknown[]).map(Number) : null;
    if (!versionId || !masterAccountId || !months) return NextResponse.json({ error: "versionId, masterAccountId and months are required" }, { status: 400 });
    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    const { data: master } = await admin.from("master_accounts").select("id").eq("id", masterAccountId).maybeSingle();
    if (!master) return NextResponse.json({ error: "Unknown line" }, { status: 400 });
    const saved = await setZeroMonths(admin, owner, masterAccountId, months, actor.userId);
    // Items that are a % of this line follow its zeroed months
    await recomputeMethodBuilds(await buildContext(admin, owner));
    const lines = await syncLinesFromBuilds(admin, owner);
    return NextResponse.json({ success: true, months: saved, ...lines });
  } catch (err) {
    console.error("POST /api/budget/lines/zero-months error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
