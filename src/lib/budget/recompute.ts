/**
 * Recompute: turns headcount rows (and, later, other build sources) into
 * budget_builds, then syncs budget_amounts lines so every line with builds
 * equals the sum of its builds.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VersionOwner } from "./access";
import { AssumptionSet, type AssumptionRow } from "./assumption-keys";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import {
  COMPONENT_TO_MASTER,
  COST_COMPONENTS,
  pricePosition,
  reportingEntityShare,
  type CostComponent,
  type HeadcountRowInput,
  type PricedPosition,
} from "./personnel-engine";
import { PERSONNEL_SUB_MASTERS, type PersonnelComponent } from "./personnel-accounts";
import { upsertBudgetCells, type BudgetCell } from "./amounts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

const NIL_CLASS = "00000000-0000-0000-0000-000000000000";

export interface HeadcountDbRow {
  id: string;
  budget_version_id: string;
  reporting_entity_id: string | null;
  employee_id: string | null;
  paylocity_company_id: string | null;
  name: string;
  title: string | null;
  department: string | null;
  is_requisition: boolean;
  status: string;
  pay_type: string;
  base_rate: number | null;
  annual_salary: number | null;
  std_hours_week: number;
  fte_pct: number;
  start_month: number;
  end_month: number | null;
  merit_pct: number;
  merit_month: number | null;
  bonus_target: number;
  commission_annual: number;
  ot_pct: number;
  dt_pct: number;
  meal_pct: number;
  other_earnings_monthly: number;
  benefits_monthly: number;
  match_pct: number;
  life_disability_monthly: number;
  wc_class_code: string | null;
  pto_hours_per_period: number;
  other_costs_monthly: number;
  entity_allocations: unknown;
  class_allocations: unknown;
  seeded_from: unknown;
  notes: string | null;
}

export function toEngineRow(r: HeadcountDbRow): HeadcountRowInput {
  const ea = Array.isArray(r.entity_allocations) ? (r.entity_allocations as Array<{ entity_id: string; pct: number }>) : [];
  const ca = Array.isArray(r.class_allocations) ? (r.class_allocations as Array<{ class: string; pct: number }>) : [];
  return {
    id: r.id,
    name: r.name,
    employeeId: r.employee_id,
    paylocityCompanyId: r.paylocity_company_id,
    reportingEntityId: r.reporting_entity_id,
    isRequisition: !!r.is_requisition,
    status: (r.status as HeadcountRowInput["status"]) ?? "active",
    payType: r.pay_type === "Salary" ? "Salary" : "Hourly",
    baseRate: r.base_rate == null ? null : Number(r.base_rate),
    annualSalary: r.annual_salary == null ? null : Number(r.annual_salary),
    stdHoursWeek: Number(r.std_hours_week ?? 40),
    ftePct: Number(r.fte_pct ?? 100),
    startMonth: Number(r.start_month ?? 1),
    endMonth: r.end_month == null ? null : Number(r.end_month),
    meritPct: Number(r.merit_pct ?? 0),
    meritMonth: r.merit_month == null ? null : Number(r.merit_month),
    bonusTarget: Number(r.bonus_target ?? 0),
    commissionAnnual: Number(r.commission_annual ?? 0),
    otPct: Number(r.ot_pct ?? 0),
    dtPct: Number(r.dt_pct ?? 0),
    mealPct: Number(r.meal_pct ?? 0),
    otherEarningsMonthly: Number(r.other_earnings_monthly ?? 0),
    benefitsMonthly: Number(r.benefits_monthly ?? 0),
    matchPct: Number(r.match_pct ?? 0),
    lifeDisabilityMonthly: Number(r.life_disability_monthly ?? 0),
    wcClassCode: r.wc_class_code,
    ptoHoursPerPeriod: Number(r.pto_hours_per_period ?? 0),
    otherCostsMonthly: Number(r.other_costs_monthly ?? 0),
    entityAllocations: ea,
    classAllocations: ca,
  };
}

export async function loadAssumptions(admin: Admin, versionId: string): Promise<AssumptionSet> {
  const rows = await fetchAllPaginated<AssumptionRow>((offset, limit) =>
    admin
      .from("budget_assumptions")
      .select("scope, scope_id, key, value, effective_from, effective_to")
      .eq("budget_version_id", versionId)
      .range(offset, offset + limit - 1),
  );
  return new AssumptionSet(rows);
}

export async function loadMemberEntityIds(admin: Admin, owner: VersionOwner): Promise<Set<string>> {
  if (owner.entityId) return new Set([owner.entityId]);
  const { data } = await admin
    .from("reporting_entity_members")
    .select("entity_id")
    .eq("reporting_entity_id", owner.reportingEntityId!);
  return new Set(((data ?? []) as { entity_id: string }[]).map((m) => m.entity_id));
}

/** Management chart id for the version (its own, else the org default). */
export async function resolveVersionChartId(admin: Admin, owner: VersionOwner): Promise<string> {
  if (owner.chartId) return owner.chartId;
  const { data } = await admin
    .from("master_charts")
    .select("id")
    .eq("organization_id", owner.organizationId!)
    .eq("kind", "management")
    .maybeSingle();
  if (!data?.id) throw new Error("Management chart not found for this organization");
  return data.id;
}

/** account_number -> master id for the chart. */
export async function loadMastersByNumber(admin: Admin, chartId: string): Promise<Map<string, { id: string; name: string }>> {
  const rows = await fetchAllPaginated<{ id: string; account_number: string | null; name: string }>((offset, limit) =>
    admin
      .from("master_accounts")
      .select("id, account_number, name")
      .eq("chart_id", chartId)
      .eq("is_active", true)
      .range(offset, offset + limit - 1),
  );
  const m = new Map<string, { id: string; name: string }>();
  for (const r of rows) if (r.account_number) m.set(r.account_number, { id: r.id, name: r.name });
  return m;
}

/** QBO class name -> class id across the member entities (first match wins). */
export async function loadClassIdsByName(admin: Admin, memberEntityIds: Set<string>): Promise<Map<string, string>> {
  if (memberEntityIds.size === 0) return new Map();
  const { data } = await admin
    .from("qbo_classes")
    .select("id, name, entity_id, is_active")
    .in("entity_id", [...memberEntityIds])
    .eq("is_active", true);
  const m = new Map<string, string>();
  for (const c of (data ?? []) as { id: string; name: string }[]) {
    const key = c.name.trim().toLowerCase();
    if (!m.has(key)) m.set(key, c.id);
  }
  return m;
}

export interface PersonnelRecomputeResult {
  positions: PricedPosition[];
  buildsWritten: number;
  missingSubMasters: string[];
}

interface BuildInsert {
  budget_version_id: string;
  reporting_entity_id: string | null;
  entity_id: string | null;
  master_account_id: string;
  qbo_class_id: string | null;
  build_type: string;
  source_table: string;
  source_id: string;
  component: string;
  label: string;
  amounts: Record<string, number>;
  assumption_keys: string[];
  is_computed: boolean;
  meta: Record<string, unknown> | null;
  computed_at: string;
}

function amountsObject(values: number[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (let i = 0; i < 12; i++) o[String(i + 1)] = Math.round(values[i] * 100) / 100;
  return o;
}

/**
 * Prices every headcount row of a version and replaces its headcount builds.
 * One build per row x sub-master x class.
 */
export async function recomputePersonnel(admin: Admin, owner: VersionOwner): Promise<PersonnelRecomputeResult> {
  const [assumptions, memberEntityIds, chartId] = await Promise.all([
    loadAssumptions(admin, owner.id),
    loadMemberEntityIds(admin, owner),
    resolveVersionChartId(admin, owner),
  ]);
  const [masters, classIds] = await Promise.all([
    loadMastersByNumber(admin, chartId),
    loadClassIdsByName(admin, memberEntityIds),
  ]);

  const rows = await fetchAllPaginated<HeadcountDbRow>((offset, limit) =>
    admin
      .from("budget_headcount")
      .select("*")
      .eq("budget_version_id", owner.id)
      .order("name")
      .range(offset, offset + limit - 1),
  );

  const subMasterId = new Map<PersonnelComponent, string>();
  const missingSubMasters: string[] = [];
  for (const sm of PERSONNEL_SUB_MASTERS) {
    const m = masters.get(sm.number);
    if (m) subMasterId.set(sm.component, m.id);
    else missingSubMasters.push(`${sm.number} ${sm.name}`);
  }
  // Fall back to the parent when a sub-master is missing so nothing is dropped
  const parent = masters.get("6100");
  if (missingSubMasters.length > 0 && !parent) {
    throw new Error("Personnel masters not found on the management chart (run scripts/budget-personnel-submasters.mjs)");
  }
  const masterFor = (c: PersonnelComponent) => subMasterId.get(c) ?? parent!.id;

  const positions: PricedPosition[] = [];
  const builds: BuildInsert[] = [];
  const now = new Date().toISOString();
  const keys = AssumptionSet.personnelKeys();

  for (const r of rows) {
    const input = toEngineRow(r);
    const reShare = reportingEntityShare(input, memberEntityIds);
    const priced = pricePosition(input, { year: owner.fiscalYear, assumptions, reShare });
    positions.push(priced);
    if (priced.total === 0) continue;

    // Group components by sub-master
    const byMaster = new Map<PersonnelComponent, { values: number[]; detail: Record<string, number> }>();
    for (const c of COST_COMPONENTS as CostComponent[]) {
      const group = COMPONENT_TO_MASTER[c];
      const entry: { values: number[]; detail: Record<string, number> } =
        byMaster.get(group) ?? { values: new Array(12).fill(0), detail: {} };
      for (let i = 0; i < 12; i++) entry.values[i] += priced.components[c][i];
      entry.detail[c] = priced.componentTotals[c];
      byMaster.set(group, entry);
    }

    const classSplits = input.classAllocations.length > 0
      ? input.classAllocations
      : [{ class: "", pct: 100 }];
    const splitTotal = classSplits.reduce((t, s) => t + Number(s.pct || 0), 0) || 100;

    for (const [group, entry] of byMaster) {
      if (entry.values.every((v) => v === 0)) continue;
      for (const split of classSplits) {
        const share = Number(split.pct || 0) / splitTotal;
        if (share <= 0) continue;
        const classId = split.class ? classIds.get(split.class.trim().toLowerCase()) ?? null : null;
        builds.push({
          budget_version_id: owner.id,
          reporting_entity_id: owner.reportingEntityId,
          entity_id: owner.entityId,
          master_account_id: masterFor(group),
          qbo_class_id: classId,
          build_type: "headcount",
          source_table: "budget_headcount",
          source_id: r.id,
          component: group,
          label: split.class && !classId ? `${r.name} (${split.class})` : r.name,
          amounts: amountsObject(entry.values.map((v) => v * share)),
          assumption_keys: keys,
          is_computed: true,
          meta: {
            className: split.class || null,
            classPct: share * 100,
            reShare,
            components: Object.fromEntries(Object.entries(entry.detail).map(([k, v]) => [k, Math.round(v * share * 100) / 100])),
            activeMonths: priced.activeMonths,
          },
          computed_at: now,
        });
      }
    }
  }

  // Replace headcount builds for the version
  const { error: delErr } = await admin
    .from("budget_builds")
    .delete()
    .eq("budget_version_id", owner.id)
    .eq("build_type", "headcount");
  if (delErr) throw new Error(`Could not clear headcount builds: ${delErr.message}`);

  const BATCH = 500;
  for (let i = 0; i < builds.length; i += BATCH) {
    const { error } = await admin.from("budget_builds").insert(builds.slice(i, i + BATCH));
    if (error) throw new Error(`Could not write builds: ${error.message}`);
  }

  return { positions, buildsWritten: builds.length, missingSubMasters };
}

export interface LineSyncResult {
  linesUpserted: number;
  linesDeleted: number;
}

/**
 * Lines = sum of builds for every (master, class) that has builds. Lines that
 * were build-sourced but no longer have builds are removed; manual lines on
 * masters with no builds are untouched.
 */
export async function syncLinesFromBuilds(admin: Admin, owner: VersionOwner): Promise<LineSyncResult> {
  const builds = await fetchAllPaginated<{ master_account_id: string; qbo_class_id: string | null; class_key: string; amounts: Record<string, number> }>((offset, limit) =>
    admin
      .from("budget_builds")
      .select("master_account_id, qbo_class_id, class_key, amounts")
      .eq("budget_version_id", owner.id)
      .range(offset, offset + limit - 1),
  );

  const sums = new Map<string, { masterAccountId: string; classId: string | null; months: number[] }>();
  for (const b of builds) {
    const key = `${b.master_account_id}|${b.class_key ?? NIL_CLASS}`;
    const entry = sums.get(key) ?? { masterAccountId: b.master_account_id, classId: b.qbo_class_id, months: new Array(12).fill(0) };
    for (let m = 1; m <= 12; m++) entry.months[m - 1] += Number(b.amounts?.[String(m)] ?? 0);
    sums.set(key, entry);
  }

  // Existing build-sourced cells that no longer have builds
  const existing = await fetchAllPaginated<{ master_account_id: string; qbo_class_id: string | null; class_key: string; period_month: number }>((offset, limit) =>
    admin
      .from("budget_amounts")
      .select("master_account_id, qbo_class_id, class_key, period_month")
      .eq("budget_version_id", owner.id)
      .eq("source", "build")
      .range(offset, offset + limit - 1),
  );

  const cells: BudgetCell[] = [];
  for (const entry of sums.values()) {
    for (let m = 1; m <= 12; m++) {
      cells.push({
        masterAccountId: entry.masterAccountId,
        classId: entry.classId,
        periodYear: owner.fiscalYear,
        periodMonth: m,
        amount: Math.round(entry.months[m - 1] * 100) / 100,
        source: "build",
      });
    }
  }
  for (const e of existing) {
    const key = `${e.master_account_id}|${e.class_key ?? NIL_CLASS}`;
    if (sums.has(key)) continue;
    cells.push({
      masterAccountId: e.master_account_id,
      classId: e.qbo_class_id,
      periodYear: owner.fiscalYear,
      periodMonth: e.period_month,
      amount: 0,
      source: "build",
    });
  }

  const result = await upsertBudgetCells(admin, owner, cells);
  if (result.error) throw new Error(`Could not sync lines: ${result.error}`);
  return { linesUpserted: result.upserted, linesDeleted: result.deleted };
}
