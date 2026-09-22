import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  accessErrorResponse,
  assertOrgEditor,
  assertOrgMember,
  getBudgetActor,
  organizationForReportingEntity,
  requireVersionAccess,
} from "@/lib/budget/access";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { loadMasters, loadMonthlyActuals } from "@/lib/budget/actuals";
import { upsertBudgetCells, type BudgetCell } from "@/lib/budget/amounts";
import { loadVersionOwner } from "@/lib/budget/access";
import { loadPlanHeadcountForVersion } from "@/lib/budget/recompute";

/**
 * GET /api/budget/versions?organizationId=&fiscalYear=
 * Every version the member can see (reporting-entity and legacy entity
 * versions), with owner names and row counts.
 */
export async function GET(request: Request) {
  try {
    const actor = await getBudgetActor();
    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId") ?? [...actor.orgRoles.keys()][0];
    const fiscalYear = searchParams.get("fiscalYear");
    assertOrgMember(actor, organizationId);

    const admin = createAdminClient();
    const [{ data: res }, { data: ents }] = await Promise.all([
      admin.from("reporting_entities").select("id, name, code, is_active, exclude_from_breakdown").eq("organization_id", organizationId),
      admin.from("entities").select("id, name, code, organization_id").eq("organization_id", organizationId),
    ]);
    const reIds = (res ?? []).map((r) => r.id);
    const entityIds = (ents ?? []).map((e) => e.id);

    let q = admin
      .from("budget_versions")
      .select("*")
      .or(
        [
          reIds.length ? `reporting_entity_id.in.(${reIds.join(",")})` : null,
          entityIds.length ? `entity_id.in.(${entityIds.join(",")})` : null,
        ]
          .filter(Boolean)
          .join(","),
      )
      .order("fiscal_year", { ascending: false })
      .order("created_at", { ascending: false });
    if (fiscalYear) q = q.eq("fiscal_year", Number(fiscalYear));
    const { data: versions, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const versionIds = (versions ?? []).map((v) => v.id);
    const counts = new Map<string, { headcount: number; builds: number; lines: number }>();
    for (const id of versionIds) counts.set(id, { headcount: 0, builds: 0, lines: 0 });
    if (versionIds.length > 0) {
      const [bl, ln] = await Promise.all([
        fetchAllPaginated<{ budget_version_id: string | null }>((o, l) =>
          admin.from("budget_builds").select("budget_version_id").in("budget_version_id", versionIds).range(o, o + l - 1)),
        fetchAllPaginated<{ budget_version_id: string | null }>((o, l) =>
          admin.from("budget_amounts").select("budget_version_id").in("budget_version_id", versionIds).range(o, o + l - 1)),
      ]);
      for (const r of bl) if (r.budget_version_id) counts.get(r.budget_version_id)!.builds++;
      for (const r of ln) if (r.budget_version_id) counts.get(r.budget_version_id)!.lines++;
      // Headcount is each version's share of the shared payroll plan
      await Promise.all(
        (versions ?? []).map(async (v) => {
          const rows = await loadPlanHeadcountForVersion(admin, {
            id: v.id,
            organizationId,
            entityId: v.entity_id ?? null,
            reportingEntityId: v.reporting_entity_id ?? null,
            fiscalYear: v.fiscal_year,
            kind: v.kind ?? "budget",
            lockedAt: v.locked_at ?? null,
            chartId: v.chart_id ?? null,
          });
          counts.get(v.id)!.headcount = rows.length;
        }),
      );
    }

    // Shared payroll plans by year, for the list page
    const { data: plans } = await admin
      .from("budget_payroll_plans")
      .select("id, fiscal_year, status, revenue_shares_as_of")
      .eq("organization_id", organizationId);
    const planRowCounts = new Map<string, number>();
    for (const p of plans ?? []) {
      const { count } = await admin.from("budget_headcount").select("id", { count: "exact", head: true }).eq("payroll_plan_id", p.id);
      planRowCounts.set(p.id, count ?? 0);
    }

    const reById = new Map((res ?? []).map((r) => [r.id, r]));
    const entById = new Map((ents ?? []).map((e) => [e.id, e]));
    const out = (versions ?? []).map((v) => ({
      ...v,
      ownerName: v.reporting_entity_id
        ? reById.get(v.reporting_entity_id)?.name ?? "Reporting entity"
        : entById.get(v.entity_id ?? "")?.name ?? "Entity",
      ownerCode: v.reporting_entity_id
        ? reById.get(v.reporting_entity_id)?.code ?? ""
        : entById.get(v.entity_id ?? "")?.code ?? "",
      ownerType: v.reporting_entity_id ? "reporting_entity" : "entity",
      counts: counts.get(v.id),
    }));

    return NextResponse.json({
      organizationId,
      reportingEntities: (res ?? []).filter((r) => r.is_active !== false && !r.exclude_from_breakdown),
      plans: (plans ?? []).map((p) => ({ ...p, rowCount: planRowCounts.get(p.id) ?? 0 })),
      versions: out,
    });
  } catch (err) {
    console.error("GET /api/budget/versions error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/**
 * POST /api/budget/versions
 * Body: { reportingEntityId, fiscalYear, name, kind?: "budget"|"forecast", notes?, baseVersionId?, forecastThroughMonth? }
 * With baseVersionId the new version starts as a copy of the base
 * (assumptions, headcount, builds, lines, notes).
 */
export async function POST(request: Request) {
  try {
    const actor = await getBudgetActor();
    const body = await request.json();
    const { reportingEntityId, fiscalYear, name, notes, baseVersionId, forecastThroughMonth } = body ?? {};
    const kind: "budget" | "forecast" = body?.kind === "forecast" ? "forecast" : "budget";
    if (!reportingEntityId || !fiscalYear || !name) {
      return NextResponse.json({ error: "reportingEntityId, fiscalYear and name are required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const organizationId = await organizationForReportingEntity(admin, reportingEntityId);
    assertOrgEditor(actor, organizationId);

    const { data: chart } = await admin
      .from("master_charts")
      .select("id")
      .eq("organization_id", organizationId!)
      .eq("kind", "management")
      .maybeSingle();

    const { data: version, error } = await admin
      .from("budget_versions")
      .insert({
        reporting_entity_id: reportingEntityId,
        organization_id: organizationId,
        name: String(name),
        fiscal_year: Number(fiscalYear),
        kind,
        notes: notes ?? null,
        base_version_id: baseVersionId ?? null,
        chart_id: chart?.id ?? null,
        forecast_through_month: kind === "forecast" ? Number(forecastThroughMonth ?? 0) : null,
        created_by: actor.userId,
      })
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let copied: Record<string, number> | undefined;
    if (baseVersionId) {
      await requireVersionAccess(admin, actor, baseVersionId, false);
      copied = await copyVersionContents(admin, baseVersionId, version.id, {
        reportingEntityId,
        fiscalYear: Number(fiscalYear),
        chartId: chart?.id ?? null,
      });
    }

    // Forecast: months through forecast_through_month become actuals
    let actualsWritten = 0;
    if (kind === "forecast" && Number(forecastThroughMonth ?? 0) > 0) {
      actualsWritten = await overwriteWithActuals(admin, version.id, Number(forecastThroughMonth), reportingEntityId, chart?.id ?? null);
    }

    return NextResponse.json({ version, copied, actualsWritten }, { status: 201 });
  } catch (err) {
    console.error("POST /api/budget/versions error:", err);
    const { body, status } = accessErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

async function copyVersionContents(
  typedAdmin: ReturnType<typeof createAdminClient>,
  fromId: string,
  toId: string,
  target: { reportingEntityId: string; fiscalYear: number; chartId: string | null },
): Promise<Record<string, number>> {
  const strip = <T extends Record<string, unknown>>(row: T) => {
    const { id: _id, created_at: _c, updated_at: _u, class_key: _k, ...rest } = row as Record<string, unknown>;
    void _id; void _c; void _u; void _k;
    return rest;
  };
  const counts: Record<string, number> = {};
  // Row copies are generic records; the typed client cannot express that.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = typedAdmin as any;

  const assumptions = await fetchAllPaginated<Record<string, unknown>>((o, l) =>
    admin.from("budget_assumptions").select("*").eq("budget_version_id", fromId).range(o, o + l - 1));
  if (assumptions.length) {
    await admin.from("budget_assumptions").insert(assumptions.map((r) => ({ ...strip(r), budget_version_id: toId })));
  }
  counts.assumptions = assumptions.length;

  const headcount = await fetchAllPaginated<Record<string, unknown>>((o, l) =>
    admin.from("budget_headcount").select("*").eq("budget_version_id", fromId).range(o, o + l - 1));
  const headcountIdMap = new Map<string, string>();
  for (const r of headcount) {
    const { data } = await admin
      .from("budget_headcount")
      .insert({ ...strip(r), budget_version_id: toId, reporting_entity_id: target.reportingEntityId })
      .select("id")
      .single();
    if (data?.id) headcountIdMap.set(String(r.id), data.id);
  }
  counts.headcount = headcount.length;

  const builds = await fetchAllPaginated<Record<string, unknown>>((o, l) =>
    admin.from("budget_builds").select("*").eq("budget_version_id", fromId).range(o, o + l - 1));
  if (builds.length) {
    const rows = builds.map((r) => ({
      ...strip(r),
      budget_version_id: toId,
      reporting_entity_id: target.reportingEntityId,
      source_id: r.source_table === "budget_headcount" && r.source_id
        ? headcountIdMap.get(String(r.source_id)) ?? r.source_id
        : r.source_id,
    }));
    for (let i = 0; i < rows.length; i += 500) await admin.from("budget_builds").insert(rows.slice(i, i + 500));
  }
  counts.builds = builds.length;

  const amounts = await fetchAllPaginated<Record<string, unknown>>((o, l) =>
    admin.from("budget_amounts").select("*").eq("budget_version_id", fromId).range(o, o + l - 1));
  if (amounts.length) {
    const rows = amounts.map((r) => ({
      ...strip(r),
      budget_version_id: toId,
      reporting_entity_id: target.reportingEntityId,
      entity_id: null,
      chart_id: target.chartId,
      period_year: target.fiscalYear,
      source: r.source === "build" ? "build" : "clone",
    }));
    for (let i = 0; i < rows.length; i += 500) await admin.from("budget_amounts").insert(rows.slice(i, i + 500));
  }
  counts.lines = amounts.length;

  const notes = await fetchAllPaginated<Record<string, unknown>>((o, l) =>
    admin.from("budget_line_notes").select("*").eq("budget_version_id", fromId).range(o, o + l - 1));
  if (notes.length) {
    await admin.from("budget_line_notes").insert(notes.map((r) => ({ ...strip(r), budget_version_id: toId })));
  }
  counts.notes = notes.length;

  return counts;
}

/**
 * Replaces months 1..M of a forecast version with actuals per master (from
 * gl_balances through the mappings) so the rest of the year re-forecasts on
 * top of what already happened. Class rows are cleared for those months.
 */
async function overwriteWithActuals(
  admin: ReturnType<typeof createAdminClient>,
  versionId: string,
  throughMonth: number,
  reportingEntityId: string,
  chartId: string | null,
): Promise<number> {
  const owner = await loadVersionOwner(admin, versionId);
  if (!owner) return 0;
  const { data: members } = await admin.from("reporting_entity_members").select("entity_id").eq("reporting_entity_id", reportingEntityId);
  const entityIds = (members ?? []).map((m) => m.entity_id);
  let resolvedChart = chartId;
  if (!resolvedChart) {
    const { data: chart } = await admin.from("master_charts").select("id").eq("organization_id", owner.organizationId!).eq("kind", "management").maybeSingle();
    resolvedChart = chart?.id ?? null;
  }
  if (!resolvedChart || entityIds.length === 0) return 0;
  const masters = await loadMasters(admin, resolvedChart);
  const actuals = await loadMonthlyActuals(admin, {
    chartId: resolvedChart,
    entityIds,
    startYear: owner.fiscalYear,
    startMonth: 1,
    endYear: owner.fiscalYear,
    endMonth: throughMonth,
    masters,
  });
  // Clear every cell (all classes) for those months, then write actuals at the master level
  await admin
    .from("budget_amounts")
    .delete()
    .eq("budget_version_id", versionId)
    .eq("period_year", owner.fiscalYear)
    .lte("period_month", throughMonth);
  const cells: BudgetCell[] = [];
  for (const [masterId, series] of actuals.byMaster) {
    for (let m = 1; m <= throughMonth; m++) {
      const v = series.get(`${owner.fiscalYear}-${m}`);
      if (v === undefined) continue;
      cells.push({ masterAccountId: masterId, classId: null, periodYear: owner.fiscalYear, periodMonth: m, amount: Math.round(v * 100) / 100, source: "clone", note: "actual" });
    }
  }
  const result = await upsertBudgetCells(admin, owner, cells);
  return result.upserted;
}
