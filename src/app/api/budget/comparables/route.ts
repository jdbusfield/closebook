import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { loadComparables } from "@/lib/budget/comparables";

export const maxDuration = 120;

/** GET /api/budget/comparables?versionId= */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get("versionId");
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });
    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, false);
    const result = await loadComparables(admin, owner);
    return NextResponse.json(result);
  } catch (err) {
    console.error("GET /api/budget/comparables error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
