import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, assertOrgEditor, getBudgetActor, loadVersionOwner, BudgetAccessError } from "@/lib/budget/access";
import { loadComparables } from "@/lib/budget/comparables";
import { loadPlanHeadcountForVersion } from "@/lib/budget/recompute";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";

export const maxDuration = 120;

/**
 * POST /api/budget/approve  { versionId }
 * Snapshots the comparables, assumptions, lines and headcount the version
 * was built from, marks it approved and active, and locks it. A locked
 * version cannot be edited; create a new version (or a forecast) from it.
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json().catch(() => ({}));
    const versionId: string | undefined = body?.versionId;
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

    const admin = createAdminClient();
    const owner = await loadVersionOwner(admin, versionId);
    if (!owner) throw new BudgetAccessError("Budget version not found", 404);
    assertOrgEditor(actor, owner.organizationId);
    const role = actor.orgRoles.get(owner.organizationId ?? "") ?? "";
    if (!["admin", "controller"].includes(role)) {
      throw new BudgetAccessError("Approving a budget needs the controller or admin role", 403);
    }
    if (owner.lockedAt) return NextResponse.json({ error: "This version is already approved and locked" }, { status: 409 });

    // Snapshots (written before the lock so the trigger allows them)
    const [comparables, assumptions, lines, headcount] = await Promise.all([
      loadComparables(admin, owner),
      fetchAllPaginated<Record<string, unknown>>((o, l) => admin.from("budget_assumptions").select("*").eq("budget_version_id", owner.id).range(o, o + l - 1)),
      fetchAllPaginated<Record<string, unknown>>((o, l) => admin.from("budget_amounts").select("master_account_id, qbo_class_id, period_month, amount, source").eq("budget_version_id", owner.id).range(o, o + l - 1)),
      loadPlanHeadcountForVersion(admin, owner),
    ]);
    const snapshots = [
      { kind: "comparables", payload: comparables },
      { kind: "assumptions", payload: { rows: assumptions } },
      { kind: "lines", payload: { rows: lines } },
      { kind: "headcount", payload: { rows: headcount } },
    ];
    for (const s of snapshots) {
      const { error } = await admin
        .from("budget_version_snapshots")
        .insert({ budget_version_id: owner.id, kind: s.kind, payload: JSON.parse(JSON.stringify(s.payload)), created_by: actor.userId });
      if (error) return NextResponse.json({ error: `Snapshot failed: ${error.message}` }, { status: 500 });
    }

    // Deactivate siblings (same owner, year, kind), then approve + lock
    let q = admin.from("budget_versions").update({ is_active: false }).eq("fiscal_year", owner.fiscalYear).eq("kind", owner.kind).neq("id", owner.id);
    q = owner.reportingEntityId ? q.eq("reporting_entity_id", owner.reportingEntityId) : q.eq("entity_id", owner.entityId!);
    await q;
    const now = new Date().toISOString();
    const { data: version, error } = await admin
      .from("budget_versions")
      .update({ status: "approved", is_active: true, approved_at: now, approved_by: actor.userId, locked_at: now })
      .eq("id", owner.id)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, version, snapshots: snapshots.map((s) => s.kind) });
  } catch (err) {
    console.error("POST /api/budget/approve error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
