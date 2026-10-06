import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { syncLinesFromBuilds } from "@/lib/budget/recompute";
import { clearTrendForMaster } from "@/lib/budget/method-builds";
import { loadPriorBase, priorBaseRow, type PriorBasis } from "@/lib/budget/prior-base";

/**
 * GET /api/budget/builds/from-prior?versionId=
 * Each revenue line's last-year base: actuals (booked months, the rest at their
 * average) and the approved budget, plus whether the line can take one.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const versionId = new URL(request.url).searchParams.get("versionId");
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });
    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, false);
    return NextResponse.json(await loadPriorBase(admin, owner));
  } catch (err) {
    console.error("GET /api/budget/builds/from-prior error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * POST /api/budget/builds/from-prior  { versionId, masterAccountIds, basis: "actuals" | "budget", pct? }
 * Puts a last-year base item on each chosen revenue line, replacing an earlier
 * base there. Lines fed by the fleet driver or a schedule are skipped.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const { versionId, masterAccountIds } = body ?? {};
    const basis: PriorBasis = body?.basis === "budget" ? "budget" : "actuals";
    const pct = Number(body?.pct ?? 0);
    if (!versionId || !Array.isArray(masterAccountIds) || masterAccountIds.length === 0) {
      return NextResponse.json({ error: "versionId and masterAccountIds are required" }, { status: 400 });
    }
    if (!Number.isFinite(pct) || Math.abs(pct) > 500) return NextResponse.json({ error: "pct must be a number between -500 and 500" }, { status: 400 });

    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, versionId, true);
    const preview = await loadPriorBase(admin, owner);
    const wanted = new Set(masterAccountIds.map(String));
    const built: string[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const line of preview.lines) {
      if (!wanted.has(line.masterId)) continue;
      if (line.blockedBy) {
        skipped.push({ name: line.name, reason: line.blockedBy });
        continue;
      }
      if (basis === "budget" && !line.budgetMonths) {
        skipped.push({ name: line.name, reason: `no approved ${preview.priorYear} budget for this line` });
        continue;
      }
      if (basis === "actuals" && preview.bookedMonths === 0) {
        skipped.push({ name: line.name, reason: `no ${preview.priorYear} actuals booked yet` });
        continue;
      }
      // Replace an earlier base on this line rather than stacking a second one
      const { data: existing } = await admin
        .from("budget_builds")
        .select("id, meta")
        .eq("budget_version_id", owner.id)
        .eq("master_account_id", line.masterId)
        .eq("build_type", "manual");
      const oldBases = ((existing ?? []) as Array<{ id: string; meta: Record<string, unknown> | null }>).filter((b) => b.meta && typeof b.meta === "object" && "prior_base" in b.meta).map((b) => b.id);
      if (oldBases.length) {
        const { error } = await admin.from("budget_builds").delete().in("id", oldBases);
        if (error) throw new Error(`Could not replace the earlier base on ${line.name}: ${error.message}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await admin.from("budget_builds").insert([priorBaseRow(owner, line, basis, pct, preview.bookedMonths) as any]);
      if (error) throw new Error(`Could not add the base on ${line.name}: ${error.message}`);
      await clearTrendForMaster(admin, owner.id, line.masterId);
      built.push(line.name);
    }

    const lines = built.length ? await syncLinesFromBuilds(admin, owner) : null;
    return NextResponse.json({ built, skipped, ...(lines ?? {}) }, { status: built.length ? 201 : 200 });
  } catch (err) {
    console.error("POST /api/budget/builds/from-prior error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
