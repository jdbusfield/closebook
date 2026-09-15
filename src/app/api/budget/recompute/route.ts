import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { recomputePersonnel, syncLinesFromBuilds } from "@/lib/budget/recompute";
import { sumPositions } from "@/lib/budget/personnel-engine";

export const maxDuration = 120;

/**
 * POST /api/budget/recompute  { versionId, scope?: "personnel" | "all" }
 * Re-prices headcount into builds and syncs lines from builds.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json().catch(() => ({}));
    const versionId: string | undefined = body?.versionId;
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);

    const personnel = await recomputePersonnel(admin, owner);
    const lines = await syncLinesFromBuilds(admin, owner);
    const totals = sumPositions(personnel.positions);

    return NextResponse.json({
      success: true,
      positions: personnel.positions.length,
      buildsWritten: personnel.buildsWritten,
      missingSubMasters: personnel.missingSubMasters,
      personnelTotal: totals.total,
      personnelByMonth: totals.totalByMonth,
      ...lines,
    });
  } catch (err) {
    console.error("POST /api/budget/recompute error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
