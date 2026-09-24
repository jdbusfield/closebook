import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { buildContext } from "@/lib/budget/builds";
import { breakoutMaster } from "@/lib/budget/method-builds";
import { syncLinesFromBuilds } from "@/lib/budget/recompute";

export const maxDuration = 120;

/**
 * POST /api/budget/builds/breakout { versionId, masterAccountId, top?, minAnnual? }
 * Seeds a master line with one run-rate item per entity account that fed it
 * last year, so a bucketed line such as Other Expenses shows what is inside
 * it. Replaces an earlier breakout and the line's run-rate build.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const { versionId, masterAccountId } = body ?? {};
    if (!versionId || !masterAccountId) return NextResponse.json({ error: "versionId and masterAccountId are required" }, { status: 400 });
    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    const ctx = await buildContext(admin, owner);
    const result = await breakoutMaster(ctx, masterAccountId, {
      top: body.top ? Number(body.top) : undefined,
      minAnnual: body.minAnnual != null ? Number(body.minAnnual) : undefined,
    });
    const lines = await syncLinesFromBuilds(admin, owner);
    return NextResponse.json({ ...result, ...lines });
  } catch (err) {
    console.error("POST /api/budget/builds/breakout error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
