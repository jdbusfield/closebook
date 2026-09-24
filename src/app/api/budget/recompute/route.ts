import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { recomputeVersion, type RecomputeScope } from "@/lib/budget/builds";

export const maxDuration = 300; // depreciation over ~700 assets plus KPI history

const SCOPES = new Set<RecomputeScope>(["personnel", "schedules", "drivers", "trend", "methods", "all"]);

/**
 * POST /api/budget/recompute  { versionId, scope?: "personnel" | "schedules" | "drivers" | "trend" | "methods" | "all" }
 * Rebuilds computed builds for the scope and syncs lines from builds.
 * Manual builds are never touched.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json().catch(() => ({}));
    const versionId: string | undefined = body?.versionId;
    const scope: RecomputeScope = SCOPES.has(body?.scope) ? body.scope : "all";
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    const summary = await recomputeVersion(admin, owner, scope);
    return NextResponse.json({ success: true, ...summary });
  } catch (err) {
    console.error("POST /api/budget/recompute error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
