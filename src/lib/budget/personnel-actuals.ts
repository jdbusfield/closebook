import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMasters, monthKey } from "./actuals";
import { isPersonnelMaster } from "./personnel-accounts";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import type { EntityAllocation } from "./allocation";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface PersonnelActuals {
  year: number;
  /** Personnel cost per month, January first. */
  byMonth: number[];
  total: number;
  /** Months that had any general ledger data. */
  monthsWithData: number;
  /** Per month, whether the ledger had anything booked (an in-progress year stops partway). */
  hasData: boolean[];
}

/** Booked personnel cost per entity for one year, plus which months have closed. */
export interface PersonnelActualsByEntity {
  year: number;
  /** entity id -> cost per month, January first (entities with nothing booked are absent) */
  byEntity: Map<string, number[]>;
  hasData: boolean[];
  monthsWithData: number;
}

/** The year the projection is compared against: the one right before the budget year (JD: 2026 for 2027). */
export function comparisonYear(fiscalYear: number): number {
  return fiscalYear - 1;
}

// Booked cost changes only when the ledger syncs, so a warm function keeps a
// short-lived copy: the plan page reloads after every edit and must not pay
// for the ledger each time.
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: PersonnelActualsByEntity }>();

function closedMonths(year: number): boolean[] {
  // A month counts as booked when it has closed: the current month and
  // anything after it are still moving, and future months can carry zero or
  // reversal-only balances.
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return year < now.getUTCFullYear() || (year === now.getUTCFullYear() && m < now.getUTCMonth() + 1);
  });
}

/**
 * Personnel cost booked in the general ledger, per entity, for one year:
 * every master under Personnel Costs (6100 and its children), by month.
 *
 * One pass: the personnel masters, their mapped entity accounts, and those
 * accounts' balances for the year and the December before it. Nothing else
 * on the chart is read.
 */
export async function loadPersonnelActualsByEntity(
  admin: Admin,
  opts: { chartId: string; entityIds: string[]; year: number },
): Promise<PersonnelActualsByEntity> {
  const ids = [...new Set(opts.entityIds)].sort();
  const empty: PersonnelActualsByEntity = { year: opts.year, byEntity: new Map(), hasData: new Array(12).fill(false), monthsWithData: 0 };
  if (ids.length === 0) return empty;
  const key = `${opts.chartId}|${opts.year}|${ids.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const masters = await loadMasters(admin, opts.chartId);
  const asAccount = (m: (typeof masters)[number]) => ({ account_number: m.accountNumber, name: m.name, parent_account_id: m.parentAccountId });
  // Personnel masters by number or name, then anything whose parent is one of them
  const parents = new Set(masters.filter((m) => isPersonnelMaster(asAccount(m))).map((m) => m.id));
  const personnelIds = [...new Set(masters.filter((m) => isPersonnelMaster(asAccount(m), parents)).map((m) => m.id))];
  if (personnelIds.length === 0) return empty;

  const mappings = await fetchAllPaginated<{ entity_id: string; account_id: string }>((o, l) =>
    admin
      .from("master_account_mappings")
      .select("entity_id, account_id")
      .eq("chart_id", opts.chartId)
      .in("master_account_id", personnelIds)
      .in("entity_id", ids)
      .range(o, o + l - 1),
  );
  const entityOfAccount = new Map<string, string>();
  for (const m of mappings) entityOfAccount.set(m.account_id, m.entity_id);
  if (entityOfAccount.size === 0) return empty;

  // Ending balances for the year plus the prior December, so January's
  // activity can be taken as its own balance and every later month as a diff.
  const accountIds = [...entityOfAccount.keys()];
  const ending = new Map<string, number>(); // account|year|month -> ending balance
  const monthsWithLedger = new Set<string>();
  const CHUNK = 150;
  for (let i = 0; i < accountIds.length; i += CHUNK) {
    const chunk = accountIds.slice(i, i + CHUNK);
    const rows = await fetchAllPaginated<{ account_id: string; period_year: number; period_month: number; ending_balance: number }>((o, l) =>
      admin
        .from("gl_balances")
        .select("account_id, period_year, period_month, ending_balance")
        .in("account_id", chunk)
        .in("period_year", [opts.year - 1, opts.year])
        .range(o, o + l - 1),
    );
    for (const r of rows) {
      ending.set(`${r.account_id}|${r.period_year}|${r.period_month}`, Number(r.ending_balance ?? 0));
      if (r.period_year === opts.year) monthsWithLedger.add(monthKey(r.period_year, r.period_month));
    }
  }

  const closed = closedMonths(opts.year);
  const hasData = closed.map((c, i) => c && monthsWithLedger.has(monthKey(opts.year, i + 1)));
  const byEntity = new Map<string, number[]>();
  for (const [accountId, entityId] of entityOfAccount) {
    const series = byEntity.get(entityId) ?? new Array(12).fill(0);
    let any = false;
    for (let m = 1; m <= 12; m++) {
      const cur = ending.get(`${accountId}|${opts.year}|${m}`);
      if (cur === undefined) continue;
      // Expense accounts reset at the fiscal year start, so January is its own activity
      let activity = cur;
      if (m > 1) {
        const prev = ending.get(`${accountId}|${opts.year}|${m - 1}`);
        if (prev !== undefined) activity = cur - prev;
      }
      series[m - 1] += activity;
      any = true;
    }
    if (any) byEntity.set(entityId, series);
  }
  for (const [id, series] of byEntity) byEntity.set(id, series.map((v) => Math.round(v * 100) / 100));

  const value: PersonnelActualsByEntity = { year: opts.year, byEntity, hasData, monthsWithData: hasData.filter(Boolean).length };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Sums a per-entity result over a set of entities into one series. */
export function sumActuals(src: PersonnelActualsByEntity, entityIds: Iterable<string>): PersonnelActuals {
  const byMonth = new Array(12).fill(0);
  for (const id of entityIds) {
    const s = src.byEntity.get(id);
    if (!s) continue;
    for (let i = 0; i < 12; i++) byMonth[i] += s[i];
  }
  const rounded = byMonth.map((v) => Math.round(v * 100) / 100);
  return {
    year: src.year,
    byMonth: rounded,
    total: Math.round(rounded.reduce((t, v) => t + v, 0) * 100) / 100,
    monthsWithData: src.monthsWithData,
    hasData: src.hasData,
  };
}

/**
 * Personnel cost booked in the general ledger for a set of entities in one
 * year, summed by month. Used under the By month table to show what the
 * projection is up against.
 */
export async function loadPersonnelActuals(
  admin: Admin,
  opts: { chartId: string; entityIds: string[]; year: number },
): Promise<PersonnelActuals> {
  const src = await loadPersonnelActualsByEntity(admin, opts);
  return sumActuals(src, opts.entityIds);
}

/** One plan row's part in moving booked cost: who employs them, and how their cost splits by entity and month. */
export interface AllocationWeight {
  /** Entity whose ledger carries this person's payroll; null when unknown */
  employerEntityId: string | null;
  /** Projected cost per month, January first, at 100% */
  costByMonth: number[];
  /** Where the plan sends that cost */
  allocations: EntityAllocation[];
}

/**
 * Moves booked personnel cost from the entity that ran the payroll to the
 * entities the plan allocates those people to, month by month.
 *
 * Each employer's booked month is split in proportion to the projected cost
 * of the people it employs, after their allocations: a Silverco payroll
 * carrying Avon and Versatile people lands on both. Cost the plan leaves
 * unallocated stays unallocated. An entity with booked cost but no one on
 * the plan keeps its own figure, as does an employer in a month where its
 * people project nothing.
 */
export function allocateActualsByEmployer(
  src: PersonnelActualsByEntity,
  weights: AllocationWeight[],
): { byEntity: Map<string, number[]>; unallocated: number[] } {
  // employer -> target entity ("" = unallocated) -> weight per month
  const w = new Map<string, Map<string, number[]>>();
  const bump = (employer: string, target: string, month: number, amt: number) => {
    if (!(amt > 0)) return;
    const targets = w.get(employer) ?? new Map<string, number[]>();
    const series = targets.get(target) ?? new Array(12).fill(0);
    series[month] += amt;
    targets.set(target, series);
    w.set(employer, targets);
  };
  for (const row of weights) {
    if (!row.employerEntityId) continue;
    const total = row.allocations.reduce((t, a) => t + a.pct, 0);
    for (let m = 0; m < 12; m++) {
      const cost = row.costByMonth[m] ?? 0;
      if (!(cost > 0)) continue;
      if (total <= 0) {
        bump(row.employerEntityId, "", m, cost);
        continue;
      }
      for (const a of row.allocations) bump(row.employerEntityId, a.entity_id, m, (cost * a.pct) / total);
    }
  }

  const out = new Map<string, number[]>();
  const unallocated = new Array(12).fill(0);
  const add = (entityId: string, month: number, amt: number) => {
    if (entityId === "") {
      unallocated[month] += amt;
      return;
    }
    const s = out.get(entityId) ?? new Array(12).fill(0);
    s[month] += amt;
    out.set(entityId, s);
  };
  for (const [employer, booked] of src.byEntity) {
    const targets = w.get(employer);
    for (let m = 0; m < 12; m++) {
      const amt = booked[m];
      if (!amt) continue;
      let sum = 0;
      if (targets) for (const s of targets.values()) sum += s[m];
      if (!targets || sum <= 0) {
        add(employer, m, amt);
        continue;
      }
      for (const [target, s] of targets) if (s[m] > 0) add(target, m, (amt * s[m]) / sum);
    }
  }
  for (const [id, s] of out) out.set(id, s.map((v) => Math.round(v * 100) / 100));
  return { byEntity: out, unallocated: unallocated.map((v) => Math.round(v * 100) / 100) };
}

/** A per-entity result with the allocated series in place of the booked one. */
export function withAllocated(src: PersonnelActualsByEntity, byEntity: Map<string, number[]>): PersonnelActualsByEntity {
  return { ...src, byEntity };
}
