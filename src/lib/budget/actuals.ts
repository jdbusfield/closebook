/**
 * Monthly actuals per master account for a set of entities, in "budget
 * sign" (revenue and expense both positive), from gl_balances.
 *
 * gl_balances.ending_balance is cumulative year-to-date for P&L accounts,
 * so a month's activity is this month's ending balance minus last month's,
 * except in the fiscal year's first month where the YTD figure is the month.
 * This mirrors aggregateByBucket in the financial statements route.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export interface MasterInfo {
  id: string;
  accountNumber: string | null;
  name: string;
  classification: string;
  accountType: string;
  parentAccountId: string | null;
  /** Flagged intercompany on the chart; the Financial Model eliminates these. */
  isIntercompany: boolean;
}

export interface ActualsResult {
  masters: MasterInfo[];
  /** master id -> "YYYY-M" -> amount (budget sign) */
  byMaster: Map<string, Map<string, number>>;
  /** entity account id -> master id */
  accountToMaster: Map<string, string>;
  monthsRequested: Array<{ year: number; month: number }>;
  /** months that have any GL row for at least one entity in scope */
  monthsWithData: Set<string>;
}

export function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

export function monthsBetween(startYear: number, startMonth: number, endYear: number, endMonth: number): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    out.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export async function loadMasters(admin: Admin, chartId: string): Promise<MasterInfo[]> {
  const rows = await fetchAllPaginated<{
    id: string; account_number: string | null; name: string; classification: string; account_type: string; parent_account_id: string | null; is_intercompany: boolean | null;
  }>((o, l) =>
    admin
      .from("master_accounts")
      .select("id, account_number, name, classification, account_type, parent_account_id, is_intercompany")
      .eq("chart_id", chartId)
      .eq("is_active", true)
      .order("display_order")
      .order("account_number")
      .range(o, o + l - 1),
  );
  return rows.map((r) => ({
    id: r.id,
    accountNumber: r.account_number,
    name: r.name,
    classification: r.classification,
    accountType: r.account_type,
    parentAccountId: r.parent_account_id,
    isIntercompany: r.is_intercompany === true,
  }));
}

/**
 * P&L actuals by master for `entityIds` over the requested months.
 * Balance-sheet masters are skipped.
 */
export async function loadMonthlyActuals(
  admin: Admin,
  opts: {
    chartId: string;
    entityIds: string[];
    startYear: number;
    startMonth: number;
    endYear: number;
    endMonth: number;
    fiscalYearStartMonth?: number;
    masters?: MasterInfo[];
  },
): Promise<ActualsResult> {
  const fyStart = opts.fiscalYearStartMonth ?? 1;
  const masters = opts.masters ?? (await loadMasters(admin, opts.chartId));
  const plMasters = masters.filter((m) => m.classification === "Revenue" || m.classification === "Expense");
  const masterById = new Map(plMasters.map((m) => [m.id, m]));

  const mappings = await fetchAllPaginated<{ master_account_id: string; entity_id: string; account_id: string }>((o, l) =>
    admin
      .from("master_account_mappings")
      .select("master_account_id, entity_id, account_id")
      .eq("chart_id", opts.chartId)
      .in("entity_id", opts.entityIds)
      .range(o, o + l - 1),
  );
  const accountToMaster = new Map<string, string>();
  for (const m of mappings) if (masterById.has(m.master_account_id)) accountToMaster.set(m.account_id, m.master_account_id);

  const monthsRequested = monthsBetween(opts.startYear, opts.startMonth, opts.endYear, opts.endMonth);
  // One extra month before the range for the first diff
  const priorYear = opts.startMonth === 1 ? opts.startYear - 1 : opts.startYear;
  const priorMonth = opts.startMonth === 1 ? 12 : opts.startMonth - 1;
  const allMonths = [{ year: priorYear, month: priorMonth }, ...monthsRequested];
  const years = [...new Set(allMonths.map((m) => m.year))];

  const byMaster = new Map<string, Map<string, number>>();
  const monthsWithData = new Set<string>();
  if (accountToMaster.size === 0 || opts.entityIds.length === 0) {
    return { masters, byMaster, accountToMaster, monthsRequested, monthsWithData };
  }

  const accountIds = [...accountToMaster.keys()];
  // Ending balance per entity account per month
  const ending = new Map<string, number>(); // account|year|month -> ending
  const CHUNK = 400;
  for (let i = 0; i < accountIds.length; i += CHUNK) {
    const chunk = accountIds.slice(i, i + CHUNK);
    const rows = await fetchAllPaginated<{ account_id: string; entity_id: string; period_year: number; period_month: number; ending_balance: number }>((o, l) =>
      admin
        .from("gl_balances")
        .select("account_id, entity_id, period_year, period_month, ending_balance")
        .in("account_id", chunk)
        .in("period_year", years)
        .order("account_id")
        .order("period_year")
        .order("period_month")
        .range(o, o + l - 1),
    );
    for (const r of rows) {
      ending.set(`${r.account_id}|${r.period_year}|${r.period_month}`, Number(r.ending_balance ?? 0));
      monthsWithData.add(monthKey(r.period_year, r.period_month));
    }
  }

  for (const [accountId, masterId] of accountToMaster) {
    const master = masterById.get(masterId)!;
    const sign = master.classification === "Revenue" ? -1 : 1;
    let series = byMaster.get(masterId);
    if (!series) {
      series = new Map();
      byMaster.set(masterId, series);
    }
    for (const m of monthsRequested) {
      const cur = ending.get(`${accountId}|${m.year}|${m.month}`);
      if (cur === undefined) continue;
      let activity: number;
      if (m.month === fyStart) {
        activity = cur;
      } else {
        const py = m.month === 1 ? m.year - 1 : m.year;
        const pm = m.month === 1 ? 12 : m.month - 1;
        const prev = ending.get(`${accountId}|${py}|${pm}`);
        activity = prev === undefined ? cur : cur - prev;
      }
      const key = monthKey(m.year, m.month);
      series.set(key, (series.get(key) ?? 0) + activity * sign);
    }
  }

  return { masters, byMaster, accountToMaster, monthsRequested, monthsWithData };
}

/** Rolls child masters into parents (in place) and returns the map. */
export function rollupActualsToParents(byMaster: Map<string, Map<string, number>>, masters: MasterInfo[]): Map<string, Map<string, number>> {
  for (const m of masters) {
    if (!m.parentAccountId) continue;
    const child = byMaster.get(m.id);
    if (!child) continue;
    const parent = byMaster.get(m.parentAccountId) ?? new Map<string, number>();
    for (const [k, v] of child) parent.set(k, (parent.get(k) ?? 0) + v);
    byMaster.set(m.parentAccountId, parent);
    byMaster.delete(m.id);
  }
  return byMaster;
}
