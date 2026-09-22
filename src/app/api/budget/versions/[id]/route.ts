import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { loadPlanHeadcountForVersion } from "@/lib/budget/recompute";

/** GET /api/budget/versions/[id]: version row, owner name, member entities, counts */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const actor = await getBudgetActor();
    const admin = createAdminClient();
    const owner = await requireVersionAccess(admin, actor, id, false);

    const { data: version } = await admin.from("budget_versions").select("*").eq("id", id).single();
    let ownerName = "";
    let ownerCode = "";
    let memberEntities: Array<{ id: string; name: string; code: string }> = [];
    if (owner.reportingEntityId) {
      const { data: re } = await admin
        .from("reporting_entities")
        .select("name, code")
        .eq("id", owner.reportingEntityId)
        .maybeSingle();
      ownerName = re?.name ?? "";
      ownerCode = re?.code ?? "";
      const { data: members } = await admin
        .from("reporting_entity_members")
        .select("entity_id, entities(id, name, code)")
        .eq("reporting_entity_id", owner.reportingEntityId);
      memberEntities = (members ?? [])
        .map((m) => m.entities as unknown as { id: string; name: string; code: string } | null)
        .filter((e): e is { id: string; name: string; code: string } => !!e);
    } else if (owner.entityId) {
      const { data: e } = await admin.from("entities").select("id, name, code").eq("id", owner.entityId).maybeSingle();
      ownerName = e?.name ?? "";
      ownerCode = e?.code ?? "";
      if (e) memberEntities = [e];
    }

    const count = async (table: "budget_headcount" | "budget_builds" | "budget_amounts" | "budget_assumptions") => {
      const { count: c } = await admin.from(table).select("id", { count: "exact", head: true }).eq("budget_version_id", id);
      return c ?? 0;
    };
    const [planRows, builds, lines, assumptions] = await Promise.all([
      loadPlanHeadcountForVersion(admin, owner), count("budget_builds"), count("budget_amounts"), count("budget_assumptions"),
    ]);
    const headcount = planRows.length;

    return NextResponse.json({
      version,
      owner: { ...owner, ownerName, ownerCode },
      memberEntities,
      counts: { headcount, builds, lines, assumptions },
      canEdit: ["admin", "controller", "preparer"].includes(actor.orgRoles.get(owner.organizationId ?? "") ?? ""),
    });
  } catch (err) {
    console.error("GET /api/budget/versions/[id] error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
