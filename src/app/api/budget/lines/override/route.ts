import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { loadMasters } from "@/lib/budget/actuals";
import { resolveVersionChartId, syncLinesFromBuilds } from "@/lib/budget/recompute";
import { recomputeVersion } from "@/lib/budget/builds";
import { setLineOverride } from "@/lib/budget/line-overrides";

// Switching back rebuilds the version's drivers and schedules
export const maxDuration = 120;

/**
 * POST /api/budget/lines/override  { versionId, masterAccountId, on }
 * on: the fleet driver and schedules stop building this line (its items are the line).
 * off: they build it again (drivers and schedules are recomputed).
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const { versionId, masterAccountId } = body ?? {};
    const on = body?.on === true;
    if (!versionId || !masterAccountId) return NextResponse.json({ error: "versionId and masterAccountId are required" }, { status: 400 });
    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    const masters = await loadMasters(admin, await resolveVersionChartId(admin, owner));
    const line = masters.find((m) => m.id === masterAccountId);
    if (!line) return NextResponse.json({ error: "That line is not in this version's chart" }, { status: 400 });
    const lineIds = [line.id, ...masters.filter((m) => m.parentAccountId === line.id).map((m) => m.id)];

    await setLineOverride(admin, owner, line.id, lineIds, on, actor.userId);
    if (on) {
      const lines = await syncLinesFromBuilds(admin, owner);
      return NextResponse.json({ success: true, on, ...lines });
    }
    const [schedules, drivers] = [await recomputeVersion(admin, owner, "schedules"), await recomputeVersion(admin, owner, "drivers")];
    return NextResponse.json({ success: true, on, warnings: [...schedules.warnings, ...drivers.warnings], ...drivers.lines });
  } catch (err) {
    console.error("POST /api/budget/lines/override error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
