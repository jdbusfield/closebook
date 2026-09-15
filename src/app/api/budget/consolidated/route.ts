import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, assertOrgMember, getBudgetActor } from "@/lib/budget/access";
import { fetchBudgetAmountRows, resolveActiveVersions, rollupBudgetToParents } from "@/lib/budget/versions";
import { loadMasters } from "@/lib/budget/actuals";
import { INCOME_STATEMENT_SECTIONS } from "@/lib/config/statement-sections";

/**
 * GET /api/budget/consolidated?fiscalYear=&kind=budget|forecast&organizationId=
 * Active versions for the year per reporting group, summed by statement
 * section and by master, plus the organization total. Intercompany lines
 * (masters flagged is_intercompany) are excluded from the org total.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId") ?? [...actor.orgRoles.keys()][0];
    const fiscalYear = Number(searchParams.get("fiscalYear") ?? new Date().getFullYear() + 1);
    const kind = searchParams.get("kind") === "forecast" ? "forecast" : "budget";
    assertOrgMember(actor, organizationId);
    const admin = createAdminClient();

    const { data: chart } = await admin.from("master_charts").select("id").eq("organization_id", organizationId!).eq("kind", "management").maybeSingle();
    if (!chart) return NextResponse.json({ error: "Management chart not found" }, { status: 404 });
    const masters = await loadMasters(admin, chart.id);
    // is_intercompany (migration 025) is not in the generated types
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: icRows } = await (admin as any).from("master_accounts").select("id, is_intercompany").eq("chart_id", chart.id).eq("is_intercompany", true);
    const intercompany = new Set(((icRows ?? []) as { id: string }[]).map((r) => r.id));

    const [{ data: res }, { data: members }, { data: ents }] = await Promise.all([
      admin.from("reporting_entities").select("id, name, code, exclude_from_breakdown").eq("organization_id", organizationId!).eq("is_active", true).order("name"),
      admin.from("reporting_entity_members").select("reporting_entity_id, entity_id"),
      admin.from("entities").select("id").eq("organization_id", organizationId!),
    ]);
    const reList = (res ?? []).filter((r) => !r.exclude_from_breakdown);
    const versions = await resolveActiveVersions(admin, {
      organizationId: organizationId!,
      years: [fiscalYear],
      kind,
      scope: "organization",
      entityIds: (ents ?? []).map((e) => e.id),
    });
    const rows = await fetchBudgetAmountRows(admin, versions.map((v) => v.id), { years: [fiscalYear] });

    // version -> RE (entity versions map to the RE containing the entity)
    const reOfEntity = new Map<string, string>();
    for (const m of members ?? []) if (reList.some((r) => r.id === m.reporting_entity_id)) reOfEntity.set(m.entity_id, m.reporting_entity_id);
    const reOfVersion = new Map<string, string | null>();
    for (const v of versions) reOfVersion.set(v.id, v.reportingEntityId ?? (v.entityId ? reOfEntity.get(v.entityId) ?? null : null));

    const perRe = new Map<string, Map<string, Record<string, number>>>(); // re -> master -> month key -> amount
    for (const r of rows) {
      const re = reOfVersion.get(r.budget_version_id) ?? "unassigned";
      const byMaster = perRe.get(re) ?? new Map();
      const cell = byMaster.get(r.master_account_id) ?? {};
      cell[String(r.period_month)] = (cell[String(r.period_month)] ?? 0) + Number(r.amount);
      byMaster.set(r.master_account_id, cell);
      perRe.set(re, byMaster);
    }
    const parentRefs = masters.map((m) => ({ id: m.id, parentAccountId: m.parentAccountId }));
    const displayMasters = masters.filter((m) => (m.classification === "Revenue" || m.classification === "Expense") && !m.parentAccountId);

    const sectionOf = (m: { classification: string; accountType: string }) =>
      INCOME_STATEMENT_SECTIONS.find((s) => s.classification === m.classification && s.accountTypes.includes(m.accountType))?.id ?? "other";

    const groups = [...reList.map((r) => ({ id: r.id, name: r.name, code: r.code })), { id: "unassigned", name: "Unassigned", code: "" }]
      .filter((g) => perRe.has(g.id))
      .map((g) => {
        const byMaster = rollupBudgetToParents(perRe.get(g.id)!, parentRefs);
        const lines = displayMasters.map((m) => {
          const cell = byMaster.get(m.id) ?? {};
          const months = Array.from({ length: 12 }, (_, i) => Math.round((cell[String(i + 1)] ?? 0) * 100) / 100);
          return { masterId: m.id, accountNumber: m.accountNumber, name: m.name, section: sectionOf(m), intercompany: intercompany.has(m.id), months, total: Math.round(months.reduce((t, v) => t + v, 0) * 100) / 100 };
        }).filter((l) => l.total !== 0 || l.months.some((v) => v !== 0));
        const sections: Record<string, number[]> = {};
        for (const l of lines) {
          const arr = sections[l.section] ?? new Array(12).fill(0);
          for (let i = 0; i < 12; i++) arr[i] += l.months[i];
          sections[l.section] = arr;
        }
        return { ...g, versionIds: versions.filter((v) => reOfVersion.get(v.id) === g.id).map((v) => v.id), lines, sections };
      });

    // Organization total without intercompany lines
    const orgSections: Record<string, number[]> = {};
    const orgLines = new Map<string, { masterId: string; accountNumber: string | null; name: string; section: string; months: number[] }>();
    for (const g of groups) {
      for (const l of g.lines) {
        if (l.intercompany) continue;
        const e = orgLines.get(l.masterId) ?? { masterId: l.masterId, accountNumber: l.accountNumber, name: l.name, section: l.section, months: new Array(12).fill(0) };
        for (let i = 0; i < 12; i++) e.months[i] += l.months[i];
        orgLines.set(l.masterId, e);
        const arr = orgSections[l.section] ?? new Array(12).fill(0);
        for (let i = 0; i < 12; i++) arr[i] += l.months[i];
        orgSections[l.section] = arr;
      }
    }

    return NextResponse.json({
      fiscalYear,
      kind,
      groups,
      organization: { sections: orgSections, lines: [...orgLines.values()].map((l) => ({ ...l, total: l.months.reduce((t, v) => t + v, 0) })) },
      sectionOrder: INCOME_STATEMENT_SECTIONS.map((s) => ({ id: s.id, title: s.title || s.id.replace(/_/g, " ") })),
    });
  } catch (err) {
    console.error("GET /api/budget/consolidated error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
