import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMasters, loadMonthlyActuals, monthKey } from "./actuals";
import { isPersonnelMaster } from "./personnel-accounts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface PersonnelActuals {
  year: number;
  /** Booked personnel cost per month, January first. */
  byMonth: number[];
  total: number;
  /** Months that had any general ledger data. */
  monthsWithData: number;
  /** Per month, whether the ledger had anything booked (an in-progress year stops partway). */
  hasData: boolean[];
}

/** The year the projection is compared against: the one right before the budget year (JD: 2026 for 2027). */
export function comparisonYear(fiscalYear: number): number {
  return fiscalYear - 1;
}

/**
 * Personnel cost booked in the general ledger for a set of entities in one
 * year: every master under Personnel Costs (6100 and its children), summed
 * by month. Used under the By month table to show what the projection is up
 * against.
 */
export async function loadPersonnelActuals(
  admin: Admin,
  opts: { chartId: string; entityIds: string[]; year: number },
): Promise<PersonnelActuals> {
  const byMonth = new Array(12).fill(0);
  if (opts.entityIds.length === 0) return { year: opts.year, byMonth, total: 0, monthsWithData: 0, hasData: new Array(12).fill(false) };
  const masters = await loadMasters(admin, opts.chartId);
  const asAccount = (m: (typeof masters)[number]) => ({ account_number: m.accountNumber, name: m.name, parent_account_id: m.parentAccountId });
  // Personnel masters by number or name, then anything whose parent is one of them
  const parents = new Set(masters.filter((m) => isPersonnelMaster(asAccount(m))).map((m) => m.id));
  const personnelIds = new Set(masters.filter((m) => isPersonnelMaster(asAccount(m), parents)).map((m) => m.id));
  const a = await loadMonthlyActuals(admin, {
    chartId: opts.chartId,
    entityIds: opts.entityIds,
    startYear: opts.year,
    startMonth: 1,
    endYear: opts.year,
    endMonth: 12,
    masters,
  });
  const hasData = Array.from({ length: 12 }, (_, i) => a.monthsWithData.has(monthKey(opts.year, i + 1)));
  const monthsWithData = hasData.filter(Boolean).length;
  for (const [masterId, series] of a.byMaster) {
    if (!personnelIds.has(masterId)) continue;
    for (let m = 1; m <= 12; m++) byMonth[m - 1] += series.get(monthKey(opts.year, m)) ?? 0;
  }
  const rounded = byMonth.map((v) => Math.round(v * 100) / 100);
  return { year: opts.year, byMonth: rounded, total: Math.round(rounded.reduce((t, v) => t + v, 0) * 100) / 100, monthsWithData, hasData };
}
