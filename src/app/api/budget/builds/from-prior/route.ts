import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { syncLinesFromBuilds } from "@/lib/budget/recompute";
import { clearTrendForMaster } from "@/lib/budget/method-builds";
import { loadPriorBase, priorBaseRow, type PriorBasis } from "@/lib/budget/prior-base";

/**
 * GET /api/budget/builds/from-prior?versionId=
 * Each revenue line's last-year base: actuals (booked months, the rest at their
 * average) and the active budget version, plus whether the line can take one.
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
 * POST /api/budget/builds/from-prior  { versionId, masterAccountIds, basis: "actuals" | "budget", pct?, replaceItems? }
 * Puts a last-year base item on each chosen revenue line, replacing an earlier
 * base there. With replaceItems the line's other items (method and typed) go too,
 * so the base is the whole line. Lines fed by the fleet driver or a schedule are skipped.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const { versionId, masterAccountIds } = body ?? {};
    const basis: PriorBasis = body?.basis === "budget" ? "budget" : "actuals";
    const pct = Number(body?.pct ?? 0);
    const replaceItems = body?.replaceItems === true;
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
        skipped.push({ name: line.name, reason: `no active ${preview.priorYear} budget for this line` });
        continue;
      }
      if (basis === "actuals" && preview.bookedMonths === 0) {
        skipped.push({ name: line.name, reason: `no ${preview.priorYear} actuals booked yet` });
        continue;
      }
      // What this replaces: an earlier base, and with replaceItems every other item on the line
      const { data: existing, error: findError } = await admin
        .from("budget_builds")
        .select("id, meta")
        .eq("budget_version_id", owner.id)
        .eq("master_account_id", line.masterId)
        .eq("build_type", "manual");
      // Without this list an earlier base would survive next to the new one and double the line
      if (findError) throw new Error(`Could not read the items on ${line.name}: ${findError.message}`);
      const isBase = (b: { meta: Record<string, unknown> | null }) => !!b.meta && typeof b.meta === "object" && "prior_base" in b.meta;
      const old = ((existing ?? []) as Array<{ id: string; meta: Record<string, unknown> | null }>).filter((b) => replaceItems || isBase(b)).map((b) => b.id);
      // Add the new base first, then remove what it replaces, so a failure never leaves the line empty
      const { data: added, error } = await admin
        .from("budget_builds")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert([priorBaseRow(owner, line, basis, pct, preview.bookedMonths) as any])
        .select("id")
        .single();
      if (error) throw new Error(`Could not add the base on ${line.name}: ${error.message}`);
      const toRemove = old.filter((id) => id !== added.id);
      if (toRemove.length) {
        const { error: delError } = await admin.from("budget_builds").delete().in("id", toRemove);
        if (delError) throw new Error(`Added the base on ${line.name} but could not remove what it replaces: ${delError.message}`);
      }
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
