import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, assertOrgMember, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { buildVersionModel } from "@/lib/budget/model";
import { buildMasterWorkbook, type MasterAssumption } from "@/lib/budget/master-export";
import { ASSUMPTION_KEY_MAP } from "@/lib/budget/assumption-keys";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";

// One Financial Model build per group for last year's actuals
export const maxDuration = 120;

interface VersionRow {
  id: string;
  name: string;
  is_active: boolean;
  reporting_entity_id: string | null;
  updated_at: string;
}

/**
 * GET /api/budget/export/master?fiscalYear=2027&kind=budget&through=8
 * The master list workbook (see src/lib/budget/master-export.ts). Last year's
 * months come from the Financial Model, Jan through `through` (the closed
 * months). Groups use the active version, else the most recently updated
 * one, as the consolidated view does.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId") ?? [...actor.orgRoles.keys()][0];
    const fiscalYear = Number(searchParams.get("fiscalYear") ?? new Date().getFullYear() + 1);
    const kind = searchParams.get("kind") === "forecast" ? "forecast" : "budget";
    const through = Math.min(12, Math.max(1, Math.trunc(Number(searchParams.get("through") ?? 8)) || 8));
    if (!Number.isInteger(fiscalYear)) return NextResponse.json({ error: "fiscalYear is required" }, { status: 400 });
    assertOrgMember(actor, organizationId);
    const admin = createAdminClient();

    const { data: reRows, error: reError } = await admin
      .from("reporting_entities")
      .select("id, name, code, exclude_from_breakdown")
      .eq("organization_id", organizationId!)
      .eq("is_active", true)
      .order("name");
    if (reError) throw new Error(reError.message);
    const reList = (reRows ?? []).filter((r) => !r.exclude_from_breakdown);
    const { data: vRows, error: vError } = reList.length
      ? await admin
          .from("budget_versions")
          .select("id, name, is_active, reporting_entity_id, updated_at")
          .in("reporting_entity_id", reList.map((r) => r.id))
          .eq("fiscal_year", fiscalYear)
          .eq("kind", kind)
      : { data: [], error: null };
    if (vError) throw new Error(vError.message);
    const chosen = new Map<string, VersionRow>();
    for (const v of (vRows ?? []) as VersionRow[]) {
      const cur = chosen.get(v.reporting_entity_id!);
      if (!cur || (v.is_active && !cur.is_active) || (v.is_active === cur.is_active && v.updated_at > cur.updated_at)) chosen.set(v.reporting_entity_id!, v);
    }
    const groups = reList.filter((r) => chosen.has(r.id));
    if (!groups.length) return NextResponse.json({ error: `No ${kind} versions for ${fiscalYear}` }, { status: 404 });
    const models = await Promise.all(
      groups.map(async (r) => {
        const owner = await requireVersionAccess(admin, actor, chosen.get(r.id)!.id, false);
        const [model, rows] = await Promise.all([
          buildVersionModel(admin, owner, { withActuals: true }),
          fetchAllPaginated<{ key: string; scope: string; scope_id: string | null; value: number | null; text_value: string | null; source_note: string | null; effective_from: string | null; effective_to: string | null }>((o, l) =>
            admin.from("budget_assumptions").select("key, scope, scope_id, value, text_value, source_note, effective_from, effective_to").eq("budget_version_id", owner.id).order("key").order("scope").order("id").range(o, o + l - 1),
          ),
        ]);
        // Per-line settings (own number, zero months) show on the Detail lines instead
        const assumptions: MasterAssumption[] = rows
          .filter((a) => ASSUMPTION_KEY_MAP.has(a.key))
          .map((a) => {
            const def = ASSUMPTION_KEY_MAP.get(a.key)!;
            // Company scope ids are Paylocity company numbers (see the assumptions page)
            const appliesTo = a.scope === "org" ? "All" : a.scope === "company" ? `Paylocity ${a.scope_id ?? ""}` : `${a.scope} ${a.scope_id ?? ""}`;
            const effective = a.effective_from || a.effective_to ? `${a.effective_from ?? "start"} to ${a.effective_to ?? "end"}` : null;
            return { label: def.label, key: a.key, scope: appliesTo, value: a.value == null ? null : Number(a.value), unit: def.unit, text: a.text_value, note: [effective, a.source_note].filter(Boolean).join("; ") || null };
          });
        return { re: r, version: chosen.get(r.id)!, model, assumptions };
      }),
    );

    const { data: chart } = await admin.from("master_charts").select("id").eq("organization_id", organizationId!).eq("kind", "management").maybeSingle();
    const intercompany = new Set<string>();
    if (chart) {
      // is_intercompany (migration 025) is not in the generated types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: icRows, error } = await (admin as any).from("master_accounts").select("id").eq("chart_id", chart.id).eq("is_intercompany", true);
      if (error) throw new Error(error.message);
      for (const r of (icRows ?? []) as { id: string }[]) intercompany.add(r.id);
    }

    const wb = buildMasterWorkbook({
      fiscalYear,
      kind,
      through,
      groups: models.map((x) => ({ name: x.re.name, versionName: x.version.name, model: x.model, assumptions: x.assumptions })),
      intercompany,
      exportedOn: new Date().toISOString().slice(0, 10),
    });
    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fiscalYear} ${kind === "budget" ? "Budget" : "Forecast"} Master List.xlsx"`,
      },
    });
  } catch (err) {
    console.error("GET /api/budget/export/master error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
