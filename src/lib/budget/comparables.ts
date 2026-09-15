/**
 * Comparables for review: three years of monthly actuals per master, trailing
 * windows, the volatility band, last year's budget accuracy, and the
 * stale-sync guard that says which months are safe to compare against.
 */
import type { VersionOwner } from "./access";
import { loadMasters, loadMonthlyActuals, monthKey, rollupActualsToParents, monthsBetween, type MasterInfo } from "./actuals";
import { fetchBudgetAmountRows, resolveActiveVersions, rollupBudgetToParents } from "./versions";
import { loadMemberEntityIds, resolveVersionChartId } from "./recompute";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import type { Admin } from "./build-types";

export interface MasterComparable {
  masterId: string;
  accountNumber: string | null;
  name: string;
  classification: string;
  accountType: string;
  /** year -> 12 months (budget sign) */
  actualsByYear: Record<number, number[]>;
  trailing3Annualized: number;
  trailing6Annualized: number;
  trailing12: number;
  meanMonthly: number;
  stdDevMonthly: number;
  monthsWithData: number;
  /** prior-year budget vs actual */
  priorBudget: number | null;
  priorActual: number | null;
  priorAccuracyPct: number | null; // (actual - budget) / budget
}

export interface MonthFreshness {
  year: number;
  month: number;
  /** oldest synced_at across member entities with a TB row, null when any entity has none */
  oldestSyncedAt: string | null;
  missingEntities: string[];
  closeStatuses: Record<string, string>; // entity code -> status
  comparable: boolean;
  reason: string;
}

export interface ComparablesResult {
  years: number[];
  masters: MasterComparable[];
  freshness: MonthFreshness[];
  asOf: string;
}

const COMPARABLE_STATUSES = new Set(["soft_closed", "closed", "locked"]);
const FRESH_HOURS = 48;

export async function loadComparables(admin: Admin, owner: VersionOwner): Promise<ComparablesResult> {
  const [memberSet, chartId] = await Promise.all([loadMemberEntityIds(admin, owner), resolveVersionChartId(admin, owner)]);
  const entityIds = [...memberSet];
  const masters = await loadMasters(admin, chartId);
  const year = owner.fiscalYear;
  const years = [year - 3, year - 2, year - 1];

  const actuals = await loadMonthlyActuals(admin, {
    chartId,
    entityIds,
    startYear: year - 3,
    startMonth: 1,
    endYear: year - 1,
    endMonth: 12,
    masters,
  });
  rollupActualsToParents(actuals.byMaster, masters);

  // Prior-year budget (RE first, entity fallback) rolled to parents
  const priorVersions = await resolveActiveVersions(admin, {
    organizationId: owner.organizationId!,
    years: [year - 1],
    scope: owner.reportingEntityId ? "reporting_entity" : "entity",
    entityId: owner.entityId ?? undefined,
    reportingEntityId: owner.reportingEntityId ?? undefined,
    entityIds,
  });
  const priorBudgetByMaster = new Map<string, Record<string, number>>();
  if (priorVersions.length > 0) {
    const rows = await fetchBudgetAmountRows(admin, priorVersions.map((v) => v.id), { years: [year - 1] });
    for (const r of rows) {
      const m = priorBudgetByMaster.get(r.master_account_id) ?? {};
      m.total = (m.total ?? 0) + Number(r.amount);
      priorBudgetByMaster.set(r.master_account_id, m);
    }
    rollupBudgetToParents(priorBudgetByMaster, masters.map((m) => ({ id: m.id, parentAccountId: m.parentAccountId })));
  }

  const months = monthsBetween(year - 3, 1, year - 1, 12);
  const out: MasterComparable[] = [];
  const displayMasters: MasterInfo[] = masters.filter((m) => (m.classification === "Revenue" || m.classification === "Expense") && !m.parentAccountId);
  for (const m of displayMasters) {
    const series = actuals.byMaster.get(m.id) ?? new Map<string, number>();
    const byYear: Record<number, number[]> = {};
    for (const y of years) byYear[y] = Array.from({ length: 12 }, (_, i) => Math.round((series.get(monthKey(y, i + 1)) ?? 0) * 100) / 100);
    const present = months.map((mo) => series.get(monthKey(mo.year, mo.month))).filter((v): v is number => v !== undefined);
    const last = (n: number) => months.slice(-n).map((mo) => series.get(monthKey(mo.year, mo.month)) ?? 0);
    const mean = present.length ? present.reduce((t, v) => t + v, 0) / present.length : 0;
    const variance = present.length > 1 ? present.reduce((t, v) => t + (v - mean) ** 2, 0) / (present.length - 1) : 0;
    const priorActual = byYear[year - 1].reduce((t, v) => t + v, 0);
    const priorBudget = priorBudgetByMaster.get(m.id)?.total ?? null;
    out.push({
      masterId: m.id,
      accountNumber: m.accountNumber,
      name: m.name,
      classification: m.classification,
      accountType: m.accountType,
      actualsByYear: byYear,
      trailing3Annualized: Math.round((last(3).reduce((t, v) => t + v, 0) / 3) * 12),
      trailing6Annualized: Math.round((last(6).reduce((t, v) => t + v, 0) / 6) * 12),
      trailing12: Math.round(last(12).reduce((t, v) => t + v, 0)),
      meanMonthly: Math.round(mean),
      stdDevMonthly: Math.round(Math.sqrt(variance)),
      monthsWithData: present.length,
      priorBudget: priorBudget == null ? null : Math.round(priorBudget),
      priorActual: Math.round(priorActual),
      priorAccuracyPct: priorBudget ? Math.round(((priorActual - priorBudget) / Math.abs(priorBudget)) * 1000) / 10 : null,
    });
  }

  const freshness = await loadFreshness(admin, entityIds, year - 1);
  return { years, masters: out, freshness, asOf: new Date().toISOString() };
}

/** Sync age and close status per month of `year` across the entities. */
export async function loadFreshness(admin: Admin, entityIds: string[], year: number): Promise<MonthFreshness[]> {
  if (entityIds.length === 0) return [];
  const { data: ents } = await admin.from("entities").select("id, code").in("id", entityIds);
  const codeOf = new Map(((ents ?? []) as { id: string; code: string }[]).map((e) => [e.id, e.code]));
  const tbs = await fetchAllPaginated<{ entity_id: string; period_month: number; synced_at: string }>((o, l) =>
    admin
      .from("trial_balances")
      .select("entity_id, period_month, synced_at")
      .in("entity_id", entityIds)
      .eq("period_year", year)
      .range(o, o + l - 1),
  );
  const { data: closes } = await admin
    .from("close_periods")
    .select("entity_id, period_month, status")
    .in("entity_id", entityIds)
    .eq("period_year", year);
  const latestSync = new Map<string, string>();
  for (const t of tbs) {
    const k = `${t.entity_id}|${t.period_month}`;
    const prev = latestSync.get(k);
    if (!prev || t.synced_at > prev) latestSync.set(k, t.synced_at);
  }
  const closeStatus = new Map<string, string>();
  for (const c of (closes ?? []) as { entity_id: string; period_month: number; status: string }[]) closeStatus.set(`${c.entity_id}|${c.period_month}`, c.status);

  const now = Date.now();
  const out: MonthFreshness[] = [];
  for (let m = 1; m <= 12; m++) {
    const missing: string[] = [];
    let oldest: string | null = null;
    const statuses: Record<string, string> = {};
    for (const e of entityIds) {
      const s = latestSync.get(`${e}|${m}`);
      if (!s) missing.push(codeOf.get(e) ?? e);
      else if (!oldest || s < oldest) oldest = s;
      statuses[codeOf.get(e) ?? e] = closeStatus.get(`${e}|${m}`) ?? "open";
    }
    const ageHours = oldest ? (now - new Date(oldest).getTime()) / 36e5 : Infinity;
    const allClosed = Object.values(statuses).every((s) => COMPARABLE_STATUSES.has(s));
    let comparable = true;
    let reason = "Fresh sync and closed";
    if (missing.length) {
      comparable = false;
      reason = `No trial balance for ${missing.join(", ")}`;
    } else if (!allClosed) {
      comparable = false;
      reason = "Period not soft-closed for every entity";
    } else if (ageHours > FRESH_HOURS * 24 * 30) {
      // A year-old sync of a closed month is still fine; only recent months are at risk
      reason = "Closed; sync older than a month";
    } else if (ageHours > FRESH_HOURS && !allClosed) {
      comparable = false;
      reason = `Sync is ${Math.round(ageHours / 24)} days old`;
    }
    out.push({ year, month: m, oldestSyncedAt: oldest, missingEntities: missing, closeStatuses: statuses, comparable, reason });
  }
  return out;
}
