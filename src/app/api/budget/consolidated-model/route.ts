import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, assertOrgMember, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { buildVersionModel, type ModelItem } from "@/lib/budget/model";

const zeros = () => new Array(12).fill(0) as number[];
const round = (a: number[]) => a.map((v) => Math.round(v * 100) / 100);
const addInto = (t: number[], s: number[] | undefined) => {
  if (s) for (let i = 0; i < 12; i++) t[i] += s[i];
};

interface VersionRow {
  id: string;
  name: string;
  status: string;
  is_active: boolean;
  reporting_entity_id: string | null;
  updated_at: string;
}

/**
 * GET /api/budget/consolidated-model?fiscalYear=&kind=budget|forecast&organizationId=
 * Read-only roll-up of the reporting groups' models for a year. Per group it
 * uses the active version, else the most recently updated one, so drafts can
 * be seen together before anything is set active. Each line carries the
 * group subtotals and every group's items beneath them. Lines on
 * intercompany masters are left out of the totals and listed apart; the IC
 * allocation items (rent splits, payroll moves) net to zero across groups.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId") ?? [...actor.orgRoles.keys()][0];
    const fiscalYear = Number(searchParams.get("fiscalYear") ?? new Date().getFullYear() + 1);
    const kind = searchParams.get("kind") === "forecast" ? "forecast" : "budget";
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
          .eq("kind", kind)
      : { data: [] };
    const chosen = new Map<string, VersionRow>();
    for (const v of (vRows ?? []) as VersionRow[]) {
      const re = v.reporting_entity_id!;
      const cur = chosen.get(re);
      const better = !cur || (v.is_active && !cur.is_active) || (v.is_active === cur.is_active && v.updated_at > cur.updated_at);
      if (better) chosen.set(re, v);
    }

    const groupsWithVersion = reList.filter((r) => chosen.has(r.id));
    const models = await Promise.all(
      groupsWithVersion.map(async (r) => {
        const owner = await requireVersionAccess(admin, actor, chosen.get(r.id)!.id, false);
        return { re: r, model: await buildVersionModel(admin, owner, { withActuals: true }) };
      }),
    );

    // Intercompany masters drop out of the consolidated lines
    const { data: chart } = await admin.from("master_charts").select("id").eq("organization_id", organizationId!).eq("kind", "management").maybeSingle();
    const intercompany = new Set<string>();
    if (chart) {
      // is_intercompany (migration 025) is not in the generated types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: icRows } = await (admin as any).from("master_accounts").select("id").eq("chart_id", chart.id).eq("is_intercompany", true);
      for (const r of (icRows ?? []) as { id: string }[]) intercompany.add(r.id);
    }

    type GroupLine = { reportingEntityId: string; code: string; name: string; versionId: string; months: number[]; total: number; priorYear: number[] | null; items: ModelItem[] };
    type Line = { id: string; accountNumber: string | null; name: string; months: number[]; priorYear: number[]; groups: GroupLine[] };
    const sectionMeta = new Map<string, { id: string; title: string; model: boolean; order: number }>();
    const linesBySection = new Map<string, Map<string, Line>>();
    const eliminated: Array<{ id: string; accountNumber: string | null; name: string; section: string; groups: Array<{ code: string; total: number }>; total: number }> = [];
    const elimById = new Map<string, (typeof eliminated)[number]>();

    for (const { re, model } of models) {
      model.sections.forEach((s, order) => {
        if (!sectionMeta.has(s.id)) sectionMeta.set(s.id, { id: s.id, title: s.title, model: s.model, order });
        const lines = linesBySection.get(s.id) ?? new Map<string, Line>();
        for (const m of s.masters) {
          const has = m.months.some((v) => v !== 0) || m.items.length > 0 || (model.priorYear[m.id] ?? []).some((v) => v !== 0);
          if (intercompany.has(m.id)) {
            const t = m.months.reduce((a, v) => a + v, 0);
            if (Math.abs(t) < 0.005) continue;
            const e = elimById.get(m.id) ?? { id: m.id, accountNumber: m.accountNumber, name: m.name, section: s.id, groups: [], total: 0 };
            e.groups.push({ code: re.code, total: Math.round(t * 100) / 100 });
            e.total = Math.round((e.total + t) * 100) / 100;
            if (!elimById.has(m.id)) {
              elimById.set(m.id, e);
              eliminated.push(e);
            }
            continue;
          }
          const line = lines.get(m.id) ?? { id: m.id, accountNumber: m.accountNumber, name: m.name, months: zeros(), priorYear: zeros(), groups: [] };
          addInto(line.months, m.months);
          addInto(line.priorYear, model.priorYear[m.id]);
          if (has) {
            line.groups.push({
              reportingEntityId: re.id,
              code: re.code,
              name: re.name,
              versionId: model.version.id,
              months: round(m.months),
              total: Math.round(m.months.reduce((a, v) => a + v, 0) * 100) / 100,
              priorYear: model.priorYear[m.id] ?? null,
              items: m.items.map((it) => ({ ...it, id: `${re.code}:${it.id}` })),
            });
          }
          lines.set(m.id, line);
        }
        linesBySection.set(s.id, lines);
      });
    }

    const sections = [...sectionMeta.values()]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        ...s,
        masters: [...(linesBySection.get(s.id)?.values() ?? [])].map((l) => ({ ...l, months: round(l.months), priorYear: round(l.priorYear) })),
      }));

    // Below EBITDA from the consolidated (IC-free) lines, the same net the Model page shows
    const below = zeros();
    const belowPrior = zeros();
    for (const s of sections) {
      if (s.id !== "other_expense" && s.id !== "other_income") continue;
      const sign = s.id === "other_expense" ? 1 : -1;
      for (const m of s.masters) for (let i = 0; i < 12; i++) {
        below[i] += m.months[i] * sign;
        belowPrior[i] += m.priorYear[i] * sign;
      }
    }

    return NextResponse.json({
      fiscalYear,
      kind,
      groups: reList.map((r) => {
        const v = chosen.get(r.id);
        return {
          reportingEntityId: r.id,
          code: r.code,
          name: r.name,
          version: v ? { id: v.id, name: v.name, status: v.status, isActive: v.is_active } : null,
        };
      }),
      sections: sections.filter((s) => s.model),
      belowEbitda: { months: round(below), priorYear: round(belowPrior) },
      eliminated,
    });
  } catch (err) {
    console.error("GET /api/budget/consolidated-model error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
