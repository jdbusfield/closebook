/**
 * Which budget versions apply to a statement scope, and how their amounts
 * are read. Shared by the financial statements route, drill-down, payroll
 * preview and the budget module itself.
 *
 * Ownership rules (JD, Sep 2026): budgets are kept per reporting entity.
 * Legacy FY2026 versions are per entity and must keep working, so:
 *   entity scope            -> that entity's versions only
 *   reporting_entity scope  -> the RE's versions; for a year with none, the
 *                              member entities' versions
 *   organization scope      -> every RE version; entities not covered by an
 *                              RE version in a year fall back to their own
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export type BudgetKind = "budget" | "forecast";

export interface ResolvedVersion {
  id: string;
  fiscalYear: number;
  kind: BudgetKind;
  entityId: string | null;
  reportingEntityId: string | null;
  chartId: string | null;
  forecastThroughMonth: number | null;
}

export interface ResolveOptions {
  organizationId: string;
  years: number[];
  kind?: BudgetKind;
  scope: "entity" | "reporting_entity" | "organization";
  entityId?: string;
  reportingEntityId?: string;
  /** Entities in scope (organization scope, or RE members for RE scope). */
  entityIds?: string[];
}

interface VersionRow {
  id: string;
  fiscal_year: number;
  kind: string | null;
  entity_id: string | null;
  reporting_entity_id: string | null;
  chart_id: string | null;
  forecast_through_month: number | null;
}

function toResolved(v: VersionRow): ResolvedVersion {
  return {
    id: v.id,
    fiscalYear: v.fiscal_year,
    kind: (v.kind ?? "budget") as BudgetKind,
    entityId: v.entity_id,
    reportingEntityId: v.reporting_entity_id,
    chartId: v.chart_id,
    forecastThroughMonth: v.forecast_through_month,
  };
}

const VERSION_COLUMNS =
  "id, fiscal_year, kind, entity_id, reporting_entity_id, chart_id, forecast_through_month";

export async function resolveActiveVersions(
  admin: Admin,
  opts: ResolveOptions,
): Promise<ResolvedVersion[]> {
  const kind = opts.kind ?? "budget";
  if (opts.years.length === 0) return [];

  if (opts.scope === "entity") {
    if (!opts.entityId) return [];
    const { data } = await admin
      .from("budget_versions")
      .select(VERSION_COLUMNS)
      .eq("entity_id", opts.entityId)
      .eq("is_active", true)
      .eq("kind", kind)
      .in("fiscal_year", opts.years);
    return ((data ?? []) as VersionRow[]).map(toResolved);
  }

  // Reporting entities + members for the organization
  const { data: reRows } = await admin
    .from("reporting_entities")
    .select("id")
    .eq("organization_id", opts.organizationId)
    .eq("is_active", true);
  const reIds = ((reRows ?? []) as { id: string }[]).map((r) => r.id);
  const scopedReIds =
    opts.scope === "reporting_entity" && opts.reportingEntityId
      ? reIds.filter((id) => id === opts.reportingEntityId)
      : reIds;

  const membersByRe = new Map<string, string[]>();
  if (scopedReIds.length > 0) {
    const { data: memberRows } = await admin
      .from("reporting_entity_members")
      .select("reporting_entity_id, entity_id")
      .in("reporting_entity_id", scopedReIds);
    for (const m of (memberRows ?? []) as { reporting_entity_id: string; entity_id: string }[]) {
      const list = membersByRe.get(m.reporting_entity_id) ?? [];
      list.push(m.entity_id);
      membersByRe.set(m.reporting_entity_id, list);
    }
  }

  const scopeEntityIds = new Set(
    opts.entityIds ??
      (opts.scope === "reporting_entity" && opts.reportingEntityId
        ? membersByRe.get(opts.reportingEntityId) ?? []
        : []),
  );

  const resolved: ResolvedVersion[] = [];
  const coveredByYear = new Map<number, Set<string>>();

  if (scopedReIds.length > 0) {
    const { data: reVersions } = await admin
      .from("budget_versions")
      .select(VERSION_COLUMNS)
      .in("reporting_entity_id", scopedReIds)
      .eq("is_active", true)
      .eq("kind", kind)
      .in("fiscal_year", opts.years);
    for (const v of (reVersions ?? []) as VersionRow[]) {
      const members = membersByRe.get(v.reporting_entity_id!) ?? [];
      // Organization scope: only count an RE whose members are in scope.
      if (opts.scope === "organization" && scopeEntityIds.size > 0 && !members.some((m) => scopeEntityIds.has(m))) {
        continue;
      }
      resolved.push(toResolved(v));
      const covered = coveredByYear.get(v.fiscal_year) ?? new Set<string>();
      for (const m of members) covered.add(m);
      coveredByYear.set(v.fiscal_year, covered);
    }
  }

  // Entity fallback for entities not covered by an RE version in a year
  const fallbackEntityIds = [...scopeEntityIds];
  if (fallbackEntityIds.length > 0) {
    const { data: entityVersions } = await admin
      .from("budget_versions")
      .select(VERSION_COLUMNS)
      .in("entity_id", fallbackEntityIds)
      .eq("is_active", true)
      .eq("kind", kind)
      .in("fiscal_year", opts.years);
    for (const v of (entityVersions ?? []) as VersionRow[]) {
      const covered = coveredByYear.get(v.fiscal_year);
      if (covered && covered.has(v.entity_id!)) continue;
      resolved.push(toResolved(v));
    }
  }

  return resolved;
}

export interface BudgetAmountRow {
  budget_version_id: string;
  master_account_id: string;
  qbo_class_id: string | null;
  period_year: number;
  period_month: number;
  amount: number;
}

export async function fetchBudgetAmountRows(
  admin: Admin,
  versionIds: string[],
  filter?: { years?: number[]; months?: number[]; masterAccountIds?: string[] },
): Promise<BudgetAmountRow[]> {
  if (versionIds.length === 0) return [];
  return fetchAllPaginated<BudgetAmountRow>((offset, limit) => {
    let q = admin
      .from("budget_amounts")
      .select("budget_version_id, master_account_id, qbo_class_id, period_year, period_month, amount")
      .in("budget_version_id", versionIds);
    if (filter?.years?.length) q = q.in("period_year", filter.years);
    if (filter?.months?.length) q = q.in("period_month", filter.months);
    if (filter?.masterAccountIds?.length) q = q.in("master_account_id", filter.masterAccountIds);
    return q.range(offset, offset + limit - 1);
  });
}

/**
 * Sum children into their parent master account and drop the children, so a
 * budget keyed to 61x0 sub-masters lands on the 6100 line the statement shows.
 * `map` is master id -> bucket key -> amount. Mutates and returns `map`.
 */
export function rollupBudgetToParents<T extends Record<string, number>>(
  map: Map<string, T>,
  accounts: Array<{ id: string; parentAccountId?: string | null }>,
): Map<string, T> {
  const parentOf = new Map<string, string>();
  for (const a of accounts) if (a.parentAccountId) parentOf.set(a.id, a.parentAccountId);
  if (parentOf.size === 0) return map;
  for (const [childId, parentId] of parentOf) {
    const child = map.get(childId);
    if (!child) continue;
    const parent = (map.get(parentId) ?? ({} as T)) as Record<string, number>;
    for (const [k, v] of Object.entries(child)) parent[k] = (parent[k] ?? 0) + v;
    map.set(parentId, parent as T);
    map.delete(childId);
  }
  return map;
}
