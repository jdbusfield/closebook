import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessErrorResponse, assertOrgMember, getBudgetActor, requireVersionAccess } from "@/lib/budget/access";
import { addMatrixSheet, addSheet, createWorkbook, NUMBER_FORMATS, type MatrixRow } from "@/lib/utils/excel";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { loadMasters, rollupActualsToParents, loadMonthlyActuals, monthKey } from "@/lib/budget/actuals";
import { loadMemberEntityIds, loadPlanHeadcountForVersion, resolveVersionChartId } from "@/lib/budget/recompute";
import { fetchBudgetAmountRows, resolveActiveVersions, rollupBudgetToParents } from "@/lib/budget/versions";
import { INCOME_STATEMENT_SECTIONS } from "@/lib/config/statement-sections";
import { MONTH_ABBRS } from "@/lib/budget/format";
import { readSplits, splitLabel } from "@/lib/budget/tagging";

export const maxDuration = 120;

const MONTH_COLS = MONTH_ABBRS.map((m) => ({ header: m, width: 12, format: NUMBER_FORMATS.currencyWhole }));
const TOTAL_COL = { header: "Total", width: 14, format: NUMBER_FORMATS.currencyWhole };

function sectionTitle(id: string, title: string): string {
  if (title) return title;
  return id === "other_expense" ? "Other Expense" : id === "other_income" ? "Other Income" : id;
}

function xlsxResponse(buffer: ArrayBuffer, filename: string): NextResponse {
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * GET /api/budget/export?versionId=            one version (lines, headcount, builds)
 * GET /api/budget/export?fiscalYear=&kind=     consolidated: one sheet per reporting group + organization
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const versionId = searchParams.get("versionId");
    const admin = createAdminClient();

    if (versionId) {
      const owner = await requireVersionAccess(admin, actor, versionId, false);
      const [{ data: version }, memberSet, chartId] = await Promise.all([
        admin.from("budget_versions").select("name, fiscal_year, kind, status").eq("id", owner.id).single(),
        loadMemberEntityIds(admin, owner),
        resolveVersionChartId(admin, owner),
      ]);
      const masters = await loadMasters(admin, chartId);
      const [rows, headcount, builds] = await Promise.all([
        fetchBudgetAmountRows(admin, [owner.id], { years: [owner.fiscalYear] }),
        loadPlanHeadcountForVersion(admin, owner) as unknown as Promise<Record<string, unknown>[]>,
        fetchAllPaginated<Record<string, unknown>>((o, l) => admin.from("budget_builds").select("*").eq("budget_version_id", owner.id).order("build_type").order("label").range(o, o + l - 1)),
      ]);
      let ownerName = "";
      if (owner.reportingEntityId) {
        const { data: re } = await admin.from("reporting_entities").select("name").eq("id", owner.reportingEntityId).maybeSingle();
        ownerName = re?.name ?? "";
      } else if (owner.entityId) {
        const { data: e } = await admin.from("entities").select("name").eq("id", owner.entityId).maybeSingle();
        ownerName = e?.name ?? "";
      }

      // Prior-year actuals for the comparison column
      const entityIds = [...memberSet];
      let prior = new Map<string, Map<string, number>>();
      if (entityIds.length) {
        const a = await loadMonthlyActuals(admin, { chartId, entityIds, startYear: owner.fiscalYear - 1, startMonth: 1, endYear: owner.fiscalYear - 1, endMonth: 12, masters });
        prior = rollupActualsToParents(a.byMaster, masters);
      }

      const byMaster = new Map<string, Record<string, number>>();
      for (const r of rows) {
        const cell = byMaster.get(r.master_account_id) ?? {};
        cell[String(r.period_month)] = (cell[String(r.period_month)] ?? 0) + Number(r.amount);
        byMaster.set(r.master_account_id, cell);
      }
      rollupBudgetToParents(byMaster, masters.map((m) => ({ id: m.id, parentAccountId: m.parentAccountId })));

      const wb = createWorkbook({ title: `${ownerName} ${version?.name ?? "Budget"}` });
      const matrixRows: MatrixRow[] = [];
      const sections: { afterRowIndex: number; title: string }[] = [];
      const sectionTotals: Record<string, number[]> = {};
      for (const s of INCOME_STATEMENT_SECTIONS) {
        const ms = masters.filter((m) => m.classification === s.classification && s.accountTypes.includes(m.accountType) && !m.parentAccountId);
        sections.push({ afterRowIndex: matrixRows.length - 1, title: sectionTitle(s.id, s.title) });
        const total = new Array(12).fill(0);
        for (const m of ms) {
          const cell = byMaster.get(m.id);
          const values = Array.from({ length: 12 }, (_, i) => Math.round((cell?.[String(i + 1)] ?? 0) * 100) / 100);
          if (values.every((v) => v === 0)) continue;
          for (let i = 0; i < 12; i++) total[i] += values[i];
          const py = prior.get(m.id);
          const pyTotal = py ? Array.from({ length: 12 }, (_, i) => py.get(monthKey(owner.fiscalYear - 1, i + 1)) ?? 0).reduce((t, v) => t + v, 0) : 0;
          matrixRows.push({ label: `${m.accountNumber ?? ""} ${m.name}`.trim(), values: [...values, values.reduce((t, v) => t + v, 0), Math.round(pyTotal)], indent: 1 });
        }
        sectionTotals[s.id] = total;
        matrixRows.push({ label: `Total ${sectionTitle(s.id, s.title).toLowerCase()}`, values: [...total, total.reduce((t, v) => t + v, 0), null], totalStyle: true });
        if (s.id === "direct_operating_costs") {
          const g = sectionTotals.revenue.map((v, i) => v - total[i]);
          matrixRows.push({ label: "Gross margin", values: [...g, g.reduce((t, v) => t + v, 0), null], bold: true });
        }
        if (s.id === "other_operating_costs") {
          const op = sectionTotals.revenue.map((v, i) => v - sectionTotals.direct_operating_costs[i] - total[i]);
          matrixRows.push({ label: "Operating margin", values: [...op, op.reduce((t, v) => t + v, 0), null], bold: true });
        }
      }
      const net = sectionTotals.revenue.map((v, i) => v - sectionTotals.direct_operating_costs[i] - sectionTotals.other_operating_costs[i] - sectionTotals.other_expense[i] + sectionTotals.other_income[i]);
      matrixRows.push({ label: "Net income", values: [...net, net.reduce((t, v) => t + v, 0), null], bold: true, totalStyle: true });

      addMatrixSheet(wb, {
        name: "Lines",
        title: { entityName: ownerName, reportTitle: `${version?.name ?? "Budget"} (${version?.kind ?? "budget"}, ${version?.status ?? ""})`, period: `Fiscal year ${owner.fiscalYear}` },
        labelColumn: { header: "Account", width: 44 },
        periodColumns: [...MONTH_COLS, TOTAL_COL, { header: `${owner.fiscalYear - 1} actual`, width: 14, format: NUMBER_FORMATS.currencyWhole }],
        rows: matrixRows,
        sections,
      });

      addSheet(wb, {
        name: "Headcount",
        title: { entityName: ownerName, reportTitle: "Headcount plan", period: `Fiscal year ${owner.fiscalYear}` },
        rows: headcount,
        columns: [
          { header: "Location", width: 18, value: (r) => splitLabel(readSplits(r.location_allocations)) },
          { header: "Class", width: 22, value: (r) => splitLabel(readSplits(r.class_allocations, "class")) },
          { header: "Function", width: 18, value: (r) => splitLabel(readSplits(r.function_allocations)) },
          { header: "Name", width: 28, value: (r) => String(r.name ?? "") },
          { header: "Share", width: 8, value: (r) => (r.share as number) ?? null, format: NUMBER_FORMATS.number },
          { header: "Title", width: 22, value: (r) => (r.title as string) ?? "" },
          { header: "Department", width: 18, value: (r) => (r.department as string) ?? "" },
          { header: "Status", width: 12, value: (r) => String(r.status ?? "") },
          { header: "Planned", width: 9, value: (r) => (r.is_requisition ? "Yes" : "") },
          { header: "Pay type", width: 10, value: (r) => String(r.pay_type ?? "") },
          { header: "Rate", width: 10, value: (r) => (r.base_rate as number) ?? null, format: NUMBER_FORMATS.currency },
          { header: "Salary", width: 12, value: (r) => (r.annual_salary as number) ?? null, format: NUMBER_FORMATS.currencyWhole },
          { header: "Hrs/wk", width: 8, value: (r) => (r.std_hours_week as number) ?? null, format: NUMBER_FORMATS.number },
          { header: "FTE %", width: 8, value: (r) => (r.fte_pct as number) ?? null, format: NUMBER_FORMATS.number },
          { header: "Start", width: 7, value: (r) => (r.start_month as number) ?? null },
          { header: "End", width: 7, value: (r) => (r.end_month as number) ?? null },
          { header: "Amount/mo", width: 11, value: (r) => (r.amount_monthly as number) ?? null, format: NUMBER_FORMATS.currencyWhole },
          { header: "Adjustment", width: 11, value: (r) => (r.comp_adj_kind as string) ?? "" },
          { header: "Adj value", width: 10, value: (r) => (r.comp_adj_value as number) ?? null, format: NUMBER_FORMATS.number },
          { header: "Adj month", width: 9, value: (r) => (r.comp_adj_month as number) ?? null },
          { header: "Adj reason", width: 22, value: (r) => (r.comp_adj_reason as string) ?? "" },
          { header: "Bonus", width: 11, value: (r) => (r.bonus_target as number) ?? null, format: NUMBER_FORMATS.currencyWhole, total: "sum" },
          { header: "Commission", width: 11, value: (r) => (r.commission_annual as number) ?? null, format: NUMBER_FORMATS.currencyWhole, total: "sum" },
          { header: "OT %", width: 8, value: (r) => (r.ot_pct as number) ?? null, format: NUMBER_FORMATS.number },
          { header: "DT %", width: 8, value: (r) => (r.dt_pct as number) ?? null, format: NUMBER_FORMATS.number },
          { header: "Meal %", width: 8, value: (r) => (r.meal_pct as number) ?? null, format: NUMBER_FORMATS.number },
          { header: "Benefits/mo", width: 11, value: (r) => (r.benefits_monthly as number) ?? null, format: NUMBER_FORMATS.currencyWhole, total: "sum" },
          { header: "Match %", width: 8, value: (r) => (r.match_pct as number) ?? null, format: NUMBER_FORMATS.number },
          { header: "WC class", width: 9, value: (r) => (r.wc_class_code as string) ?? "" },
          { header: "PTO h/per", width: 9, value: (r) => (r.pto_hours_per_period as number) ?? null, format: NUMBER_FORMATS.number },
          { header: "Entity allocations", width: 30, value: (r) => JSON.stringify(r.entity_allocations ?? []) },
          { header: "Class allocations", width: 30, value: (r) => JSON.stringify(r.class_allocations ?? []) },
          { header: "Notes", width: 30, value: (r) => (r.notes as string) ?? "" },
        ],
      });

      const masterName = new Map(masters.map((m) => [m.id, `${m.accountNumber ?? ""} ${m.name}`.trim()]));
      addSheet(wb, {
        name: "Builds",
        title: { entityName: ownerName, reportTitle: "Builds beneath each line", period: `Fiscal year ${owner.fiscalYear}` },
        rows: builds,
        columns: [
          { header: "Type", width: 11, value: (r) => String(r.build_type ?? "") },
          { header: "Account", width: 36, value: (r) => masterName.get(String(r.master_account_id)) ?? "" },
          { header: "Item", width: 44, value: (r) => String(r.label ?? "") },
          { header: "Component", width: 16, value: (r) => (r.component as string) ?? "" },
          ...MONTH_ABBRS.map((m, i) => ({ header: m, width: 11, value: (r: Record<string, unknown>) => Number((r.amounts as Record<string, number>)?.[String(i + 1)] ?? 0), format: NUMBER_FORMATS.currencyWhole, total: "sum" as const })),
          { header: "Total", width: 13, value: (r) => Object.values((r.amounts as Record<string, number>) ?? {}).reduce((t, v) => t + Number(v ?? 0), 0), format: NUMBER_FORMATS.currencyWhole, total: "sum" },
          { header: "Note", width: 30, value: (r) => (r.note as string) ?? "" },
        ],
      });

      const buffer = await wb.xlsx.writeBuffer();
      const safe = `${ownerName} ${version?.name ?? "budget"}`.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "");
      return xlsxResponse(buffer as ArrayBuffer, `budget_${safe}.xlsx`);
    }

    // Consolidated export
    const organizationId = searchParams.get("organizationId") ?? [...actor.orgRoles.keys()][0];
    const fiscalYear = Number(searchParams.get("fiscalYear") ?? new Date().getFullYear() + 1);
    const kind = searchParams.get("kind") === "forecast" ? "forecast" : "budget";
    assertOrgMember(actor, organizationId);
    const { data: chart } = await admin.from("master_charts").select("id").eq("organization_id", organizationId!).eq("kind", "management").maybeSingle();
    if (!chart) return NextResponse.json({ error: "Management chart not found" }, { status: 404 });
    const masters = await loadMasters(admin, chart.id);
    const [{ data: res }, { data: members }, { data: ents }, { data: org }] = await Promise.all([
      admin.from("reporting_entities").select("id, name, code, exclude_from_breakdown").eq("organization_id", organizationId!).eq("is_active", true).order("name"),
      admin.from("reporting_entity_members").select("reporting_entity_id, entity_id"),
      admin.from("entities").select("id").eq("organization_id", organizationId!),
      admin.from("organizations").select("name").eq("id", organizationId!).maybeSingle(),
    ]);
    const reList = (res ?? []).filter((r) => !r.exclude_from_breakdown);
    const versions = await resolveActiveVersions(admin, { organizationId: organizationId!, years: [fiscalYear], kind, scope: "organization", entityIds: (ents ?? []).map((e) => e.id) });
    const rows = await fetchBudgetAmountRows(admin, versions.map((v) => v.id), { years: [fiscalYear] });
    const reOfEntity = new Map<string, string>();
    for (const m of members ?? []) reOfEntity.set(m.entity_id, m.reporting_entity_id);
    const reOfVersion = new Map<string, string>();
    for (const v of versions) reOfVersion.set(v.id, v.reportingEntityId ?? (v.entityId ? reOfEntity.get(v.entityId) ?? "unassigned" : "unassigned"));
    const perRe = new Map<string, Map<string, Record<string, number>>>();
    for (const r of rows) {
      const re = reOfVersion.get(r.budget_version_id) ?? "unassigned";
      const bm = perRe.get(re) ?? new Map();
      const cell = bm.get(r.master_account_id) ?? {};
      cell[String(r.period_month)] = (cell[String(r.period_month)] ?? 0) + Number(r.amount);
      bm.set(r.master_account_id, cell);
      perRe.set(re, bm);
    }
    const parentRefs = masters.map((m) => ({ id: m.id, parentAccountId: m.parentAccountId }));
    const wb = createWorkbook({ title: `Consolidated ${kind} ${fiscalYear}` });
    const orgTotals = new Map<string, number[]>();
    const sheetFor = (name: string, byMaster: Map<string, Record<string, number>>, accumulate: boolean) => {
      const matrixRows: MatrixRow[] = [];
      const sections: { afterRowIndex: number; title: string }[] = [];
      for (const s of INCOME_STATEMENT_SECTIONS) {
        sections.push({ afterRowIndex: matrixRows.length - 1, title: sectionTitle(s.id, s.title) });
        const total = new Array(12).fill(0);
        for (const m of masters.filter((m) => m.classification === s.classification && s.accountTypes.includes(m.accountType) && !m.parentAccountId)) {
          const cell = byMaster.get(m.id);
          const values = Array.from({ length: 12 }, (_, i) => Math.round((cell?.[String(i + 1)] ?? 0) * 100) / 100);
          if (values.every((v) => v === 0)) continue;
          for (let i = 0; i < 12; i++) total[i] += values[i];
          if (accumulate) {
            const acc = orgTotals.get(m.id) ?? new Array(12).fill(0);
            for (let i = 0; i < 12; i++) acc[i] += values[i];
            orgTotals.set(m.id, acc);
          }
          matrixRows.push({ label: `${m.accountNumber ?? ""} ${m.name}`.trim(), values: [...values, values.reduce((t, v) => t + v, 0)], indent: 1 });
        }
        matrixRows.push({ label: `Total ${sectionTitle(s.id, s.title).toLowerCase()}`, values: [...total, total.reduce((t, v) => t + v, 0)], totalStyle: true });
      }
      addMatrixSheet(wb, {
        name: name.slice(0, 31),
        title: { entityName: org?.name ?? null, reportTitle: `${name} ${kind} ${fiscalYear}`, period: `Fiscal year ${fiscalYear}` },
        labelColumn: { header: "Account", width: 44 },
        periodColumns: [...MONTH_COLS, TOTAL_COL],
        rows: matrixRows,
        sections,
      });
    };
    for (const re of reList) {
      const bm = perRe.get(re.id);
      if (!bm) continue;
      sheetFor(re.name, rollupBudgetToParents(bm, parentRefs), true);
    }
    if (perRe.has("unassigned")) sheetFor("Unassigned", rollupBudgetToParents(perRe.get("unassigned")!, parentRefs), true);
    const orgMap = new Map<string, Record<string, number>>();
    for (const [id, arr] of orgTotals) orgMap.set(id, Object.fromEntries(arr.map((v, i) => [String(i + 1), v])));
    sheetFor("Organization", orgMap, false);

    const buffer = await wb.xlsx.writeBuffer();
    return xlsxResponse(buffer as ArrayBuffer, `budget_consolidated_${fiscalYear}_${kind}.xlsx`);
  } catch (err) {
    console.error("GET /api/budget/export error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
