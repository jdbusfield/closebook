import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, assertOrgMember, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { buildVersionModel } from "@/lib/budget/model";
import type { DashboardPayload, DashGroup, DashItem } from "@/lib/budget/dashboard";

// Last year comes from a Financial Model build per group (bounded), as on the consolidated page
export const maxDuration = 120;

interface VersionRow {
  id: string;
  name: string;
  status: string;
  is_active: boolean;
  reporting_entity_id: string | null;
  updated_at: string;
}

/**
 * GET /api/budget/dashboard?fiscalYear=&organizationId=
 * Every reporting group's budget for the year (active version, else the most recently
 * updated), each line with its items, their function / location tags and last year's
 * actuals, for the budget dashboard. The page combines groups itself: All companies
 * leaves out intercompany masters, a single company keeps them.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId") ?? [...actor.orgRoles.keys()][0];
    const fiscalYear = Number(searchParams.get("fiscalYear") ?? new Date().getFullYear() + 1);
    if (!Number.isInteger(fiscalYear)) return NextResponse.json({ error: "fiscalYear is required" }, { status: 400 });
    assertOrgMember(actor, organizationId);
    const admin = createAdminClient();

    const { data: reRows } = await admin
      .from("reporting_entities")
      .select("id, name, code, exclude_from_breakdown")
      .eq("organization_id", organizationId!)
      .eq("is_active", true)
      .order("name");
    const reList = (reRows ?? []).filter((r) => !r.exclude_from_breakdown);
    const { data: vRows } = reList.length
      ? await admin
          .from("budget_versions")
          .select("id, name, status, is_active, reporting_entity_id, updated_at")
          .in("reporting_entity_id", reList.map((r) => r.id))
          .eq("fiscal_year", fiscalYear)
          .eq("kind", "budget")
      : { data: [] };
    const chosen = new Map<string, VersionRow>();
    for (const v of (vRows ?? []) as VersionRow[]) {
      const re = v.reporting_entity_id!;
      const cur = chosen.get(re);
      const better = !cur || (v.is_active && !cur.is_active) || (v.is_active === cur.is_active && v.updated_at > cur.updated_at);
      if (better) chosen.set(re, v);
    }

    const { data: chart } = await admin.from("master_charts").select("id").eq("organization_id", organizationId!).eq("kind", "management").maybeSingle();
    const intercompany = new Set<string>();
    if (chart) {
      // is_intercompany (migration 025) is not in the generated types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: icRows } = await (admin as any).from("master_accounts").select("id").eq("chart_id", chart.id).eq("is_intercompany", true);
      for (const r of (icRows ?? []) as { id: string }[]) intercompany.add(r.id);
    }

    const groups: DashGroup[] = await Promise.all(
      reList
        .filter((r) => chosen.has(r.id))
        .map(async (r) => {
          const v = chosen.get(r.id)!;
          const owner = await requireVersionAccess(admin, actor, v.id, false);
          const model = await buildVersionModel(admin, owner, { withActuals: true });
          const masters = model.sections.flatMap((s) =>
            s.masters
              .filter((m) => m.months.some((x) => Math.abs(x) >= 0.005) || (model.priorYear[m.id] ?? []).some((x) => Math.abs(x) >= 0.005))
              .map((m) => ({
                id: m.id,
                accountNumber: m.accountNumber,
                name: m.name,
                section: s.id,
                intercompany: intercompany.has(m.id),
                months: m.months,
                prior: model.priorYear[m.id] ?? new Array(12).fill(0),
                byFunction: m.byFunction,
                items: m.items.map(
                  (it): DashItem => ({
                    id: it.id,
                    label: it.kind === "run_rate" ? `${m.name} run rate` : it.label,
                    kind: it.kind,
                    source: it.source,
                    sourceHref: it.sourceHref,
                    methodText: it.methodText,
                    note: it.note,
                    count: it.count,
                    months: it.months,
                    total: it.total,
                    parts: it.parts,
                    history: it.history,
                    functions: it.tags?.functions ?? [],
                    locations: it.tags?.locations ?? [],
                    classNames: it.tags?.classNames ?? [],
                    functionOrigin: it.tags?.functionOrigin ?? "none",
                    byFunction: it.tags?.byFunction ?? { Unassigned: it.months },
                    byLocation: it.tags?.byLocation ?? { Unassigned: it.months },
                    people: it.people,
                  }),
                ),
              })),
          );
          return {
            reportingEntityId: r.id,
            code: r.code,
            name: r.name,
            version: { id: v.id, name: v.name, status: v.status, isActive: v.is_active },
            priorYearMonths: model.priorYearMonths,
            priorYearSource: model.priorYearSource,
            masters,
          };
        }),
    );

    const { data: org } = await admin.from("organizations").select("name").eq("id", organizationId!).maybeSingle();
    const payload: DashboardPayload = { fiscalYear, asOf: new Date().toISOString(), organizationName: (org as { name?: string } | null)?.name ?? undefined, groups };
    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/budget/dashboard error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
