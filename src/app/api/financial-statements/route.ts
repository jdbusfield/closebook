import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPeriodsInRange, type PeriodBucket } from "@/lib/utils/dates";
import { fetchAllMappings, fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { resolveChartIdOrDefault } from "@/lib/master-charts/resolve";
import { getExcludedFromBreakdownEntityIds } from "@/lib/db/queries/reporting-entity-exclusions";
import {
  INCOME_STATEMENT_SECTIONS,
  INCOME_STATEMENT_COMPUTED,
  BALANCE_SHEET_SECTIONS,
  BALANCE_SHEET_COMPUTED,
  CASH_ACCOUNT_TYPES,
  OPERATING_CURRENT_ASSET_TYPES,
  OPERATING_CURRENT_LIABILITY_TYPES,
  INVESTING_ACCOUNT_TYPES,
  FINANCING_LIABILITY_TYPES,
  FINANCING_EQUITY_TYPES,
  ROU_ASSET_NAME_PATTERNS,
  ROU_LIABILITY_NAME_PATTERNS,
  LINE_OF_CREDIT_NAME_PATTERNS,
  INTANGIBLE_ASSET_NAME_PATTERNS,
  OTHER_EXPENSE_NAME_PATTERNS,
  type StatementSectionConfig,
  type ComputedLineConfig,
} from "@/lib/config/statement-sections";
import { fetchAssetCashFlows, type AssetCashFlows } from "@/lib/utils/asset-cash-flows";
import {
  fetchScheduleCashFlows,
  type ScheduleCashFlows,
} from "@/lib/utils/fixed-asset-schedule";
import type {
  Period,
  LineItem,
  StatementSection,
  StatementData,
  FinancialStatementsResponse,
  Granularity,
  Scope,
  CashFlowDerivation,
  FixedAssetCfEntryType,
} from "@/components/financial-statements/types";

/** Display labels for Fixed-Asset Activity schedule entry types. */
const SCHEDULE_TYPE_LABEL: Record<FixedAssetCfEntryType, string> = {
  cash_purchase: "Cash purchase",
  disposal_proceeds: "Disposal proceeds",
  disposal_writeoff: "Disposal / write-off (non-cash)",
  reclass_transfer: "Reclass / transfer (non-cash)",
};

// ---------------------------------------------------------------------------
// Types for raw DB rows
// ---------------------------------------------------------------------------

interface RawGLBalance {
  account_id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  beginning_balance: number;
  ending_balance: number;
  net_change: number;
}

interface RawAccount {
  id: string;
  name: string;
  account_number: string | null;
  classification: string;
  account_type: string;
  account_sub_type: string | null;
}

// ---------------------------------------------------------------------------
// Helper: coerce Supabase numeric(19,4) fields from strings to numbers.
// PostgREST returns numeric/decimal columns as strings, not JS numbers.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGLBalance(row: any): RawGLBalance {
  return {
    account_id: row.account_id,
    entity_id: row.entity_id,
    period_year: Number(row.period_year),
    period_month: Number(row.period_month),
    beginning_balance: Number(row.beginning_balance),
    ending_balance: Number(row.ending_balance),
    net_change: Number(row.net_change),
  };
}

// ---------------------------------------------------------------------------
// Helper: paginated GL balance fetcher.
// Supabase PostgREST caps responses via PGRST_DB_MAX_ROWS (often 1000).
// Page size must not exceed this limit so pagination detects when more
// rows remain.
// ---------------------------------------------------------------------------

const GL_PAGE_SIZE = 1000;

interface GLQueryFilters {
  filterColumn: "entity_id" | "account_id";
  filterValues: string[];
  years: number[];
  months: number[];
}

interface GLFetchResult {
  rows: RawGLBalance[];
  hadErrors: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllGLBalances(admin: any, filters: GLQueryFilters): Promise<GLFetchResult> {
  const allRows: RawGLBalance[] = [];
  let offset = 0;
  let hasMore = true;
  let hadErrors = false;
  const MAX_RETRIES = 2;

  while (hasMore) {
    let lastError: unknown = null;
    let rows: RawGLBalance[] = [];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const query = admin
        .from("gl_balances")
        .select(
          "account_id, entity_id, period_year, period_month, beginning_balance, ending_balance, net_change"
        )
        .in(filters.filterColumn, filters.filterValues)
        .in("period_year", filters.years)
        .in("period_month", filters.months)
        // Deterministic ordering is CRITICAL for correct pagination.
        // Without ORDER BY, PostgreSQL returns rows in arbitrary order that
        // can change between page fetches, causing rows to be skipped or
        // duplicated across pages.
        .order("entity_id")
        .order("account_id")
        .order("period_year")
        .order("period_month")
        .range(offset, offset + GL_PAGE_SIZE - 1);

      const { data, error } = await query;

      if (error) {
        lastError = error;
        console.warn(`GL balance pagination error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error);
        if (attempt < MAX_RETRIES) continue; // retry
      } else {
        rows = (data ?? []).map(parseGLBalance);
        lastError = null;
        break; // success
      }
    }

    if (lastError) {
      console.error("GL balance pagination failed after retries:", lastError);
      hadErrors = true;
      break;
    }

    allRows.push(...rows);

    // If we got fewer rows than page size, we've fetched everything
    if (rows.length < GL_PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += GL_PAGE_SIZE;
    }
  }

  return { rows: allRows, hadErrors };
}

// ---------------------------------------------------------------------------
// Helper: build all individual (year, month) tuples we need to query
// ---------------------------------------------------------------------------

function collectAllMonths(
  buckets: PeriodBucket[],
  includeYoY: boolean
): Array<{ year: number; month: number }> {
  const set = new Set<string>();
  const result: Array<{ year: number; month: number }> = [];

  for (const bucket of buckets) {
    for (const m of bucket.months) {
      const key = `${m.year}-${m.month}`;
      if (!set.has(key)) {
        set.add(key);
        result.push(m);
      }
      // Prior month for balance sheet change calculation
      const priorMonth = m.month === 1 ? 12 : m.month - 1;
      const priorYear = m.month === 1 ? m.year - 1 : m.year;
      const priorKey = `${priorYear}-${priorMonth}`;
      if (!set.has(priorKey)) {
        set.add(priorKey);
        result.push({ year: priorYear, month: priorMonth });
      }
    }
    if (includeYoY) {
      for (const m of bucket.months) {
        const pyKey = `${m.year - 1}-${m.month}`;
        if (!set.has(pyKey)) {
          set.add(pyKey);
          result.push({ year: m.year - 1, month: m.month });
        }
        // Prior month of prior year (needed for cash flow beginning balances)
        const pyPriorMonth = m.month === 1 ? 12 : m.month - 1;
        const pyPriorYear = m.month === 1 ? m.year - 2 : m.year - 1;
        const pyPriorKey = `${pyPriorYear}-${pyPriorMonth}`;
        if (!set.has(pyPriorKey)) {
          set.add(pyPriorKey);
          result.push({ year: pyPriorYear, month: pyPriorMonth });
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper: create prior year buckets (same keys, months shifted back 1 year)
// ---------------------------------------------------------------------------

function createPriorYearBuckets(buckets: PeriodBucket[]): PeriodBucket[] {
  return buckets.map((b) => ({
    ...b,
    months: b.months.map((m) => ({ year: m.year - 1, month: m.month })),
  }));
}

// ---------------------------------------------------------------------------
// Helper: aggregate budget amounts into period buckets
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface RawBudgetAmount {
  master_account_id?: string;
  account_id?: string;
  period_month: number;
  period_year: number;
  amount: number;
}

/**
 * Fetches budget amounts with fallback for column name.
 * The budget_amounts table may have either `master_account_id` (renamed)
 * or `account_id` (original migration). Try master_account_id first; if
 * the query errors, fall back to account_id.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchBudgetAmounts(admin: any, versionIds: string[]): Promise<{
  rows: RawBudgetAmount[];
  column: "master_account_id" | "account_id";
  error?: string;
}> {
  // Try master_account_id first (current schema after column rename)
  // Paginate to avoid PostgREST row-limit truncation (versions × accounts × 12 months)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: probe, error: err1 } = await (admin as any)
    .from("budget_amounts")
    .select("master_account_id", { count: "exact", head: true })
    .in("budget_version_id", versionIds);

  if (!err1) {
    const rows1 = await fetchAllPaginated<RawBudgetAmount>((offset, limit) =>
      (admin as any)
        .from("budget_amounts")
        .select("master_account_id, period_year, period_month, amount")
        .in("budget_version_id", versionIds)
        .range(offset, offset + limit - 1)
    );
    return { rows: rows1, column: "master_account_id" };
  }

  // Fallback: try account_id (original migration column name)
  const rows2 = await fetchAllPaginated<RawBudgetAmount>((offset, limit) =>
    (admin as any)
      .from("budget_amounts")
      .select("account_id, period_year, period_month, amount")
      .in("budget_version_id", versionIds)
      .range(offset, offset + limit - 1)
  );

  if (rows2.length > 0) {
    return { rows: rows2, column: "account_id" };
  }

  return {
    rows: [],
    column: "master_account_id",
    error: `master_account_id: ${err1?.message}; account_id fallback returned 0 rows`,
  };
}

function aggregateBudgetByBucket(
  budgetAmounts: RawBudgetAmount[],
  buckets: PeriodBucket[],
  column: "master_account_id" | "account_id",
  /** Maps entity account_id -> master account_id (only needed when column is account_id) */
  entityToMaster?: Map<string, string>
): Map<string, Record<string, number>> {
  // Index budget amounts by account key -> "year-month" -> amount
  const budgetIndex = new Map<string, Map<string, number>>();
  for (const ba of budgetAmounts) {
    const accountKey = column === "master_account_id"
      ? ba.master_account_id!
      : ba.account_id!;
    if (!accountKey) continue;

    let byPeriod = budgetIndex.get(accountKey);
    if (!byPeriod) {
      byPeriod = new Map();
      budgetIndex.set(accountKey, byPeriod);
    }
    const key = `${ba.period_year}-${ba.period_month}`;
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + Number(ba.amount));
  }

  // Aggregate by master account and bucket
  const result = new Map<string, Record<string, number>>();

  for (const [accountKey, periodAmounts] of budgetIndex) {
    // If column is account_id, map entity account -> master account
    const masterAccountId = column === "account_id" && entityToMaster
      ? entityToMaster.get(accountKey)
      : accountKey;
    if (!masterAccountId) continue;

    let masterBuckets = result.get(masterAccountId);
    if (!masterBuckets) {
      masterBuckets = {};
      result.set(masterAccountId, masterBuckets);
    }

    for (const bucket of buckets) {
      for (const m of bucket.months) {
        const periodKey = `${m.year}-${m.month}`;
        const val = periodAmounts.get(periodKey) ?? 0;
        masterBuckets[bucket.key] = (masterBuckets[bucket.key] ?? 0) + val;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper: inject pro forma adjustments into consolidated balances
// ---------------------------------------------------------------------------

interface RawProFormaAdjustment {
  id: string;
  entity_id: string;
  master_account_id: string;
  offset_master_account_id: string | null;
  period_year: number;
  period_month: number;
  amount: number;
  description: string;
  notes: string | null;
}

/**
 * Inject adjustments into consolidatedBalances (double-entry).
 * Used by allocation adjustments which create entries for every month in
 * their range, so the diff-based aggregation works naturally.
 *
 * NOTE: Do NOT use this for pro forma adjustments — they are one-off
 * entries that must be applied post-aggregation via
 * applyProFormaPostAggregation() to avoid leaking into adjacent months.
 */
function injectProFormaAdjustments(
  consolidatedBalances: RawGLBalance[],
  adjustments: Array<{ master_account_id: string; period_year: number; period_month: number; amount: number; offset_master_account_id?: string | null }>,
  entityId: string
): void {
  const balIndex = new Map<string, RawGLBalance>();
  for (const b of consolidatedBalances) {
    balIndex.set(`${b.account_id}-${b.period_year}-${b.period_month}`, b);
  }

  function injectAmount(accountId: string, year: number, month: number, amount: number) {
    const key = `${accountId}-${year}-${month}`;
    const existing = balIndex.get(key);
    if (existing) {
      existing.net_change += amount;
      existing.ending_balance += amount;
    } else {
      const newBal: RawGLBalance = {
        account_id: accountId,
        entity_id: entityId,
        period_year: year,
        period_month: month,
        beginning_balance: 0,
        ending_balance: amount,
        net_change: amount,
      };
      consolidatedBalances.push(newBal);
      balIndex.set(key, newBal);
    }
  }

  for (const adj of adjustments) {
    const amount = Number(adj.amount);
    // Primary side
    injectAmount(adj.master_account_id, Number(adj.period_year), Number(adj.period_month), amount);
    // Offset side (double-entry counterpart)
    if (adj.offset_master_account_id) {
      injectAmount(adj.offset_master_account_id, Number(adj.period_year), Number(adj.period_month), -amount);
    }
  }
}

/**
 * Synthetic account ID used to hold pro forma adjustments that would
 * otherwise hit Bank (cash) accounts.  By redirecting the bank side to
 * this synthetic ID, the real bank account balances remain untouched
 * (matching the non-pro-forma view), while the adjustment is still
 * reflected on the balance sheet via a dedicated "Pro Forma Adjustments"
 * line injected by injectProFormaAdjustmentsIntoBalanceSheet().
 */
const PRO_FORMA_ADJ_ACCOUNT_ID = "__pro_forma_adj__";

/**
 * Apply pro forma adjustments directly to already-aggregated bucket data.
 * Each adjustment adds its amount ONLY to the target period's netChange
 * and endingBalance — no leakage into subsequent months.
 *
 * Bank (cash) accounts are shielded: their side of the adjustment is
 * redirected to the synthetic PRO_FORMA_ADJ_ACCOUNT_ID so that the
 * user always sees the true bank balance.
 *
 * This bypasses the ending_balance-diff logic in aggregateByBucket()
 * which would otherwise reverse the adjustment in the next month.
 */
function applyProFormaPostAggregation(
  aggregated: Map<string, BucketedAmounts>,
  adjustments: Array<{ master_account_id: string; period_year: number; period_month: number; amount: number; offset_master_account_id?: string | null }>,
  buckets: PeriodBucket[],
  accounts: AccountInfo[],
): void {
  // Build set of Bank account IDs — these are shielded from pro forma
  const bankAccountIds = new Set(
    accounts.filter((a) => a.accountType === "Bank").map((a) => a.id)
  );
  // Map each year-month to its bucket key (skip TOTAL bucket — it contains
  // the same months as the real buckets and would overwrite their keys,
  // causing adjustments to land only in the Total column)
  const monthToBucket = new Map<string, string>();
  const hasTotalBucket = buckets.some((b) => b.key === "TOTAL");
  const nonTotalBucketKeys: string[] = [];
  for (const bucket of buckets) {
    if (bucket.key === "TOTAL") continue;
    nonTotalBucketKeys.push(bucket.key);
    for (const m of bucket.months) {
      monthToBucket.set(`${m.year}-${m.month}`, bucket.key);
    }
  }

  function applyAmount(rawAccountId: string, year: number, month: number, amount: number) {
    const bucketKey = monthToBucket.get(`${year}-${month}`);
    if (!bucketKey) return; // adjustment outside the view range

    // Shield bank accounts: redirect their side to the synthetic account
    const accountId = bankAccountIds.has(rawAccountId)
      ? PRO_FORMA_ADJ_ACCOUNT_ID
      : rawAccountId;

    let bucketed = aggregated.get(accountId);
    if (!bucketed) {
      // Account has no GL data yet — create an empty entry
      bucketed = { netChange: {}, endingBalance: {}, beginningBalance: {} };
      for (const b of buckets) {
        bucketed.netChange[b.key] = 0;
        bucketed.endingBalance[b.key] = 0;
        bucketed.beginningBalance[b.key] = 0;
      }
      aggregated.set(accountId, bucketed);
    }

    // Apply netChange to the target bucket only
    bucketed.netChange[bucketKey] = (bucketed.netChange[bucketKey] ?? 0) + amount;
    // Apply endingBalance to the target bucket
    bucketed.endingBalance[bucketKey] = (bucketed.endingBalance[bucketKey] ?? 0) + amount;

    // Propagate the ending balance adjustment to all subsequent buckets.
    // Both BS and P&L ending balances are cumulative:
    //   - BS: point-in-time balance carries forward
    //   - P&L: YTD cumulative balance carries forward (needed so that
    //     injectNetIncomeIntoBalanceSheet picks up the correct cumulative
    //     net income in every period, keeping Assets = L + E)
    // netChange is NOT propagated — the activity belongs to the target
    // period only.  The income statement reads netChange, so it is
    // unaffected by this propagation.
    const targetIdx = nonTotalBucketKeys.indexOf(bucketKey);
    for (let i = targetIdx + 1; i < nonTotalBucketKeys.length; i++) {
      const subsequentKey = nonTotalBucketKeys[i];
      bucketed.endingBalance[subsequentKey] = (bucketed.endingBalance[subsequentKey] ?? 0) + amount;
      bucketed.beginningBalance[subsequentKey] = (bucketed.beginningBalance[subsequentKey] ?? 0) + amount;
    }

    // Also apply to the TOTAL bucket (it computes independently from raw GL
    // data, so pro forma adjustments must be added explicitly)
    if (hasTotalBucket) {
      bucketed.netChange["TOTAL"] = (bucketed.netChange["TOTAL"] ?? 0) + amount;
      bucketed.endingBalance["TOTAL"] = (bucketed.endingBalance["TOTAL"] ?? 0) + amount;
    }
  }

  for (const adj of adjustments) {
    const amount = Number(adj.amount);
    applyAmount(adj.master_account_id, Number(adj.period_year), Number(adj.period_month), amount);
    if (adj.offset_master_account_id) {
      applyAmount(adj.offset_master_account_id, Number(adj.period_year), Number(adj.period_month), -amount);
    }
  }
}

/**
 * Build pro forma adjustment detail records for frontend display.
 * Resolves account names from the master accounts list and maps each
 * adjustment to its period bucket key.
 */
function buildProFormaDetails(
  proFormaRows: RawProFormaAdjustment[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  masterAccounts: any[],
  entityLookup: Map<string, { name: string; code: string }>,
  buckets: PeriodBucket[],
) {
  // Build account lookup
  const accountMap = new Map<string, { name: string; account_number: string | null }>();
  for (const ma of masterAccounts) {
    accountMap.set(ma.id, { name: ma.name, account_number: ma.account_number });
  }

  // Build month-to-bucket lookup (skip TOTAL bucket — it would overwrite
  // monthly keys since it contains the same months as the real buckets)
  const monthToBucket = new Map<string, string>();
  for (const bucket of buckets) {
    if (bucket.key === "TOTAL") continue;
    for (const m of bucket.months) {
      monthToBucket.set(`${m.year}-${m.month}`, bucket.key);
    }
  }

  return proFormaRows
    .map((pf) => {
      const bucketKey = monthToBucket.get(`${pf.period_year}-${pf.period_month}`);
      if (!bucketKey) return null; // outside view range

      const account = accountMap.get(pf.master_account_id);
      const offsetAccount = pf.offset_master_account_id ? accountMap.get(pf.offset_master_account_id) : null;
      const entityInfo = entityLookup.get(pf.entity_id);

      return {
        id: pf.id,
        entityCode: entityInfo?.code ?? "",
        entityName: entityInfo?.name ?? "",
        accountNumber: account?.account_number ?? "",
        accountName: account?.name ?? "",
        offsetAccountNumber: offsetAccount?.account_number ?? null,
        offsetAccountName: offsetAccount?.name ?? null,
        description: pf.description,
        notes: pf.notes ?? null,
        periodYear: Number(pf.period_year),
        periodMonth: Number(pf.period_month),
        amount: Number(pf.amount),
        bucketKey,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
}

// ---------------------------------------------------------------------------
// Helper: expand allocation adjustments into pro-forma-style entries
// ---------------------------------------------------------------------------

interface RawAllocationAdjustment {
  source_entity_id: string;
  destination_entity_id: string;
  master_account_id: string;
  destination_master_account_id: string | null;
  amount: number;
  description: string;
  schedule_type: string;
  period_year: number | null;
  period_month: number | null;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  is_repeating: boolean;
  repeat_end_year: number | null;
  repeat_end_month: number | null;
}

/** One expanded leg of an allocation adjustment. counterpart_entity_id is set
 *  only for inter-entity allocations and names the entity holding the other
 *  leg of the pair — used to detect when a scope sees only one side. */
interface AllocationEntry {
  entity_id: string;
  master_account_id: string;
  period_year: number;
  period_month: number;
  amount: number;
  counterpart_entity_id?: string;
}

/** Push a +/- pair of entries for source and destination.
 *  For reclass (same entity, different accounts): -amt on source account, +amt on dest account.
 *  For inter-entity: -amt on source entity, +amt on destination entity (same account). */
function pushAllocPair(
  entries: AllocationEntry[],
  alloc: RawAllocationAdjustment,
  year: number,
  month: number,
  amt: number
) {
  if (alloc.destination_master_account_id) {
    // Intra-entity reclass: move between accounts within same entity
    entries.push({
      entity_id: alloc.source_entity_id,
      master_account_id: alloc.master_account_id,
      period_year: year,
      period_month: month,
      amount: -amt,
    });
    entries.push({
      entity_id: alloc.source_entity_id,
      master_account_id: alloc.destination_master_account_id,
      period_year: year,
      period_month: month,
      amount: amt,
    });
  } else {
    // Inter-entity: move between entities on same account
    entries.push({
      entity_id: alloc.source_entity_id,
      master_account_id: alloc.master_account_id,
      period_year: year,
      period_month: month,
      amount: -amt,
      counterpart_entity_id: alloc.destination_entity_id,
    });
    entries.push({
      entity_id: alloc.destination_entity_id,
      master_account_id: alloc.master_account_id,
      period_year: year,
      period_month: month,
      amount: amt,
      counterpart_entity_id: alloc.source_entity_id,
    });
  }
}

/**
 * Expand allocation adjustments into paired +/- entries per entity per period.
 * - single_month: one pair (or many pairs if is_repeating).
 * - monthly_spread: one pair per month in the range (amount divided equally).
 */
function expandAllocationAdjustments(
  allocations: RawAllocationAdjustment[]
): AllocationEntry[] {
  const entries: AllocationEntry[] = [];

  for (const alloc of allocations) {
    const totalAmount = Number(alloc.amount);

    if (alloc.schedule_type === "single_month") {
      if (alloc.period_year == null || alloc.period_month == null) continue;

      if (alloc.is_repeating && alloc.repeat_end_year != null && alloc.repeat_end_month != null) {
        // Repeating: full amount each month from period through repeat_end
        const totalMonths =
          (alloc.repeat_end_year - alloc.period_year) * 12 +
          (alloc.repeat_end_month - alloc.period_month) + 1;
        if (totalMonths < 1) continue;

        let y = alloc.period_year;
        let m = alloc.period_month;
        for (let i = 0; i < totalMonths; i++) {
          pushAllocPair(entries, alloc, y, m, totalAmount);
          m++;
          if (m > 12) { m = 1; y++; }
        }
      } else {
        // Single month, not repeating
        pushAllocPair(entries, alloc, alloc.period_year, alloc.period_month, totalAmount);
      }
    } else if (alloc.schedule_type === "monthly_spread") {
      if (
        alloc.start_year == null || alloc.start_month == null ||
        alloc.end_year == null || alloc.end_month == null
      ) continue;

      const totalMonths =
        (alloc.end_year - alloc.start_year) * 12 +
        (alloc.end_month - alloc.start_month) + 1;
      if (totalMonths < 1) continue;

      const monthlyAmount = totalAmount / totalMonths;

      let y = alloc.start_year;
      let m = alloc.start_month;
      for (let i = 0; i < totalMonths; i++) {
        pushAllocPair(entries, alloc, y, m, monthlyAmount);
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
  }

  return entries;
}

/**
 * Inject allocation adjustments into consolidatedBalances.
 * Works identically to injectProFormaAdjustments but with the expanded
 * allocation entries (which already include entity_id per entry).
 */
function injectAllocationAdjustments(
  consolidatedBalances: RawGLBalance[],
  entries: Array<{ master_account_id: string; period_year: number; period_month: number; amount: number }>,
  entityId: string
): void {
  // Re-use the same injection logic as pro forma
  injectProFormaAdjustments(consolidatedBalances, entries, entityId);
}

/**
 * Synthetic balance-sheet account holding the missing leg of cross-scope
 * allocation adjustments ("Due to/from affiliates").
 *
 * An inter-entity allocation expands into a balanced +/- pair of P&L legs,
 * one per entity.  When a statement scope (single entity or reporting
 * entity) contains only ONE side of the pair, that one-sided P&L leg shifts
 * the scope's net income — and therefore equity — with no offsetting
 * balance-sheet entry, so Assets ≠ Liabilities + Equity by exactly the net
 * cross-scope allocation amount.  (At consolidated scope both legs survive
 * and cancel, which is why only entity/RE views fail to balance.)
 *
 * GAAP-wise the missing leg of an unsettled affiliate allocation is an
 * intercompany settlement balance (ASC 850): "Due to/from affiliates".
 * buildAllocationDueToFromOffsets() generates that leg here, typed
 * "Other Current Liability" so it lands in BS current liabilities and in
 * the cash-flow operating working-capital section, where it nets against
 * the net-income shift (no cash moved, so the statement keeps articulating).
 */
const ALLOC_DUE_TO_FROM_ACCOUNT_ID = "__alloc_due_to_from__";

function makeAllocDueToFromAccount(): AccountInfo {
  return {
    id: ALLOC_DUE_TO_FROM_ACCOUNT_ID,
    name: "Due to/from affiliates (allocations)",
    accountNumber: null,
    classification: "Liability",
    accountType: "Other Current Liability",
    parentAccountId: null,
  };
}

/**
 * For each in-scope allocation leg whose counterpart entity is OUTSIDE the
 * scope, emit the offsetting "Due to/from affiliates" leg (same entity and
 * period, opposite amount).  Legs whose counterpart is also in scope cancel
 * naturally and get no offset, so consolidated output is unchanged.
 */
function buildAllocationDueToFromOffsets(
  entries: AllocationEntry[],
  isInScope: (entityId: string) => boolean
): AllocationEntry[] {
  const offsets: AllocationEntry[] = [];
  for (const e of entries) {
    if (!e.counterpart_entity_id) continue; // intra-entity reclass — already balanced
    if (isInScope(e.counterpart_entity_id)) continue; // both legs visible — nets out
    offsets.push({
      entity_id: e.entity_id,
      master_account_id: ALLOC_DUE_TO_FROM_ACCOUNT_ID,
      period_year: e.period_year,
      period_month: e.period_month,
      amount: -e.amount,
    });
  }
  return offsets;
}

// ---------------------------------------------------------------------------
// Helper: aggregate balances into buckets
// ---------------------------------------------------------------------------

interface AccountInfo {
  id: string;
  name: string;
  accountNumber: string | null;
  classification: string;
  accountType: string;
  isIntercompany?: boolean;
  parentAccountId?: string | null;
}

interface BucketedAmounts {
  /** P&L: sum of net_change across months in bucket */
  netChange: Record<string, number>;
  /** BS: ending_balance of last month in bucket */
  endingBalance: Record<string, number>;
  /** BS: beginning_balance of first month in bucket (for cash flow) */
  beginningBalance: Record<string, number>;
}

/**
 * Roll children's bucketed amounts up into their parent's row, then return
 * the filtered list of "displayable" accounts (parents + orphan-leaves).
 *
 * Used by charts that organize master accounts in a parent → children
 * hierarchy (the accountant chart). Charts without any parent assignments
 * are unaffected — every account is its own row, exactly as before.
 *
 * Mutates `aggregated` in place (children's entries are removed and the
 * parent's entry is replaced with the summed amounts).
 */
function applyParentRollup(
  accounts: AccountInfo[],
  aggregated: Map<string, BucketedAmounts>,
  buckets: PeriodBucket[],
): AccountInfo[] {
  const childrenByParent = new Map<string, AccountInfo[]>();
  for (const acct of accounts) {
    if (acct.parentAccountId) {
      const list = childrenByParent.get(acct.parentAccountId) ?? [];
      list.push(acct);
      childrenByParent.set(acct.parentAccountId, list);
    }
  }
  if (childrenByParent.size === 0) return accounts; // no parents — no-op

  // Sum each parent's children into the parent's BucketedAmounts.
  for (const [parentId, children] of childrenByParent) {
    const parentAmounts: BucketedAmounts = aggregated.get(parentId) ?? {
      netChange: {},
      endingBalance: {},
      beginningBalance: {},
    };
    for (const bucket of buckets) {
      let nc = parentAmounts.netChange[bucket.key] ?? 0;
      let eb = parentAmounts.endingBalance[bucket.key] ?? 0;
      let bb = parentAmounts.beginningBalance[bucket.key] ?? 0;
      for (const child of children) {
        const ca = aggregated.get(child.id);
        if (!ca) continue;
        nc += ca.netChange[bucket.key] ?? 0;
        eb += ca.endingBalance[bucket.key] ?? 0;
        bb += ca.beginningBalance[bucket.key] ?? 0;
      }
      parentAmounts.netChange[bucket.key] = nc;
      parentAmounts.endingBalance[bucket.key] = eb;
      parentAmounts.beginningBalance[bucket.key] = bb;
    }
    aggregated.set(parentId, parentAmounts);

    // Remove children from the aggregated map so they don't double-count
    // anywhere downstream that iterates over `aggregated`.
    for (const child of children) aggregated.delete(child.id);
  }

  // Drop children from the displayable account list. Parents stay; orphan-
  // leaves (no parent, no children) stay.
  const childIds = new Set(
    accounts.filter((a) => a.parentAccountId).map((a) => a.id),
  );
  return accounts.filter((a) => !childIds.has(a.id));
}

function aggregateByBucket(
  accounts: AccountInfo[],
  balances: RawGLBalance[],
  buckets: PeriodBucket[],
  fiscalYearStartMonth: number = 1
): Map<string, BucketedAmounts> {
  // Index balances by account_id -> "year-month" -> balance
  const balIndex = new Map<string, Map<string, RawGLBalance>>();
  for (const b of balances) {
    let accountMap = balIndex.get(b.account_id);
    if (!accountMap) {
      accountMap = new Map();
      balIndex.set(b.account_id, accountMap);
    }
    accountMap.set(`${b.period_year}-${b.period_month}`, b);
  }

  const result = new Map<string, BucketedAmounts>();

  for (const account of accounts) {
    const accountBalances = balIndex.get(account.id);
    const isPL =
      account.classification === "Revenue" ||
      account.classification === "Expense";
    const bucketed: BucketedAmounts = {
      netChange: {},
      endingBalance: {},
      beginningBalance: {},
    };

    for (const bucket of buckets) {
      let netChange = 0;
      let endingBal = 0;
      let beginningBal = 0;
      let foundFirst = false;

      for (const m of bucket.months) {
        const bal = accountBalances?.get(`${m.year}-${m.month}`);
        if (bal) {
          const pm = m.month === 1 ? 12 : m.month - 1;
          const py = m.month === 1 ? m.year - 1 : m.year;
          const priorBal = accountBalances?.get(`${py}-${pm}`);

          // Derive standalone monthly net change from ending balance
          // differences. The QBO trial balance stores cumulative YTD in
          // ending_balance/net_change for P&L accounts. Subtracting the
          // prior month's ending balance gives the true monthly activity.
          if (isPL && m.month === fiscalYearStartMonth) {
            // First month of fiscal year: P&L resets, YTD IS standalone
            netChange += bal.ending_balance;
          } else if (priorBal) {
            netChange += bal.ending_balance - priorBal.ending_balance;
          } else {
            // No prior month data — use ending_balance as best available
            netChange += bal.ending_balance;
          }

          endingBal = bal.ending_balance; // last one wins
          if (!foundFirst) {
            // Derive beginning balance from the PRIOR month's ending balance.
            // The DB's beginning_balance may be 0 if the sync didn't populate it.
            // collectAllMonths() already fetches prior-month data for this purpose.
            beginningBal = priorBal
              ? priorBal.ending_balance
              : bal.beginning_balance; // fallback to DB value
            foundFirst = true;
          }
        }
      }

      bucketed.netChange[bucket.key] = netChange;
      bucketed.endingBalance[bucket.key] = endingBal;
      bucketed.beginningBalance[bucket.key] = beginningBal;
    }

    result.set(account.id, bucketed);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper: reclassify entity "Expense" accounts to "Other Expense" by name
// ---------------------------------------------------------------------------

function reclassifyAccounts(accounts: AccountInfo[]): AccountInfo[] {
  return accounts.map((a) => {
    if (a.classification === "Expense" && a.accountType === "Expense") {
      const nameLower = a.name.toLowerCase();
      if (
        OTHER_EXPENSE_NAME_PATTERNS.some((pattern) =>
          nameLower.includes(pattern)
        )
      ) {
        return { ...a, accountType: "Other Expense" };
      }
    }
    return a;
  });
}

// ---------------------------------------------------------------------------
// Helper: build statement from sections config
// ---------------------------------------------------------------------------

function buildStatement(
  statementId: string,
  title: string,
  sectionConfigs: StatementSectionConfig[],
  computedConfigs: ComputedLineConfig[],
  accounts: AccountInfo[],
  aggregated: Map<string, BucketedAmounts>,
  buckets: PeriodBucket[],
  useNetChange: boolean, // true for P&L, false for BS
  budgetByAccount?: Map<string, Record<string, number>>, // account ID -> bucket key -> budget amount
  pyAggregated?: Map<string, BucketedAmounts> // prior year aggregated data for YoY
): StatementData {
  const sections: StatementSection[] = [];
  const sectionTotals: Record<string, Record<string, number>> = {};
  const sectionBudgetTotals: Record<string, Record<string, number>> = {};
  const sectionPyTotals: Record<string, Record<string, number>> = {};
  const hasBudget = budgetByAccount && budgetByAccount.size > 0;
  const hasPY = !!pyAggregated;
  const stmtType = statementId as "income_statement" | "balance_sheet" | "cash_flow";

  for (const config of sectionConfigs) {
    // Expense-classified sections: positive variance is unfavorable (over-budget)
    const isExpenseSection = config.classification === "Expense";

    const sectionAccounts = accounts.filter(
      (a) =>
        a.classification === config.classification &&
        config.accountTypes.includes(a.accountType) &&
        // Exclude "Net Income" equity account from balance sheet — the correct
        // amount is injected dynamically by injectNetIncomeIntoBalanceSheet
        !(statementId === "balance_sheet" &&
          config.classification === "Equity" &&
          a.name.toLowerCase().includes("net income"))
    );

    // Sort by account number
    sectionAccounts.sort((a, b) =>
      (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "")
    );

    // Build line items
    const lines: LineItem[] = [];
    const totals: Record<string, number> = {};
    const budgetTotals: Record<string, number> = {};
    const pyTotals: Record<string, number> = {};

    // Initialize totals
    for (const bucket of buckets) {
      totals[bucket.key] = 0;
      budgetTotals[bucket.key] = 0;
      pyTotals[bucket.key] = 0;
    }

    let lineIndex = 0;
    for (const account of sectionAccounts) {
      const bucketed = aggregated.get(account.id);
      const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
      const amounts: Record<string, number> = {};
      const budgetAmounts: Record<string, number> | undefined = hasBudget
        ? {}
        : undefined;
      const priorYearAmounts: Record<string, number> | undefined = hasPY
        ? {}
        : undefined;

      for (const bucket of buckets) {
        const raw = useNetChange
          ? (bucketed?.netChange[bucket.key] ?? 0)
          : (bucketed?.endingBalance[bucket.key] ?? 0);
        // Credit-normal accounts stored as negatives in GL, flip sign for display:
        // Revenue (net_change on P&L), Liability & Equity (ending_balance on BS)
        amounts[bucket.key] = useNetChange
          ? (config.classification === "Revenue" ? -raw : raw)
          : (config.classification === "Liability" || config.classification === "Equity" ? -raw : raw);
        totals[bucket.key] += amounts[bucket.key];

        // Prior year amounts
        if (hasPY && priorYearAmounts) {
          const pyRaw = useNetChange
            ? (pyBucketed?.netChange[bucket.key] ?? 0)
            : (pyBucketed?.endingBalance[bucket.key] ?? 0);
          priorYearAmounts[bucket.key] = useNetChange
            ? (config.classification === "Revenue" ? -pyRaw : pyRaw)
            : (config.classification === "Liability" || config.classification === "Equity" ? -pyRaw : pyRaw);
          pyTotals[bucket.key] += priorYearAmounts[bucket.key];
        }

        // Budget amounts (already stored as positive in budget_amounts table)
        if (hasBudget && budgetAmounts) {
          const acctBudget = budgetByAccount!.get(account.id);
          const budgetVal = acctBudget?.[bucket.key] ?? 0;
          budgetAmounts[bucket.key] = budgetVal;
          budgetTotals[bucket.key] += budgetVal;
        }
      }

      // Like the cash flow statement, the distributions equity account carries
      // flows in both directions (owner contributions in, distributions out), so
      // a net-contribution period would otherwise show a positive "Distributions".
      const displayLabel =
        statementId === "balance_sheet" &&
        config.classification === "Equity" &&
        account.name.toLowerCase().includes("distribution")
          ? "Contributions / (Distributions)"
          : account.name;

      lines.push({
        id: `${config.id}-${account.id}`,
        label: displayLabel,
        accountNumber: account.accountNumber ?? undefined,
        amounts,
        budgetAmounts,
        priorYearAmounts,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: lineIndex === 0,
        varianceInvertColor: isExpenseSection,
        drillDownMeta: {
          type: "account",
          masterAccountIds: [account.id],
          statementType: stmtType,
        },
      });
      lineIndex++;
    }

    sectionTotals[config.id] = totals;
    sectionBudgetTotals[config.id] = budgetTotals;
    sectionPyTotals[config.id] = pyTotals;

    // Subtotal line
    const subtotalLine: LineItem = {
      id: `${config.id}-total`,
      label: config.title ? `Total ${config.title}` : "",
      amounts: totals,
      budgetAmounts: hasBudget ? { ...budgetTotals } : undefined,
      priorYearAmounts: hasPY ? { ...pyTotals } : undefined,
      indent: 0,
      isTotal: true,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
      varianceInvertColor: isExpenseSection,
      drillDownMeta: {
        type: "section_total",
        sectionIds: [config.id],
        statementType: stmtType,
      },
    };

    sections.push({
      id: config.id,
      title: config.title,
      lines,
      subtotalLine,
    });
  }

  // Insert computed lines (gross profit, net income, total assets, etc.)
  // We'll flatten sections + computed lines into the final structure
  const finalSections: StatementSection[] = [];

  for (const section of sections) {
    finalSections.push(section);

    // Check if any computed lines go after this section
    const computedAfter = computedConfigs.filter(
      (c) => c.afterSection === section.id
    );

    for (const comp of computedAfter) {
      const amounts: Record<string, number> = {};
      const compBudgetAmounts: Record<string, number> | undefined = hasBudget
        ? {}
        : undefined;
      const compPyAmounts: Record<string, number> | undefined = hasPY
        ? {}
        : undefined;

      for (const bucket of buckets) {
        let val = 0;
        let budgetVal = 0;
        let pyVal = 0;
        for (const { sectionId, sign } of comp.formula) {
          val += (sectionTotals[sectionId]?.[bucket.key] ?? 0) * sign;
          if (hasBudget) {
            budgetVal +=
              (sectionBudgetTotals[sectionId]?.[bucket.key] ?? 0) * sign;
          }
          if (hasPY) {
            pyVal +=
              (sectionPyTotals[sectionId]?.[bucket.key] ?? 0) * sign;
          }
        }
        amounts[bucket.key] = val;
        if (compBudgetAmounts) {
          compBudgetAmounts[bucket.key] = budgetVal;
        }
        if (compPyAmounts) {
          compPyAmounts[bucket.key] = pyVal;
        }
      }

      // Create a pseudo-section with just the computed line
      finalSections.push({
        id: comp.id,
        title: "",
        lines: [],
        subtotalLine: {
          id: comp.id,
          label: comp.label,
          amounts,
          budgetAmounts: compBudgetAmounts,
          priorYearAmounts: compPyAmounts,
          indent: 0,
          isTotal: !comp.isGrandTotal,
          isGrandTotal: comp.isGrandTotal ?? false,
          isHeader: false,
          isSeparator: false,
          showDollarSign: true,
          drillDownMeta: {
            type: "computed",
            formula: comp.formula,
            statementType: stmtType,
          },
        },
      });

      // Add margin % line for key totals
      if (
        comp.id === "gross_margin" ||
        comp.id === "operating_margin" ||
        comp.id === "net_income"
      ) {
        const revenueKey = "revenue";
        const marginAmounts: Record<string, number> = {};
        const pyMarginAmounts: Record<string, number> | undefined = hasPY
          ? {}
          : undefined;
        const budgetMarginAmounts: Record<string, number> | undefined = hasBudget
          ? {}
          : undefined;
        for (const bucket of buckets) {
          const revenue = sectionTotals[revenueKey]?.[bucket.key] ?? 0;
          marginAmounts[bucket.key] =
            revenue !== 0 ? amounts[bucket.key] / revenue : 0;
          if (hasPY && pyMarginAmounts && compPyAmounts) {
            const pyRevenue = sectionPyTotals[revenueKey]?.[bucket.key] ?? 0;
            pyMarginAmounts[bucket.key] =
              pyRevenue !== 0 ? compPyAmounts[bucket.key] / pyRevenue : 0;
          }
          if (hasBudget && budgetMarginAmounts && compBudgetAmounts) {
            const budgetRevenue = sectionBudgetTotals[revenueKey]?.[bucket.key] ?? 0;
            budgetMarginAmounts[bucket.key] =
              budgetRevenue !== 0 ? compBudgetAmounts[bucket.key] / budgetRevenue : 0;
          }
        }

        const marginLabel =
          comp.id === "gross_margin"
            ? "Gross Margin %"
            : comp.id === "operating_margin"
              ? "EBITDA %"
              : "Net Income Margin %";

        finalSections.push({
          id: `${comp.id}_pct`,
          title: "",
          lines: [],
          subtotalLine: {
            id: `${comp.id}_pct`,
            label: marginLabel,
            amounts: marginAmounts,
            budgetAmounts: budgetMarginAmounts,
            priorYearAmounts: pyMarginAmounts,
            indent: 1,
            isTotal: false,
            isGrandTotal: false,
            isHeader: false,
            isSeparator: false,
            showDollarSign: false,
            drillDownMeta: { type: "percentage" },
          },
        });
      }
    }
  }

  // Remove empty headerless sections (e.g. Other Expense/Income with no
  // matching accounts) that would render as blank rows.  This is done after
  // computed line insertion so that afterSection references still resolve.
  const filteredSections = finalSections.filter(
    (s) => s.title || s.lines.length > 0 || s.subtotalLine?.label
  );

  return {
    id: statementId,
    title,
    sections: filteredSections,
  };
}

// ---------------------------------------------------------------------------
// Helper: inject Net Income into balance sheet equity section.
//
// QBO equity accounts (e.g. Retained Earnings) do NOT include the current
// fiscal year's net income until the books are closed.  To make the balance
// sheet balance (Assets = Liabilities + Equity) we compute cumulative YTD
// net income from P&L ending_balances and add it as a synthetic line in the
// equity section.
// ---------------------------------------------------------------------------

function injectNetIncomeIntoBalanceSheet(
  balanceSheet: StatementData,
  accounts: AccountInfo[],
  aggregated: Map<string, BucketedAmounts>,
  buckets: PeriodBucket[],
  pyAggregated?: Map<string, BucketedAmounts>
): void {
  const plAccounts = accounts.filter(
    (a) => a.classification === "Revenue" || a.classification === "Expense"
  );
  if (plAccounts.length === 0) return;

  // Revenue ending_balance is negative (credit-normal); Expense is positive
  // (debit-normal).  Net Income = -(sum of all P&L ending_balances).
  const niAmounts: Record<string, number> = {};
  const pyNiAmounts: Record<string, number> | undefined = pyAggregated
    ? {}
    : undefined;

  for (const bucket of buckets) {
    let plEnding = 0;
    let pyPlEnding = 0;

    for (const acct of plAccounts) {
      plEnding += aggregated.get(acct.id)?.endingBalance[bucket.key] ?? 0;
      if (pyAggregated) {
        pyPlEnding +=
          pyAggregated.get(acct.id)?.endingBalance[bucket.key] ?? 0;
      }
    }

    niAmounts[bucket.key] = -plEnding;
    if (pyNiAmounts) {
      pyNiAmounts[bucket.key] = -pyPlEnding;
    }
  }

  // Find equity section
  const equitySection = balanceSheet.sections.find((s) => s.id === "equity");
  if (!equitySection?.subtotalLine) return;

  // Add synthetic Net Income line
  equitySection.lines.push({
    id: "equity-net-income",
    label: "Net Income",
    amounts: niAmounts,
    priorYearAmounts: pyNiAmounts,
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: false,
    isSeparator: false,
    showDollarSign: equitySection.lines.length === 0,
  });

  // Update equity subtotal
  for (const bucket of buckets) {
    equitySection.subtotalLine.amounts[bucket.key] =
      (equitySection.subtotalLine.amounts[bucket.key] ?? 0) +
      niAmounts[bucket.key];

    if (pyNiAmounts && equitySection.subtotalLine.priorYearAmounts) {
      equitySection.subtotalLine.priorYearAmounts[bucket.key] =
        (equitySection.subtotalLine.priorYearAmounts[bucket.key] ?? 0) +
        pyNiAmounts[bucket.key];
    }
  }

  // Update computed lines that include equity
  for (const section of balanceSheet.sections) {
    if (
      (section.id === "total_equity" ||
        section.id === "total_liabilities_and_equity") &&
      section.subtotalLine
    ) {
      for (const bucket of buckets) {
        section.subtotalLine.amounts[bucket.key] =
          (section.subtotalLine.amounts[bucket.key] ?? 0) +
          niAmounts[bucket.key];

        if (pyNiAmounts && section.subtotalLine.priorYearAmounts) {
          section.subtotalLine.priorYearAmounts[bucket.key] =
            (section.subtotalLine.priorYearAmounts[bucket.key] ?? 0) +
            pyNiAmounts[bucket.key];
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-entity Net Income distribution (accountant-chart presentation).
//
// For combined-presentation balance sheets, equity is grouped by entity
// (e.g., "Accumulated deficit - Two Family", "Member's deficit - Silverco").
// Instead of surfacing a standalone "Net Income" line, allocate each entity's
// YTD net income directly into its accumulated-deficit / member's-equity
// rollup so the section matches the compiled financial-statement layout.
//
// Routing is auto-detected: an Equity rollup parent qualifies as an
// NI absorber when (a) its descendant mappings reference exactly one
// entity, and (b) its name matches deficit/retained/earnings/member's
// equity (excluding common stock / paid-in / distributions, which are
// capital, not earnings).
// ---------------------------------------------------------------------------

function findEntityNIDestinations(
  masterAccounts: Array<{
    id: string;
    name: string;
    classification: string;
    parent_account_id?: string | null;
  }>,
  mappings: Array<{ master_account_id: string; entity_id: string }>,
): Map<string, string> {
  const result = new Map<string, string>();

  const parentIds = new Set<string>();
  for (const m of masterAccounts) {
    if (m.parent_account_id) parentIds.add(m.parent_account_id);
  }

  const childrenByParent = new Map<string, string[]>();
  for (const m of masterAccounts) {
    if (!m.parent_account_id) continue;
    const arr = childrenByParent.get(m.parent_account_id) ?? [];
    arr.push(m.id);
    childrenByParent.set(m.parent_account_id, arr);
  }

  const mappingsByMaster = new Map<string, string[]>();
  for (const mp of mappings) {
    const arr = mappingsByMaster.get(mp.master_account_id) ?? [];
    arr.push(mp.entity_id);
    mappingsByMaster.set(mp.master_account_id, arr);
  }

  for (const parent of masterAccounts) {
    if ((parent.classification ?? "").toLowerCase() !== "equity") continue;
    if (!parentIds.has(parent.id)) continue;

    const nameLower = (parent.name ?? "").toLowerCase();
    const matchesReceiver =
      /(deficit|retained|earnings|member.s equity)/.test(nameLower) &&
      !/(common stock|paid.in|distributions)/.test(nameLower);
    if (!matchesReceiver) continue;

    const queue = [parent.id];
    const seen = new Set([parent.id]);
    const entityIds = new Set<string>();
    while (queue.length) {
      const cur = queue.shift() as string;
      for (const eid of mappingsByMaster.get(cur) ?? []) entityIds.add(eid);
      for (const child of childrenByParent.get(cur) ?? []) {
        if (!seen.has(child)) {
          seen.add(child);
          queue.push(child);
        }
      }
    }
    if (entityIds.size !== 1) continue;
    const [eid] = [...entityIds];
    result.set(eid, parent.id);
  }

  return result;
}

function computePerEntityNI(
  consolidatedAccounts: AccountInfo[],
  masterAccounts: Array<{ id: string; classification: string }>,
  mappings: Array<{ master_account_id: string; entity_id: string; account_id: string }>,
  glBalances: RawGLBalance[],
  buckets: PeriodBucket[],
  fiscalYearStartMonth: number,
): Map<string, Record<string, number>> {
  const plMasterIds = new Set(
    masterAccounts
      .filter(
        (m) => m.classification === "Revenue" || m.classification === "Expense",
      )
      .map((m) => m.id),
  );

  // entityId -> masterId -> entity-account ids
  const byEntityMaster = new Map<string, Map<string, string[]>>();
  for (const mp of mappings) {
    if (!plMasterIds.has(mp.master_account_id)) continue;
    let perEntity = byEntityMaster.get(mp.entity_id);
    if (!perEntity) {
      perEntity = new Map();
      byEntityMaster.set(mp.entity_id, perEntity);
    }
    const arr = perEntity.get(mp.master_account_id) ?? [];
    arr.push(mp.account_id);
    perEntity.set(mp.master_account_id, arr);
  }

  const result = new Map<string, Record<string, number>>();

  for (const [entityId, masterToAccts] of byEntityMaster) {
    const eGl = glBalances.filter((b) => b.entity_id === entityId);
    const byAcct = new Map<string, RawGLBalance[]>();
    for (const b of eGl) {
      const arr = byAcct.get(b.account_id) ?? [];
      arr.push(b);
      byAcct.set(b.account_id, arr);
    }

    const eConsolidated: RawGLBalance[] = [];
    for (const [masterId, acctIds] of masterToAccts) {
      const periodMap = new Map<
        string,
        { beginning: number; ending: number; netChange: number }
      >();
      for (const acctId of acctIds) {
        for (const b of byAcct.get(acctId) ?? []) {
          const key = `${b.period_year}-${b.period_month}`;
          const cur = periodMap.get(key) ?? {
            beginning: 0,
            ending: 0,
            netChange: 0,
          };
          cur.beginning += b.beginning_balance;
          cur.ending += b.ending_balance;
          cur.netChange += b.net_change;
          periodMap.set(key, cur);
        }
      }
      for (const [key, v] of periodMap) {
        const [y, m] = key.split("-").map(Number);
        eConsolidated.push({
          account_id: masterId,
          entity_id: entityId,
          period_year: y,
          period_month: m,
          beginning_balance: v.beginning,
          ending_balance: v.ending,
          net_change: v.netChange,
        });
      }
    }

    // Use the ORIGINAL masterAccounts list for the iteration shape so that
    // IC-flagged P&L masters (which the IC-elimination block has already
    // removed from `consolidatedAccounts`) are still included. At the entity
    // level, IC revenue/expense is real income/expense — it only cancels at
    // the consolidated total. Excluding it would shift each entity's NI by
    // its IC contribution and misallocate equity even though the total stays
    // correct.
    const eAggregated = aggregateByBucket(
      masterAccounts as unknown as AccountInfo[],
      eConsolidated,
      buckets,
      fiscalYearStartMonth,
    );

    const niByBucket: Record<string, number> = {};
    for (const bucket of buckets) {
      let plEnding = 0;
      for (const a of masterAccounts) {
        if (a.classification !== "Revenue" && a.classification !== "Expense")
          continue;
        plEnding += eAggregated.get(a.id)?.endingBalance[bucket.key] ?? 0;
      }
      niByBucket[bucket.key] = -plEnding;
    }
    result.set(entityId, niByBucket);
  }

  return result;
}

// Per-entity NI from raw GL won't include adjustments that aren't
// entity-tagged (year-end adjustments are chart-scoped, not per-entity).
// Reconcile to the displayed total NI by attributing the residual to the
// entity carrying the largest |NI| — keeps Assets = L + E with zero standalone
// adjustment line.
// Pre-allocate entity-tagged year-end adjustments to per-entity NI before
// the largest-|NI| residual fallback runs. An adjustment with entity_id
// set on a P&L master shifts that entity's NI by -amount (amount is added
// to the master's ending; NI = -plEnding so the sign flips).
function applyEntityTaggedYearAdjustments(
  niByEntity: Map<string, Record<string, number>>,
  yearAdjRows: Array<{
    master_account_id: string;
    period_year: number;
    amount: number;
    entity_id?: string | null;
  }>,
  masterAccounts: Array<{ id: string; classification: string }>,
  buckets: PeriodBucket[],
): void {
  const monthToBucket = new Map<string, string>();
  const hasTotalBucket = buckets.some((b) => b.key === "TOTAL");
  for (const bucket of buckets) {
    if (bucket.key === "TOTAL") continue;
    for (const m of bucket.months) {
      monthToBucket.set(`${m.year}-${m.month}`, bucket.key);
    }
  }
  const masterById = new Map(masterAccounts.map((m) => [m.id, m]));

  for (const adj of yearAdjRows) {
    if (!adj.entity_id) continue;
    const ma = masterById.get(adj.master_account_id);
    if (!ma) continue;
    if (ma.classification !== "Revenue" && ma.classification !== "Expense") continue;
    const bucketKey = monthToBucket.get(`${adj.period_year}-12`);
    if (!bucketKey) continue;

    const shift = -Number(adj.amount);
    const ni = niByEntity.get(adj.entity_id) ?? {};
    ni[bucketKey] = (ni[bucketKey] ?? 0) + shift;
    if (hasTotalBucket) {
      ni["TOTAL"] = (ni["TOTAL"] ?? 0) + shift;
    }
    niByEntity.set(adj.entity_id, ni);
  }
}

function reconcileEntityNIToTotal(
  niByEntity: Map<string, Record<string, number>>,
  niDestinations: Map<string, string>,
  totalNIByBucket: Record<string, number>,
  buckets: PeriodBucket[],
): void {
  for (const bucket of buckets) {
    let sum = 0;
    let largestEntityId: string | null = null;
    let largestAbs = -1;
    for (const eid of niDestinations.keys()) {
      const v = niByEntity.get(eid)?.[bucket.key] ?? 0;
      sum += v;
      if (Math.abs(v) > largestAbs) {
        largestAbs = Math.abs(v);
        largestEntityId = eid;
      }
    }
    if (largestEntityId === null) {
      const first = niDestinations.keys().next();
      if (first.done) continue;
      largestEntityId = first.value;
    }
    const total = totalNIByBucket[bucket.key] ?? 0;
    const residual = total - sum;
    if (Math.abs(residual) < 0.005) continue;

    const ni = niByEntity.get(largestEntityId) ?? {};
    ni[bucket.key] = (ni[bucket.key] ?? 0) + residual;
    niByEntity.set(largestEntityId, ni);
  }
}

function applyEntityNIToBalanceSheet(
  balanceSheet: StatementData,
  niByEntity: Map<string, Record<string, number>>,
  pyNiByEntity: Map<string, Record<string, number>> | undefined,
  niDestinations: Map<string, string>,
  buckets: PeriodBucket[],
): void {
  const equitySection = balanceSheet.sections.find((s) => s.id === "equity");
  if (!equitySection?.subtotalLine) return;

  const totalNI: Record<string, number> = {};
  const totalPyNI: Record<string, number> = {};
  for (const bucket of buckets) {
    totalNI[bucket.key] = 0;
    totalPyNI[bucket.key] = 0;
  }

  for (const [entityId, destMasterId] of niDestinations) {
    const ni = niByEntity.get(entityId);
    if (!ni) continue;
    const pyNi = pyNiByEntity?.get(entityId);

    const lineId = `equity-${destMasterId}`;
    const line = equitySection.lines.find((l) => l.id === lineId);
    if (!line) continue;

    for (const bucket of buckets) {
      const v = ni[bucket.key] ?? 0;
      line.amounts[bucket.key] = (line.amounts[bucket.key] ?? 0) + v;
      totalNI[bucket.key] += v;

      if (pyNi && line.priorYearAmounts) {
        const pyV = pyNi[bucket.key] ?? 0;
        line.priorYearAmounts[bucket.key] =
          (line.priorYearAmounts[bucket.key] ?? 0) + pyV;
        totalPyNI[bucket.key] += pyV;
      }
    }
  }

  for (const bucket of buckets) {
    equitySection.subtotalLine.amounts[bucket.key] =
      (equitySection.subtotalLine.amounts[bucket.key] ?? 0) +
      (totalNI[bucket.key] ?? 0);
    if (pyNiByEntity && equitySection.subtotalLine.priorYearAmounts) {
      equitySection.subtotalLine.priorYearAmounts[bucket.key] =
        (equitySection.subtotalLine.priorYearAmounts[bucket.key] ?? 0) +
        (totalPyNI[bucket.key] ?? 0);
    }
  }

  for (const section of balanceSheet.sections) {
    if (
      (section.id === "total_equity" ||
        section.id === "total_liabilities_and_equity") &&
      section.subtotalLine
    ) {
      for (const bucket of buckets) {
        section.subtotalLine.amounts[bucket.key] =
          (section.subtotalLine.amounts[bucket.key] ?? 0) +
          (totalNI[bucket.key] ?? 0);
        if (pyNiByEntity && section.subtotalLine.priorYearAmounts) {
          section.subtotalLine.priorYearAmounts[bucket.key] =
            (section.subtotalLine.priorYearAmounts[bucket.key] ?? 0) +
            (totalPyNI[bucket.key] ?? 0);
        }
      }
    }
  }
}

/**
 * If any pro forma adjustments were redirected away from Bank accounts
 * (into the synthetic PRO_FORMA_ADJ_ACCOUNT_ID), inject a visible
 * "Pro Forma Adjustments" line into the Stockholders' Equity section of
 * the balance sheet and update all affected subtotals / computed lines.
 *
 * The redirected amount is debit-normal (from the bank account side),
 * but equity is credit-normal, so the sign is flipped for display.
 * This effectively offsets the Net Income increase from the P&L side
 * of the same pro forma entry, making the balance sheet net-neutral
 * for bank-targeting adjustments while keeping the income statement
 * impact visible.
 *
 * This mirrors the pattern used by injectNetIncomeIntoBalanceSheet().
 */
function injectProFormaAdjustmentsIntoBalanceSheet(
  balanceSheet: StatementData,
  aggregated: Map<string, BucketedAmounts>,
  buckets: PeriodBucket[],
  pyAggregated?: Map<string, BucketedAmounts>
): void {
  const bucketed = aggregated.get(PRO_FORMA_ADJ_ACCOUNT_ID);
  if (!bucketed) return; // no bank-targeting pro forma adjustments

  // Check if there is any non-zero value
  const hasValue = buckets.some((b) => (bucketed.endingBalance[b.key] ?? 0) !== 0);
  if (!hasValue) return;

  // Build amounts for the synthetic line.
  // The raw value is debit-normal (positive = debit), but equity accounts
  // are displayed with sign flip (credit-normal → negate for display).
  const amounts: Record<string, number> = {};
  const pyAmounts: Record<string, number> | undefined = pyAggregated ? {} : undefined;

  for (const bucket of buckets) {
    amounts[bucket.key] = -(bucketed.endingBalance[bucket.key] ?? 0);
    if (pyAmounts && pyAggregated) {
      const pyBucketed = pyAggregated.get(PRO_FORMA_ADJ_ACCOUNT_ID);
      pyAmounts[bucket.key] = -(pyBucketed?.endingBalance[bucket.key] ?? 0);
    }
  }

  // Find the equity section
  const equitySection = balanceSheet.sections.find(
    (s) => s.id === "equity"
  );
  if (!equitySection?.subtotalLine) return;

  // Add the synthetic line at the end of equity
  equitySection.lines.push({
    id: "equity-pro-forma-adj",
    label: "Pro Forma Adjustments",
    amounts,
    priorYearAmounts: pyAmounts,
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: false,
    isSeparator: false,
    showDollarSign: equitySection.lines.length === 0,
  });

  // Update the equity subtotal
  for (const bucket of buckets) {
    equitySection.subtotalLine.amounts[bucket.key] =
      (equitySection.subtotalLine.amounts[bucket.key] ?? 0) +
      amounts[bucket.key];

    if (pyAmounts && equitySection.subtotalLine.priorYearAmounts) {
      equitySection.subtotalLine.priorYearAmounts[bucket.key] =
        (equitySection.subtotalLine.priorYearAmounts[bucket.key] ?? 0) +
        pyAmounts[bucket.key];
    }
  }

  // Update computed lines that include equity
  for (const section of balanceSheet.sections) {
    if (
      (section.id === "total_equity" ||
        section.id === "total_liabilities_and_equity") &&
      section.subtotalLine
    ) {
      for (const bucket of buckets) {
        section.subtotalLine.amounts[bucket.key] =
          (section.subtotalLine.amounts[bucket.key] ?? 0) +
          amounts[bucket.key];

        if (pyAmounts && section.subtotalLine.priorYearAmounts) {
          section.subtotalLine.priorYearAmounts[bucket.key] =
            (section.subtotalLine.priorYearAmounts[bucket.key] ?? 0) +
            pyAmounts[bucket.key];
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cash flow supplemental section types and helpers
// ---------------------------------------------------------------------------

/** A single adjustment entry for the cash flow supplemental section */
interface CashFlowSupplementalEntry {
  description: string;
  primaryAccountId: string;
  offsetAccountId?: string;
  periodYear: number;
  periodMonth: number;
  amount: number;
}

/**
 * Compute the net cash impact of a double-entry adjustment.
 * If either account is a Bank (cash) type, there is a real cash impact.
 * Otherwise the adjustment is non-cash and the net impact is $0.
 */
function computeNetCashImpact(
  amount: number,
  primaryAccountType: string,
  offsetAccountType: string
): number {
  const primaryIsBank = CASH_ACCOUNT_TYPES.includes(primaryAccountType);
  const offsetIsBank = CASH_ACCOUNT_TYPES.includes(offsetAccountType);

  if (primaryIsBank && offsetIsBank) return 0;
  if (primaryIsBank) return amount;      // Debit to cash = cash increases
  if (offsetIsBank) return -amount;      // Credit to cash = cash decreases
  return 0;                              // Neither is cash — non-cash adjustment
}

/**
 * Build supplemental entries for intra-entity reclass allocations.
 * Inter-entity transfers net to zero at consolidated level and are omitted.
 */
function buildAllocationSupplementalEntries(
  allocRows: RawAllocationAdjustment[],
  buckets: PeriodBucket[]
): CashFlowSupplementalEntry[] {
  const entries: CashFlowSupplementalEntry[] = [];

  for (const alloc of allocRows) {
    // Only include intra-entity reclass (same entity, different accounts)
    if (!alloc.destination_master_account_id) continue;
    if (alloc.source_entity_id !== alloc.destination_entity_id) continue;

    const totalAmount = Number(alloc.amount);

    // Determine which months this allocation covers
    if (alloc.schedule_type === "single_month") {
      if (alloc.period_year == null || alloc.period_month == null) continue;

      if (alloc.is_repeating && alloc.repeat_end_year != null && alloc.repeat_end_month != null) {
        const totalMonths =
          (alloc.repeat_end_year - alloc.period_year) * 12 +
          (alloc.repeat_end_month - alloc.period_month) + 1;
        if (totalMonths < 1) continue;
        let y = alloc.period_year;
        let m = alloc.period_month;
        for (let i = 0; i < totalMonths; i++) {
          entries.push({
            description: alloc.description,
            primaryAccountId: alloc.master_account_id,
            offsetAccountId: alloc.destination_master_account_id,
            periodYear: y,
            periodMonth: m,
            amount: totalAmount,
          });
          m++;
          if (m > 12) { m = 1; y++; }
        }
      } else {
        entries.push({
          description: alloc.description,
          primaryAccountId: alloc.master_account_id,
          offsetAccountId: alloc.destination_master_account_id,
          periodYear: alloc.period_year,
          periodMonth: alloc.period_month,
          amount: totalAmount,
        });
      }
    } else if (alloc.schedule_type === "monthly_spread") {
      if (
        alloc.start_year == null || alloc.start_month == null ||
        alloc.end_year == null || alloc.end_month == null
      ) continue;

      const totalMonths =
        (alloc.end_year - alloc.start_year) * 12 +
        (alloc.end_month - alloc.start_month) + 1;
      if (totalMonths < 1) continue;

      const monthlyAmount = totalAmount / totalMonths;
      let y = alloc.start_year;
      let m = alloc.start_month;
      for (let i = 0; i < totalMonths; i++) {
        entries.push({
          description: alloc.description,
          primaryAccountId: alloc.master_account_id,
          offsetAccountId: alloc.destination_master_account_id,
          periodYear: y,
          periodMonth: m,
          amount: monthlyAmount,
        });
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Helper: build cash flow statement (indirect method)
// ---------------------------------------------------------------------------

function buildCashFlowStatement(
  accounts: AccountInfo[],
  aggregated: Map<string, BucketedAmounts>,
  buckets: PeriodBucket[],
  netIncomeByBucket: Record<string, number>,
  pyAggregated?: Map<string, BucketedAmounts>,
  pyNetIncomeByBucket?: Record<string, number>,
  supplementalEntries?: CashFlowSupplementalEntry[],
  assetCashFlows?: AssetCashFlows,
  scheduleCashFlows?: ScheduleCashFlows
): StatementData {
  const sections: StatementSection[] = [];
  const hasPY = !!pyAggregated;

  // Classification helpers (cash-flow geography, ASC 230).
  // Line-of-credit / short-term debt accounts are credit-normal "Other Current
  // Liability" but their movement is a FINANCING activity, not operating.
  const isLineOfCredit = (a: AccountInfo) => {
    const n = a.name.toLowerCase();
    return LINE_OF_CREDIT_NAME_PATTERNS.some((p) => n.includes(p));
  };
  // Goodwill / intangible assets: their carrying-value decline is non-cash
  // amortization (added back in Operating, excluded from Investing).
  const isIntangibleAsset = (a: AccountInfo) => {
    const n = a.name.toLowerCase();
    return INTANGIBLE_ASSET_NAME_PATTERNS.some((p) => n.includes(p));
  };
  // Synthetic intercompany-elimination accounts should not appear on the face
  // of the consolidated statement of cash flows.
  const isIntercompanyElim = (a: AccountInfo) => {
    const n = a.name.toLowerCase();
    return a.id.startsWith("__intercompany") || n.includes("intercompany elimination");
  };

  // --- Compute D&A from GL expense accounts ---
  // Depreciation/amortization expense accounts are identified by name pattern.
  // Their netChange (debit-normal, positive) is the non-cash expense to add back.
  // Accounts whose names also match the intangible patterns (e.g. "Amortization
  // of Goodwill") are tracked separately: they belong in the Operating add-back
  // but NOT in the Investing depreciation offset, which must stay tangible-only —
  // intangible masters are excluded from Investing, so their amortization is not
  // embedded in the P&E carrying-value change.
  const daAccounts = accounts.filter((a) => {
    if (a.classification !== "Expense") return false;
    const nameLower = a.name.toLowerCase();
    return nameLower.includes("depreciation") || nameLower.includes("amortization");
  });
  const tangibleDepAccounts = daAccounts.filter((a) => !isIntangibleAsset(a));
  const intangibleAmortExpenseAccounts = daAccounts.filter((a) => isIntangibleAsset(a));

  // Tangible depreciation only — this is the figure the Investing section nets
  // out of the P&E carrying-value change.
  const depreciationByBucket: Record<string, number> = {};
  const pyDepreciationByBucket: Record<string, number> = {};
  // Intangible amortization expense — Operating add-back only.
  const intangibleAmortExpenseByBucket: Record<string, number> = {};
  const pyIntangibleAmortExpenseByBucket: Record<string, number> = {};
  for (const bucket of buckets) {
    let total = 0;
    let pyTotal = 0;
    let amortExp = 0;
    let pyAmortExp = 0;
    for (const acct of tangibleDepAccounts) {
      total += aggregated.get(acct.id)?.netChange[bucket.key] ?? 0;
      if (hasPY) {
        pyTotal += pyAggregated!.get(acct.id)?.netChange[bucket.key] ?? 0;
      }
    }
    for (const acct of intangibleAmortExpenseAccounts) {
      amortExp += aggregated.get(acct.id)?.netChange[bucket.key] ?? 0;
      if (hasPY) {
        pyAmortExp += pyAggregated!.get(acct.id)?.netChange[bucket.key] ?? 0;
      }
    }
    depreciationByBucket[bucket.key] = total;
    pyDepreciationByBucket[bucket.key] = pyTotal;
    intangibleAmortExpenseByBucket[bucket.key] = amortExp;
    pyIntangibleAmortExpenseByBucket[bucket.key] = pyAmortExp;
  }

  // --- Non-cash intangible / goodwill amortization (ASC 230-10-45-28) ---
  // The period decline in the carrying value of goodwill/intangible (Other Asset)
  // masters is non-cash amortization.  The same accounts are excluded from
  // Investing below, so amortization never shows up as an investing "source".
  // When the chart has dedicated intangible-amortization EXPENSE accounts (e.g.
  // "Amortization of Goodwill"), those carry the Operating add-back and the
  // carrying-value decline must NOT also be added — it is the same amortization,
  // and adding both overstated Operating while the expense distorted the
  // Investing offset.  The carrying-decline derivation is kept only as a
  // fallback for charts where amortization is booked directly against the asset
  // with no pattern-matched expense account.
  const useCarryingDeclineFallback = intangibleAmortExpenseAccounts.length === 0;
  const intangibleAssets = accounts.filter(
    (a) => INVESTING_ACCOUNT_TYPES.includes(a.accountType) && isIntangibleAsset(a)
  );
  const intangibleAmortByBucket: Record<string, number> = {};
  const pyIntangibleAmortByBucket: Record<string, number> = {};
  for (const bucket of buckets) {
    let amt = 0;
    let pyAmt = 0;
    if (useCarryingDeclineFallback) {
      for (const acct of intangibleAssets) {
        const b = aggregated.get(acct.id);
        // Debit-normal asset: a decline (beginning > ending) is positive amortization.
        amt += (b?.beginningBalance[bucket.key] ?? 0) - (b?.endingBalance[bucket.key] ?? 0);
        if (hasPY) {
          const pb = pyAggregated!.get(acct.id);
          pyAmt += (pb?.beginningBalance[bucket.key] ?? 0) - (pb?.endingBalance[bucket.key] ?? 0);
        }
      }
    }
    intangibleAmortByBucket[bucket.key] = amt;
    pyIntangibleAmortByBucket[bucket.key] = pyAmt;
  }
  // Combined non-cash D&A shown on the single "Depreciation and amortization" line.
  const daDisplayByBucket: Record<string, number> = {};
  const pyDaDisplayByBucket: Record<string, number> = {};
  for (const bucket of buckets) {
    daDisplayByBucket[bucket.key] =
      (depreciationByBucket[bucket.key] ?? 0) +
      (intangibleAmortExpenseByBucket[bucket.key] ?? 0) +
      (intangibleAmortByBucket[bucket.key] ?? 0);
    pyDaDisplayByBucket[bucket.key] =
      (pyDepreciationByBucket[bucket.key] ?? 0) +
      (pyIntangibleAmortExpenseByBucket[bucket.key] ?? 0) +
      (pyIntangibleAmortByBucket[bucket.key] ?? 0);
  }

  // Gain/(loss) on disposals. A gain is non-cash (it's in net income), so it is
  // removed from Operating and the full proceeds show in Investing
  // (ASC 230-10-45-28).  Reclassifying it INCREASES Investing and DECREASES
  // Operating by the same amount, so net change in cash is unchanged and the
  // statement keeps articulating.
  //
  // The figure is sourced from the GL gain/loss-on-disposal accounts because the
  // add-back must reverse exactly what is inside net income — when the
  // fixed-asset subledger's disposed_book_gain_loss disagrees with the GL, using
  // the subledger number makes the income statement and cash flow show disposals
  // moving in opposite directions.  The subledger figure is kept only as a
  // fallback for charts with no GL gain/loss account; any subledger-vs-GL drift
  // then sits in the Investing reconciling line where it belongs.
  const disposalGainLossAccounts = accounts.filter((a) => {
    if (["Asset", "Liability", "Equity"].includes(a.classification)) return false;
    const n = a.name.toLowerCase();
    return (
      (n.includes("gain") || n.includes("loss")) &&
      (n.includes("sale") || n.includes("disposal") || n.includes("disposition"))
    );
  });
  const gainLossByBucket: Record<string, number> = {};
  const pyGainLossByBucket: Record<string, number> = {};
  if (disposalGainLossAccounts.length > 0) {
    for (const bucket of buckets) {
      let net = 0;
      let pyNet = 0;
      for (const acct of disposalGainLossAccounts) {
        // Raw GL sign: debit (loss) positive, credit (gain) negative.
        net += aggregated.get(acct.id)?.netChange[bucket.key] ?? 0;
        if (hasPY) pyNet += pyAggregated!.get(acct.id)?.netChange[bucket.key] ?? 0;
      }
      gainLossByBucket[bucket.key] = -net; // positive = gain
      pyGainLossByBucket[bucket.key] = -pyNet;
    }
  } else {
    Object.assign(gainLossByBucket, assetCashFlows?.gainLossByBucket ?? {});
  }
  const hasGainLoss = buckets.some((b) => Math.abs(gainLossByBucket[b.key] ?? 0) > 0.5);

  // --- OPERATING ACTIVITIES ---
  const operatingLines: LineItem[] = [];

  // Net income
  operatingLines.push({
    id: "cf-net-income",
    label: "Net income",
    amounts: { ...netIncomeByBucket },
    priorYearAmounts: hasPY ? { ...pyNetIncomeByBucket! } : undefined,
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: false,
    isSeparator: false,
    showDollarSign: true,
    drillDownMeta: { type: "none" },
  });

  // Depreciation adjustment
  operatingLines.push({
    id: "cf-adjustments-header",
    label: "Adjustments to reconcile net income to net cash:",
    amounts: {},
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: true,
    isSeparator: false,
    showDollarSign: false,
  });

  operatingLines.push({
    id: "cf-depreciation",
    label: "Depreciation and amortization",
    amounts: { ...daDisplayByBucket },
    priorYearAmounts: hasPY ? { ...pyDaDisplayByBucket } : undefined,
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: false,
    isSeparator: false,
    showDollarSign: false,
    drillDownMeta: { type: "none" },
  });

  // (Gain)/loss on disposal of property & equipment — non-cash, removed from
  // operating so the full proceeds appear in Investing. Gain → negative (deduct
  // from net income); loss → positive (add back).
  if (hasGainLoss) {
    const glAddBack: Record<string, number> = {};
    const pyGlAddBack: Record<string, number> = {};
    for (const bucket of buckets) {
      glAddBack[bucket.key] = -(gainLossByBucket[bucket.key] ?? 0);
      pyGlAddBack[bucket.key] = -(pyGainLossByBucket[bucket.key] ?? 0);
    }
    operatingLines.push({
      id: "cf-gain-loss-disposal",
      label: "(Gain) loss on disposal of property and equipment",
      amounts: glAddBack,
      priorYearAmounts: hasPY ? pyGlAddBack : undefined,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
      drillDownMeta: { type: "none" },
    });
  }

  // Working capital changes header
  operatingLines.push({
    id: "cf-wc-header",
    label: "Changes in operating assets and liabilities:",
    amounts: {},
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: true,
    isSeparator: false,
    showDollarSign: false,
  });

  // Group working capital accounts
  const wcAssets = accounts.filter((a) =>
    OPERATING_CURRENT_ASSET_TYPES.includes(a.accountType)
  );
  // Exclude line-of-credit / short-term debt — reclassified to Financing (ASC 230).
  const wcLiabilities = accounts.filter(
    (a) => OPERATING_CURRENT_LIABILITY_TYPES.includes(a.accountType) && !isLineOfCredit(a)
  );

  const operatingTotal: Record<string, number> = {};
  const pyOperatingTotal: Record<string, number> = {};
  for (const bucket of buckets) {
    operatingTotal[bucket.key] =
      (netIncomeByBucket[bucket.key] ?? 0) +
      (depreciationByBucket[bucket.key] ?? 0) +
      (intangibleAmortExpenseByBucket[bucket.key] ?? 0) +
      (intangibleAmortByBucket[bucket.key] ?? 0) -
      (gainLossByBucket[bucket.key] ?? 0); // remove non-cash gain / add back loss
    pyOperatingTotal[bucket.key] = hasPY
      ? (pyNetIncomeByBucket![bucket.key] ?? 0) +
        (pyDepreciationByBucket![bucket.key] ?? 0) +
        (pyIntangibleAmortExpenseByBucket[bucket.key] ?? 0) +
        (pyIntangibleAmortByBucket[bucket.key] ?? 0)
      : 0;
  }

  // Working capital asset changes (increase in asset = cash outflow, negative)
  for (const account of wcAssets) {
    const bucketed = aggregated.get(account.id);
    const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
    const amounts: Record<string, number> = {};
    const pyAmounts: Record<string, number> | undefined = hasPY ? {} : undefined;
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      amounts[bucket.key] = -change;
      operatingTotal[bucket.key] += -change;

      if (hasPY && pyAmounts) {
        const pyChange =
          (pyBucketed?.endingBalance[bucket.key] ?? 0) -
          (pyBucketed?.beginningBalance[bucket.key] ?? 0);
        pyAmounts[bucket.key] = -pyChange;
        pyOperatingTotal[bucket.key] += -pyChange;
      }
    }
    operatingLines.push({
      id: `cf-wc-${account.id}`,
      label: account.name,
      amounts,
      priorYearAmounts: pyAmounts,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
      drillDownMeta: {
        type: "account",
        masterAccountIds: [account.id],
        statementType: "cash_flow",
      },
    });
  }

  // Working capital liability changes (increase in liability = cash inflow, positive)
  for (const account of wcLiabilities) {
    const bucketed = aggregated.get(account.id);
    const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
    const amounts: Record<string, number> = {};
    const pyAmounts: Record<string, number> | undefined = hasPY ? {} : undefined;
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      // Negate: liabilities are credit-normal (stored negative in GL).
      // An increase in liability (more negative) should be a cash inflow (positive).
      amounts[bucket.key] = -change;
      operatingTotal[bucket.key] += -change;

      if (hasPY && pyAmounts) {
        const pyChange =
          (pyBucketed?.endingBalance[bucket.key] ?? 0) -
          (pyBucketed?.beginningBalance[bucket.key] ?? 0);
        pyAmounts[bucket.key] = -pyChange;
        pyOperatingTotal[bucket.key] += -pyChange;
      }
    }
    operatingLines.push({
      id: `cf-wc-${account.id}`,
      label: account.name,
      amounts,
      priorYearAmounts: pyAmounts,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
      drillDownMeta: {
        type: "account",
        masterAccountIds: [account.id],
        statementType: "cash_flow",
      },
    });
  }

  // --- ROU LEASE RECLASSIFICATION (ASC 842) ---
  // ROU asset recognition and lease liability changes are non-cash at inception
  // and should not appear in Investing / Financing.  Reclassify them into
  // Operating so that:
  //   • ROU asset amortisation (non-cash) is added back like D&A
  //   • Lease liability reductions (cash payments) appear as operating outflows
  const isRouAsset = (a: AccountInfo) => {
    const n = a.name.toLowerCase();
    return ROU_ASSET_NAME_PATTERNS.some((p) => n.includes(p));
  };
  const isRouLiability = (a: AccountInfo) => {
    const n = a.name.toLowerCase();
    return ROU_LIABILITY_NAME_PATTERNS.some((p) => n.includes(p));
  };

  const rouAssets = accounts.filter(
    (a) => INVESTING_ACCOUNT_TYPES.includes(a.accountType) && isRouAsset(a)
  );
  const rouLiabilities = accounts.filter(
    (a) => FINANCING_LIABILITY_TYPES.includes(a.accountType) && isRouLiability(a)
  );

  // Add ROU items to operating section if any exist
  if (rouAssets.length > 0 || rouLiabilities.length > 0) {
    operatingLines.push({
      id: "cf-rou-header",
      label: "Non-cash lease adjustments (ASC 842):",
      amounts: {},
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: true,
      isSeparator: false,
      showDollarSign: false,
    });

    // ROU asset changes — decrease = non-cash amortisation, treated like D&A add-back
    for (const account of rouAssets) {
      const bucketed = aggregated.get(account.id);
      const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
      const amounts: Record<string, number> = {};
      const pyAmounts: Record<string, number> | undefined = hasPY ? {} : undefined;
      for (const bucket of buckets) {
        const change =
          (bucketed?.endingBalance[bucket.key] ?? 0) -
          (bucketed?.beginningBalance[bucket.key] ?? 0);
        // Debit-normal asset: increase = cash outflow (negative), decrease = add-back (positive)
        amounts[bucket.key] = -change;
        operatingTotal[bucket.key] += -change;

        if (hasPY && pyAmounts) {
          const pyChange =
            (pyBucketed?.endingBalance[bucket.key] ?? 0) -
            (pyBucketed?.beginningBalance[bucket.key] ?? 0);
          pyAmounts[bucket.key] = -pyChange;
          pyOperatingTotal[bucket.key] += -pyChange;
        }
      }
      operatingLines.push({
        id: `cf-rou-asset-${account.id}`,
        label: "Amortization of ROU assets (non-cash)",
        amounts,
        priorYearAmounts: pyAmounts,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: false,
        drillDownMeta: {
          type: "account",
          masterAccountIds: [account.id],
          statementType: "cash_flow",
        },
      });
    }

    // ROU liability changes — decrease = cash lease payments (operating outflow)
    for (const account of rouLiabilities) {
      const bucketed = aggregated.get(account.id);
      const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
      const amounts: Record<string, number> = {};
      const pyAmounts: Record<string, number> | undefined = hasPY ? {} : undefined;
      for (const bucket of buckets) {
        const change =
          (bucketed?.endingBalance[bucket.key] ?? 0) -
          (bucketed?.beginningBalance[bucket.key] ?? 0);
        // Credit-normal liability: increase (more negative) = cash inflow,
        // decrease (less negative) = cash outflow
        amounts[bucket.key] = -change;
        operatingTotal[bucket.key] += -change;

        if (hasPY && pyAmounts) {
          const pyChange =
            (pyBucketed?.endingBalance[bucket.key] ?? 0) -
            (pyBucketed?.beginningBalance[bucket.key] ?? 0);
          pyAmounts[bucket.key] = -pyChange;
          pyOperatingTotal[bucket.key] += -pyChange;
        }
      }
      operatingLines.push({
        id: `cf-rou-liab-${account.id}`,
        label: "Principal payments on lease liabilities",
        amounts,
        priorYearAmounts: pyAmounts,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: false,
        drillDownMeta: {
          type: "account",
          masterAccountIds: [account.id],
          statementType: "cash_flow",
        },
      });
    }
  }

  sections.push({
    id: "cf-operating",
    title: "CASH FLOWS FROM OPERATING ACTIVITIES",
    lines: operatingLines,
    subtotalLine: {
      id: "cf-operating-total",
      label: "Net cash provided by (used in) operating activities",
      amounts: operatingTotal,
      priorYearAmounts: hasPY ? { ...pyOperatingTotal } : undefined,
      indent: 0,
      isTotal: true,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
    },
  });

  // --- INVESTING ACTIVITIES ---
  // GAAP presentation (ASC 230-10-45-13): purchases of property & equipment and
  // proceeds from disposals are shown gross, sourced from the fixed-asset
  // subledger.  To guarantee the statement still articulates, the section TOTAL
  // is kept equal to the balance-sheet-derived figure (period change in the net
  // book value of investing-type asset masters, less the tangible-depreciation
  // add-back that is captured in Operating).  Intangible/goodwill masters are
  // excluded here (their non-cash amortization moved to Operating); ROU assets
  // are excluded (reclassified to Operating); the synthetic intercompany line is
  // not shown.  A single reconciling line carries gain/loss on disposal and any
  // capex/disposals not itemized in the subledger so the displayed lines sum to
  // the tied total (a material reconciling balance signals subledger-vs-GL drift).
  const investingAssets = accounts.filter(
    (a) =>
      INVESTING_ACCOUNT_TYPES.includes(a.accountType) &&
      !isRouAsset(a) &&
      !isIntangibleAsset(a) &&
      !isIntercompanyElim(a)
  );
  const investingTotal: Record<string, number> = {};
  const pyInvestingTotal: Record<string, number> = {};
  // Per-account carrying-value change (−ΔNBV) per bucket, for the recon drill-down.
  const carryingDetailByBucket: Record<string, { label: string; amount: number }[]> = {};
  const carryingChangeByBucket: Record<string, number> = {};
  for (const bucket of buckets) {
    investingTotal[bucket.key] = 0;
    pyInvestingTotal[bucket.key] = 0;
    carryingDetailByBucket[bucket.key] = [];
    carryingChangeByBucket[bucket.key] = 0;
  }
  for (const account of investingAssets) {
    const bucketed = aggregated.get(account.id);
    const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      investingTotal[bucket.key] += -change;
      carryingChangeByBucket[bucket.key] += -change;
      if (Math.abs(change) > 0.5) {
        carryingDetailByBucket[bucket.key].push({ label: account.name, amount: -change });
      }
      if (hasPY) {
        const pyChange =
          (pyBucketed?.endingBalance[bucket.key] ?? 0) -
          (pyBucketed?.beginningBalance[bucket.key] ?? 0);
        pyInvestingTotal[bucket.key] += -pyChange;
      }
    }
  }
  // Remove the tangible depreciation embedded in the "(Net)" masters; it is
  // already added back in Operating, so this keeps the section total = actual
  // cash invested (matching the prior, tied behavior).  Then add back the net
  // book gain/(loss) on disposals: the GL carrying change only removes net book
  // value, but the cash received was the sale price.  Adding the gain/(loss)
  // lifts Investing from a NBV basis to a proceeds basis (offsetting the
  // matching deduction in Operating), so the disposal's gain no longer sits in
  // the reconciling line.
  for (const bucket of buckets) {
    investingTotal[bucket.key] -= depreciationByBucket[bucket.key] ?? 0;
    investingTotal[bucket.key] += gainLossByBucket[bucket.key] ?? 0;
    if (hasPY) {
      pyInvestingTotal[bucket.key] -= pyDepreciationByBucket[bucket.key] ?? 0;
      // Mirror the PY Operating add-back so the prior-year columns articulate too.
      pyInvestingTotal[bucket.key] += pyGainLossByBucket[bucket.key] ?? 0;
    }
  }

  // Gross capex / disposals from the subledger (current period only; YoY prior-
  // year columns fold into the reconciling line).
  const additions = assetCashFlows?.additionsByBucket ?? {};
  const disposals = assetCashFlows?.disposalProceedsByBucket ?? {};
  // Hand-entered Fixed-Asset Activity schedule (explains GL-only movements that
  // never went through the subledger). Each map is already cash-basis signed.
  const schedCashPurchases = scheduleCashFlows?.cashPurchasesByBucket ?? {};
  const schedProceeds = scheduleCashFlows?.disposalProceedsByBucket ?? {};
  const schedWriteoff = scheduleCashFlows?.writeoffByBucket ?? {};
  const schedReclass = scheduleCashFlows?.reclassByBucket ?? {};
  const purchaseAmounts: Record<string, number> = {};
  const proceedsAmounts: Record<string, number> = {};
  const reconAmounts: Record<string, number> = {};
  const pyReconAmounts: Record<string, number> = {};
  for (const bucket of buckets) {
    const k = bucket.key;
    purchaseAmounts[k] = -(additions[k] ?? 0); // cash out
    proceedsAmounts[k] = disposals[k] ?? 0; // cash in
    // Recon = GL-anchored Investing total LESS every itemized line (subledger +
    // schedule). Subtracting the schedule lines shrinks the plug; the Investing
    // total is unchanged, so the statement still articulates.
    reconAmounts[k] =
      (investingTotal[k] ?? 0) -
      purchaseAmounts[k] -
      proceedsAmounts[k] -
      (schedCashPurchases[k] ?? 0) -
      (schedProceeds[k] ?? 0) -
      (schedWriteoff[k] ?? 0) -
      (schedReclass[k] ?? 0);
    pyReconAmounts[k] = pyInvestingTotal[k] ?? 0;
  }
  const anyNonZero = (m: Record<string, number>) =>
    buckets.some((b) => Math.abs(m[b.key] ?? 0) > 0.5);

  // --- Derivation build-ups (shown when a month cell is clicked) ---
  const additionsDetail = assetCashFlows?.additionsDetailByBucket ?? {};
  const disposalsDetail = assetCashFlows?.disposalsDetailByBucket ?? {};

  const purchasesDerivation: CashFlowDerivation = {
    description:
      "Gross capital expenditures sourced directly from the fixed-asset subledger — every asset whose acquisition date falls in the period, recorded at its acquisition cost (a cash outflow).",
    byPeriod: {},
  };
  const proceedsDerivation: CashFlowDerivation = {
    description:
      "Gross proceeds from disposals sourced directly from the fixed-asset subledger — every asset whose disposal date falls in the period, recorded at its sale price (a cash inflow).",
    byPeriod: {},
  };
  const reconDerivation: CashFlowDerivation = {
    description:
      "A balancing line that keeps Investing tied to the balance sheet. It equals the general-ledger change in the carrying value of property & equipment, MINUS depreciation (added back in Operating), PLUS the net book gain/(loss) on disposal (reclassified out of Operating), MINUS the purchases, disposal proceeds, and any Fixed-Asset Activity schedule entries itemized above. What remains is general-ledger fixed-asset activity not yet recorded in the subledger or schedule. Enter the missing pieces on the Fixed-Asset Activity schedule to drive this toward zero.",
    byPeriod: {},
  };
  const scheduleDetail = scheduleCashFlows?.detailByBucket ?? {};
  // Schedule cash lines (per-bucket sums) and their derivation build-ups.
  const schedPurchasesDerivation: CashFlowDerivation = {
    description:
      "Capital expenditures booked by journal entry (not in the fixed-asset subledger), captured on the Fixed-Asset Activity schedule. A cash outflow.",
    byPeriod: {},
  };
  const schedProceedsDerivation: CashFlowDerivation = {
    description:
      "Disposal proceeds booked by journal entry (not in the fixed-asset subledger), captured on the Fixed-Asset Activity schedule. A cash inflow.",
    byPeriod: {},
  };
  const schedNonCashDerivation: CashFlowDerivation = {
    description:
      "Non-cash fixed-asset activity (write-offs, impairments, reclasses, transfers) captured on the Fixed-Asset Activity schedule. No cash effect — shown to label what is inside the GL carrying-value change.",
    byPeriod: {},
  };
  const schedNonCash: Record<string, number> = {};
  for (const bucket of buckets) {
    schedNonCash[bucket.key] =
      (schedWriteoff[bucket.key] ?? 0) + (schedReclass[bucket.key] ?? 0);
  }
  const scheduleRowsForBucket = (
    k: string,
    types: FixedAssetCfEntryType[],
  ): { label: string; amount: number }[] =>
    (scheduleDetail[k] ?? [])
      .filter((d) => types.includes(d.entryType))
      .map((d) => ({ label: d.description || SCHEDULE_TYPE_LABEL[d.entryType], amount: d.amount }));
  for (const bucket of buckets) {
    const k = bucket.key;
    purchasesDerivation.byPeriod[k] = {
      total: purchaseAmounts[k] ?? 0,
      components: [
        {
          label: "Property & equipment acquired in the period (subledger)",
          amount: purchaseAmounts[k] ?? 0,
          detail: (additionsDetail[k] ?? []).map((d) => ({
            label: d.assetName,
            meta: d.date,
            amount: d.amount,
          })),
        },
      ],
    };
    proceedsDerivation.byPeriod[k] = {
      total: proceedsAmounts[k] ?? 0,
      components: [
        {
          label: "Property & equipment disposed in the period (subledger)",
          amount: proceedsAmounts[k] ?? 0,
          detail: (disposalsDetail[k] ?? []).map((d) => ({
            label: d.assetName,
            meta: d.date,
            amount: d.amount,
          })),
        },
      ],
    };
    const reconComponents = [
      {
        label: "Change in carrying value of property & equipment (per general ledger)",
        amount: carryingChangeByBucket[k] ?? 0,
        detail: (carryingDetailByBucket[k] ?? []).map((d) => ({
          label: d.label,
          amount: d.amount,
        })),
      },
      {
        label: "Depreciation in carrying value (tangible, non-cash; added back in Operating)",
        amount: -(depreciationByBucket[k] ?? 0),
      },
      {
        label: "Purchases of property & equipment (subledger, itemized above)",
        amount: -(purchaseAmounts[k] ?? 0),
      },
      {
        label: "Proceeds from disposal (subledger, itemized above)",
        amount: -(proceedsAmounts[k] ?? 0),
      },
    ];
    if (Math.abs(gainLossByBucket[k] ?? 0) > 0.5)
      reconComponents.push({
        label: "(Gain) loss on disposal reclassified to Operating",
        amount: gainLossByBucket[k] ?? 0,
      });
    // Include schedule reclasses only when present, so the build-up stays clean.
    if (Math.abs(schedCashPurchases[k] ?? 0) > 0.5)
      reconComponents.push({
        label: "Cash purchases (Fixed-Asset Activity schedule, itemized above)",
        amount: -(schedCashPurchases[k] ?? 0),
      });
    if (Math.abs(schedProceeds[k] ?? 0) > 0.5)
      reconComponents.push({
        label: "Disposal proceeds (Fixed-Asset Activity schedule, itemized above)",
        amount: -(schedProceeds[k] ?? 0),
      });
    if (Math.abs(schedNonCash[k] ?? 0) > 0.5)
      reconComponents.push({
        label: "Non-cash schedule activity (write-offs / reclasses, itemized above)",
        amount: -(schedNonCash[k] ?? 0),
      });
    reconDerivation.byPeriod[k] = { total: reconAmounts[k] ?? 0, components: reconComponents };

    schedPurchasesDerivation.byPeriod[k] = {
      total: schedCashPurchases[k] ?? 0,
      components: [
        {
          label: "Capital expenditures (per schedule)",
          amount: schedCashPurchases[k] ?? 0,
          detail: scheduleRowsForBucket(k, ["cash_purchase"]),
        },
      ],
    };
    schedProceedsDerivation.byPeriod[k] = {
      total: schedProceeds[k] ?? 0,
      components: [
        {
          label: "Disposal proceeds (per schedule)",
          amount: schedProceeds[k] ?? 0,
          detail: scheduleRowsForBucket(k, ["disposal_proceeds"]),
        },
      ],
    };
    schedNonCashDerivation.byPeriod[k] = {
      total: schedNonCash[k] ?? 0,
      components: [
        {
          label: "Non-cash write-offs / reclasses (per schedule)",
          amount: schedNonCash[k] ?? 0,
          detail: scheduleRowsForBucket(k, ["disposal_writeoff", "reclass_transfer"]),
        },
      ],
    };
  }

  const investingLines: LineItem[] = [];
  if (anyNonZero(purchaseAmounts)) {
    investingLines.push({
      id: "cf-inv-purchases",
      label: "Purchases of property and equipment",
      amounts: purchaseAmounts,
      priorYearAmounts: hasPY ? {} : undefined,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
      drillDownMeta: { type: "none" },
      derivation: purchasesDerivation,
    });
  }
  if (anyNonZero(proceedsAmounts)) {
    investingLines.push({
      id: "cf-inv-proceeds",
      label: "Proceeds from disposal of property and equipment",
      amounts: proceedsAmounts,
      priorYearAmounts: hasPY ? {} : undefined,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
      drillDownMeta: { type: "none" },
      derivation: proceedsDerivation,
    });
  }
  // Fixed-Asset Activity schedule lines (hand-entered explanations of GL-only
  // movements). They decompose the recon plug; the Investing total is unchanged.
  if (anyNonZero(schedCashPurchases)) {
    investingLines.push({
      id: "cf-inv-sched-purchases",
      label: "Purchases of property and equipment (per schedule)",
      amounts: schedCashPurchases,
      priorYearAmounts: hasPY ? {} : undefined,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
      drillDownMeta: { type: "none" },
      derivation: schedPurchasesDerivation,
    });
  }
  if (anyNonZero(schedProceeds)) {
    investingLines.push({
      id: "cf-inv-sched-proceeds",
      label: "Proceeds from disposal of property and equipment (per schedule)",
      amounts: schedProceeds,
      priorYearAmounts: hasPY ? {} : undefined,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
      drillDownMeta: { type: "none" },
      derivation: schedProceedsDerivation,
    });
  }
  if (anyNonZero(schedNonCash)) {
    investingLines.push({
      id: "cf-inv-sched-noncash",
      label: "Non-cash fixed-asset activity (write-offs / reclasses, per schedule)",
      amounts: schedNonCash,
      priorYearAmounts: hasPY ? {} : undefined,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
      drillDownMeta: { type: "none" },
      derivation: schedNonCashDerivation,
    });
  }
  investingLines.push({
    id: "cf-inv-noncash-recon",
    label: "Other property & equipment activity, net (per general ledger)",
    amounts: reconAmounts,
    priorYearAmounts: hasPY ? pyReconAmounts : undefined,
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: false,
    isSeparator: false,
    showDollarSign: false,
    drillDownMeta: { type: "none" },
    derivation: reconDerivation,
  });

  // Dynamic subtotal label — "provided by" when the net is a source.
  const investingIsSource = buckets.some((b) => (investingTotal[b.key] ?? 0) > 0);
  sections.push({
    id: "cf-investing",
    title: "CASH FLOWS FROM INVESTING ACTIVITIES",
    lines: investingLines,
    subtotalLine: {
      id: "cf-investing-total",
      label: investingIsSource
        ? "Net cash provided by (used in) investing activities"
        : "Net cash used in investing activities",
      amounts: investingTotal,
      priorYearAmounts: hasPY ? { ...pyInvestingTotal } : undefined,
      indent: 0,
      isTotal: true,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
    },
  });

  // --- FINANCING ACTIVITIES ---
  // Exclude ROU lease liabilities — their changes are reclassified to Operating
  // above.  Exclude the synthetic intercompany-elimination residual — its
  // movement is not a cash flow of the consolidated entity (any nonzero
  // residual change falls through to the Operating reconciling line, where it
  // is visible instead of masquerading as financing activity).
  const financingLiabilities = accounts.filter(
    (a) =>
      FINANCING_LIABILITY_TYPES.includes(a.accountType) &&
      !isRouLiability(a) &&
      !isIntercompanyElim(a)
  );
  // Line-of-credit / short-term debt: credit-normal current liabilities whose
  // borrowings and repayments are FINANCING activities (ASC 230-10-45-14/15).
  // Reclassified here, out of Operating working-capital changes.
  const lineOfCreditAccounts = accounts.filter(
    (a) => OPERATING_CURRENT_LIABILITY_TYPES.includes(a.accountType) && isLineOfCredit(a)
  );
  // Exclude equity accounts whose balance changes represent accumulated net
  // income (already captured in operating activities).  Distributions, owner's
  // equity contributions/withdrawals, and similar accounts are real cash flows
  // and belong in financing.
  const EXCLUDED_FINANCING_EQUITY = [
    "retained earnings",
    "net income",
  ];
  const financingEquity = accounts.filter(
    (a) =>
      FINANCING_EQUITY_TYPES.includes(a.accountType) &&
      !isIntercompanyElim(a) &&
      !EXCLUDED_FINANCING_EQUITY.some((excl) =>
        a.name.toLowerCase().includes(excl)
      )
  );
  const financingLines: LineItem[] = [];
  const financingTotal: Record<string, number> = {};
  const pyFinancingTotal: Record<string, number> = {};
  for (const bucket of buckets) {
    financingTotal[bucket.key] = 0;
    pyFinancingTotal[bucket.key] = 0;
  }

  for (const account of [...lineOfCreditAccounts, ...financingLiabilities, ...financingEquity]) {
    const bucketed = aggregated.get(account.id);
    const pyBucketed = hasPY ? pyAggregated!.get(account.id) : undefined;
    const amounts: Record<string, number> = {};
    const pyAmounts: Record<string, number> | undefined = hasPY ? {} : undefined;
    for (const bucket of buckets) {
      const change =
        (bucketed?.endingBalance[bucket.key] ?? 0) -
        (bucketed?.beginningBalance[bucket.key] ?? 0);
      // Negate: long-term liabilities, the line of credit, and equity are all
      // credit-normal (stored negative in GL). An increase is a cash inflow.
      amounts[bucket.key] = -change;
      financingTotal[bucket.key] += -change;

      if (hasPY && pyAmounts) {
        const pyChange =
          (pyBucketed?.endingBalance[bucket.key] ?? 0) -
          (pyBucketed?.beginningBalance[bucket.key] ?? 0);
        pyAmounts[bucket.key] = -pyChange;
        pyFinancingTotal[bucket.key] += -pyChange;
      }
    }
    // On the statement of cash flows the distributions equity account carries
    // flows in both directions (owner contributions in, distributions out),
    // so it gets a two-sided label; the balance sheet keeps the account name.
    const cfLabel =
      account.classification === "Equity" &&
      account.name.toLowerCase().includes("distribution")
        ? "Contributions / (Distributions)"
        : account.name;
    financingLines.push({
      id: `cf-fin-${account.id}`,
      label: cfLabel,
      amounts,
      priorYearAmounts: pyAmounts,
      indent: 1,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
      drillDownMeta: {
        type: "account",
        masterAccountIds: [account.id],
        statementType: "cash_flow",
      },
    });
  }

  sections.push({
    id: "cf-financing",
    title: "CASH FLOWS FROM FINANCING ACTIVITIES",
    lines: financingLines,
    subtotalLine: {
      id: "cf-financing-total",
      label: "Net cash provided by (used in) financing activities",
      amounts: financingTotal,
      priorYearAmounts: hasPY ? { ...pyFinancingTotal } : undefined,
      indent: 0,
      isTotal: true,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
    },
  });

  // --- Reconcile to actual cash (pro forma / non-cash adjustments) ---
  // The statement above is built on ACTUAL GL movement, so operating + investing
  // + financing already equals the change in bank cash.  When pro forma is enabled
  // it alters net income (Operating) but shields the bank balance, leaving a
  // residual.  We reverse that residual here as one explicit non-cash line so the
  // GAAP statement always articulates to actual cash; the pro forma itself is
  // presented in the supplemental block below.
  {
    const cashAccts = accounts.filter((a) => CASH_ACCOUNT_TYPES.includes(a.accountType));
    const reversal: Record<string, number> = {};
    const pyReversal: Record<string, number> = {};
    let anyReversal = false;
    for (const bucket of buckets) {
      let beginBal = 0;
      let endBal = 0;
      for (const ca of cashAccts) {
        const b = aggregated.get(ca.id);
        beginBal += b?.beginningBalance[bucket.key] ?? 0;
        endBal += b?.endingBalance[bucket.key] ?? 0;
      }
      const r =
        endBal -
        beginBal -
        (operatingTotal[bucket.key] + investingTotal[bucket.key] + financingTotal[bucket.key]);
      reversal[bucket.key] = r;
      if (Math.abs(r) > 0.5) anyReversal = true;
      operatingTotal[bucket.key] += r;
      if (hasPY) {
        let pyBegin = 0;
        let pyEnd = 0;
        for (const ca of cashAccts) {
          const pb = pyAggregated!.get(ca.id);
          pyBegin += pb?.beginningBalance[bucket.key] ?? 0;
          pyEnd += pb?.endingBalance[bucket.key] ?? 0;
        }
        const pyR =
          pyEnd -
          pyBegin -
          (pyOperatingTotal[bucket.key] +
            pyInvestingTotal[bucket.key] +
            pyFinancingTotal[bucket.key]);
        pyReversal[bucket.key] = pyR;
        pyOperatingTotal[bucket.key] += pyR;
      }
    }
    if (anyReversal) {
      operatingLines.push({
        id: "cf-proforma-reversal",
        label: "Other non-cash reconciling items, net",
        amounts: reversal,
        priorYearAmounts: hasPY ? pyReversal : undefined,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: false,
        drillDownMeta: { type: "none" },
      });
    }
  }

  // --- NET CHANGE IN CASH ---
  const netCashChange: Record<string, number> = {};
  const cashBeginning: Record<string, number> = {};
  const cashEnding: Record<string, number> = {};
  const pyNetCashChange: Record<string, number> = {};
  const pyCashBeginning: Record<string, number> = {};
  const pyCashEnding: Record<string, number> = {};

  const cashAccounts = accounts.filter((a) =>
    CASH_ACCOUNT_TYPES.includes(a.accountType)
  );

  for (const bucket of buckets) {
    netCashChange[bucket.key] =
      operatingTotal[bucket.key] +
      investingTotal[bucket.key] +
      financingTotal[bucket.key];

    let beginBal = 0;
    let endBal = 0;
    for (const ca of cashAccounts) {
      const bucketed = aggregated.get(ca.id);
      beginBal += bucketed?.beginningBalance[bucket.key] ?? 0;
      endBal += bucketed?.endingBalance[bucket.key] ?? 0;
    }
    cashBeginning[bucket.key] = beginBal;
    cashEnding[bucket.key] = endBal;

    if (hasPY) {
      pyNetCashChange[bucket.key] =
        pyOperatingTotal[bucket.key] +
        pyInvestingTotal[bucket.key] +
        pyFinancingTotal[bucket.key];

      let pyBeginBal = 0;
      let pyEndBal = 0;
      for (const ca of cashAccounts) {
        const pyBucketed = pyAggregated!.get(ca.id);
        pyBeginBal += pyBucketed?.beginningBalance[bucket.key] ?? 0;
        pyEndBal += pyBucketed?.endingBalance[bucket.key] ?? 0;
      }
      pyCashBeginning[bucket.key] = pyBeginBal;
      pyCashEnding[bucket.key] = pyEndBal;
    }
  }

  sections.push({
    id: "cf-summary",
    title: "",
    lines: [
      {
        id: "cf-net-change",
        label: "NET INCREASE (DECREASE) IN CASH",
        amounts: netCashChange,
        priorYearAmounts: hasPY ? pyNetCashChange : undefined,
        indent: 0,
        isTotal: true,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: true,
      },
      {
        id: "cf-cash-begin",
        label: "Cash at beginning of period",
        amounts: cashBeginning,
        priorYearAmounts: hasPY ? pyCashBeginning : undefined,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: false,
      },
      {
        id: "cf-cash-end",
        label: "Cash at end of period",
        amounts: cashEnding,
        priorYearAmounts: hasPY ? pyCashEnding : undefined,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: false,
      },
    ],
    // subtotalLine is not rendered (headerless section) but carries beginning
    // cash data so the reconciliation check can verify: beginning + net change = ending
    subtotalLine: {
      id: "cf-cash-beginning",
      label: "",
      amounts: cashBeginning,
      priorYearAmounts: hasPY ? pyCashBeginning : undefined,
      indent: 0,
      isTotal: false,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: false,
    },
  });

  // --- PRO FORMA / ALLOCATION SUPPLEMENTAL SECTION ---
  if (supplementalEntries && supplementalEntries.length > 0) {
    const accountTypeMap = new Map(accounts.map((a) => [a.id, a.accountType]));
    const supplementalLines: LineItem[] = [];

    // Group entries by description to aggregate amounts into buckets
    const grouped = new Map<string, { entry: CashFlowSupplementalEntry; amounts: Record<string, number> }>();

    for (const entry of supplementalEntries) {
      const primaryType = accountTypeMap.get(entry.primaryAccountId);
      if (!primaryType) continue;

      let cashImpact: number;
      if (entry.offsetAccountId) {
        // Double-entry: compute net cash impact from both accounts
        const offsetType = accountTypeMap.get(entry.offsetAccountId);
        if (!offsetType) continue;
        cashImpact = computeNetCashImpact(entry.amount, primaryType, offsetType);
      } else {
        // Single-entry: use the raw amount directly
        cashImpact = entry.amount;
      }

      // Find which bucket this entry falls into
      for (const bucket of buckets) {
        const inBucket = bucket.months.some(
          (m) => m.year === entry.periodYear && m.month === entry.periodMonth
        );
        if (!inBucket) continue;

        const groupKey = `${entry.description}|${entry.primaryAccountId}|${entry.offsetAccountId ?? "single"}`;
        let group = grouped.get(groupKey);
        if (!group) {
          group = { entry, amounts: {} };
          for (const b of buckets) group.amounts[b.key] = 0;
          grouped.set(groupKey, group);
        }
        group.amounts[bucket.key] += cashImpact;
      }
    }

    for (const [, group] of grouped) {
      // Skip entries with zero impact in all buckets
      const hasAnyAmount = Object.values(group.amounts).some((v) => v !== 0);
      if (!hasAnyAmount) continue;

      supplementalLines.push({
        id: `cf-pf-${group.entry.primaryAccountId}-${group.entry.offsetAccountId ?? "single"}`,
        label: group.entry.description,
        amounts: group.amounts,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: false,
        drillDownMeta: { type: "none" },
      });
    }

    if (supplementalLines.length > 0) {
      const pfTotal: Record<string, number> = {};
      for (const bucket of buckets) {
        pfTotal[bucket.key] = supplementalLines.reduce(
          (sum, line) => sum + (line.amounts[bucket.key] ?? 0),
          0
        );
      }

      sections.push({
        id: "cf-pro-forma",
        title: "PRO FORMA ADJUSTMENTS",
        lines: supplementalLines,
        subtotalLine: {
          id: "cf-pro-forma-total",
          label: "Net pro forma cash impact",
          amounts: pfTotal,
          indent: 0,
          isTotal: true,
          isGrandTotal: false,
          isHeader: false,
          isSeparator: false,
          showDollarSign: true,
        },
      });

      // Pro-forma management view: actual ending cash plus the period's pro forma
      // cash impact — so the pro-forma view reconciles instead of leaving a stray
      // residual.  (The GAAP statement above is on an actual-cash basis.)
      const pfAdjustedEndingCash: Record<string, number> = {};
      for (const bucket of buckets) {
        pfAdjustedEndingCash[bucket.key] =
          (cashEnding[bucket.key] ?? 0) + (pfTotal[bucket.key] ?? 0);
      }
      sections.push({
        id: "cf-pro-forma-reconcile",
        title: "",
        lines: [
          {
            id: "cf-pf-adjusted-cash",
            label: "Pro forma adjusted ending cash",
            amounts: pfAdjustedEndingCash,
            indent: 1,
            isTotal: true,
            isGrandTotal: false,
            isHeader: false,
            isSeparator: false,
            showDollarSign: true,
            drillDownMeta: { type: "none" },
          },
        ],
      });
    }
  }

  // --- SUPPLEMENTAL DISCLOSURES (ASC 230-10-50) ---
  // Memo-only (not part of any subtotal): cash paid for interest and income
  // taxes (approximated from the period expense, labeled as derived) and major
  // non-cash investing/financing activity (ROU assets obtained for new leases).
  {
    const sumNetChange = (filter: (a: AccountInfo) => boolean): Record<string, number> => {
      const out: Record<string, number> = {};
      const matched = accounts.filter(filter);
      for (const bucket of buckets) {
        out[bucket.key] = matched.reduce(
          (s, acct) => s + (aggregated.get(acct.id)?.netChange[bucket.key] ?? 0),
          0,
        );
      }
      return out;
    };
    const isExpenseClass = (a: AccountInfo) =>
      a.classification === "Expense" || a.classification === "Other Expense";
    const interestPaid = sumNetChange(
      (a) => isExpenseClass(a) && a.name.toLowerCase().includes("interest"),
    );
    const incomeTaxPaid = sumNetChange(
      (a) => isExpenseClass(a) && a.name.toLowerCase().includes("income tax"),
    );
    // Non-cash: gross increases in ROU asset balances = new lease recognitions.
    const rouAdditions: Record<string, number> = {};
    for (const bucket of buckets) {
      let add = 0;
      for (const acct of rouAssets) {
        const b = aggregated.get(acct.id);
        const delta = (b?.endingBalance[bucket.key] ?? 0) - (b?.beginningBalance[bucket.key] ?? 0);
        if (delta > 0) add += delta;
      }
      rouAdditions[bucket.key] = add;
    }

    const discLines: LineItem[] = [];
    const mk = (id: string, label: string, amounts: Record<string, number>) => {
      if (!buckets.some((b) => Math.abs(amounts[b.key] ?? 0) > 0.5)) return;
      discLines.push({
        id,
        label,
        amounts,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: false,
        drillDownMeta: { type: "none" },
      });
    };
    mk("cf-disc-interest", "Cash paid for interest (derived)", interestPaid);
    mk("cf-disc-income-tax", "Cash paid for income taxes (derived)", incomeTaxPaid);
    mk("cf-disc-rou", "Non-cash: ROU assets obtained for new lease liabilities", rouAdditions);

    if (discLines.length > 0) {
      sections.push({
        id: "cf-supplemental",
        title: "SUPPLEMENTAL DISCLOSURES",
        lines: discLines,
      });
    }
  }

  // --- Hide blank detail lines ---
  // Account-level rows whose amounts (current and prior year) are zero in
  // every bucket carry no information (e.g., an equity account with no
  // activity in the period).  Structural rows (headers, totals, separators)
  // and the lines every statement must show (net income, ending cash) are
  // always kept.  Headers whose entire group was filtered out are dropped.
  {
    const isZero = (rec?: Record<string, number>) =>
      !rec || buckets.every((b) => Math.abs(rec[b.key] ?? 0) < 0.005);
    const ALWAYS_SHOW = new Set(["cf-net-income", "cf-net-change", "cf-cash-begin", "cf-cash-end"]);
    for (const section of sections) {
      section.lines = section.lines.filter(
        (l) =>
          l.isHeader ||
          l.isTotal ||
          l.isGrandTotal ||
          l.isSeparator ||
          ALWAYS_SHOW.has(l.id) ||
          !(isZero(l.amounts) && isZero(l.priorYearAmounts))
      );
      section.lines = section.lines.filter((l, i) => {
        if (!l.isHeader) return true;
        for (let j = i + 1; j < section.lines.length; j++) {
          if (section.lines[j].isHeader) break;
          return true; // header keeps at least one following line
        }
        return false; // empty group — drop the header
      });
    }
  }

  return {
    id: "cash_flow",
    title: "Statement of Cash Flows",
    sections,
  };
}

// ---------------------------------------------------------------------------
// Shared consolidation helper: builds three-statement financials for a set of
// entity IDs within an organization.  Used by both "organization" and
// "reporting_entity" scopes.
// ---------------------------------------------------------------------------

interface ConsolidatedStatementsParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
  organizationId: string;
  chartId: string;
  entityIds: string[];
  buckets: PeriodBucket[];
  allMonths: Array<{ year: number; month: number }>;
  includeYoY: boolean;
  includeBudget: boolean;
  includeProForma: boolean;
  includeAllocations: boolean;
  includeFixedAssetSchedule: boolean;
  granularity: Granularity;
  scope: Scope;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  fiscalYearStartMonth: number;
}

async function buildConsolidatedStatements(params: ConsolidatedStatementsParams) {
  const {
    admin,
    organizationId,
    chartId,
    entityIds,
    buckets,
    allMonths,
    includeYoY,
    includeBudget,
    includeProForma,
    includeAllocations,
    includeFixedAssetSchedule,
    granularity,
    scope,
    startYear,
    startMonth,
    endYear,
    endMonth,
    fiscalYearStartMonth,
  } = params;

  // Get master accounts in the active chart (paginated to avoid PostgREST row-limit truncation)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const masterAccounts = await fetchAllPaginated<any>((offset, limit) =>
    admin
      .from("master_accounts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("chart_id", chartId)
      .eq("is_active", true)
      .order("display_order")
      .order("account_number")
      .range(offset, offset + limit - 1)
  );

  if (masterAccounts.length === 0) {
    return {
      periods: [] as Period[],
      incomeStatement: { id: "income_statement", title: "Income Statement", sections: [] },
      balanceSheet: { id: "balance_sheet", title: "Balance Sheet", sections: [] },
      cashFlowStatement: { id: "cash_flow", title: "Statement of Cash Flows", sections: [] },
    };
  }

  // Get mappings (paginated to avoid PostgREST max_rows truncation)
  const masterAccountIds = masterAccounts.map((ma: { id: string }) => ma.id);
  const mappings = await fetchAllMappings(admin, masterAccountIds);

  // Build a Set of mapped account IDs for in-memory filtering
  const mappedAccountIdSet = new Set(
    (mappings ?? []).map((m: { account_id: string }) => m.account_id)
  );

  // Get GL balances by entity_id
  let glBalances: RawGLBalance[] = [];
  let glRawCount = 0;
  let glHadErrors = false;

  if (mappedAccountIdSet.size > 0 && entityIds.length > 0) {
    const uniqueYears = [...new Set(allMonths.map((m) => m.year))];
    const uniqueMonthNums = [...new Set(allMonths.map((m) => m.month))];

    const glResult = await fetchAllGLBalances(admin, {
      filterColumn: "entity_id",
      filterValues: entityIds,
      years: uniqueYears,
      months: uniqueMonthNums,
    });
    glRawCount = glResult.rows.length;
    glHadErrors = glResult.hadErrors;

    const monthSet = new Set(
      allMonths.map(
        (m) => `${m.year}-${String(m.month).padStart(2, "0")}`
      )
    );
    glBalances = glResult.rows.filter(
      (b) =>
        mappedAccountIdSet.has(b.account_id) &&
        monthSet.has(
          `${b.period_year}-${String(b.period_month).padStart(2, "0")}`
        )
    );
  }

  // Build mapping: master account ID -> list of entity account_ids
  const masterToEntityAccounts = new Map<string, string[]>();
  for (const m of mappings ?? []) {
    const existing = masterToEntityAccounts.get(m.master_account_id) ?? [];
    existing.push(m.account_id);
    masterToEntityAccounts.set(m.master_account_id, existing);
  }

  // Consolidate: For each master account, sum the GL balances of all mapped entity accounts.
  // Auto-detect intercompany accounts by name pattern ("Due from ..." / "Due to ...")
  // as a reliable fallback — the DB flag may not be set on legacy accounts.
  //
  // Important: skip the name-based auto-flag when the account participates in
  // a parent-child rollup (either has a parent assigned, or is itself a parent).
  // Those accounts represent FS line items that the user explicitly chose to
  // surface; auto-eliminating them would zero out a line that should remain
  // visible (e.g., the accountant chart's "Due from related parties" parent,
  // which represents balances with parties outside the combined entities and
  // therefore should NOT be eliminated).
  const accountsAsChild = new Set(
    masterAccounts
      .filter((m: { parent_account_id?: string | null }) => m.parent_account_id)
      .map((m: { id: string }) => m.id),
  );
  const accountsAsParent = new Set(
    masterAccounts
      .filter((m: { parent_account_id?: string | null }) => m.parent_account_id)
      .map((m: { parent_account_id?: string | null }) => m.parent_account_id as string),
  );
  const consolidatedAccounts: AccountInfo[] = masterAccounts.map(
    (ma: { id: string; name: string; account_number: string | null; classification: string; account_type: string; is_intercompany?: boolean; parent_account_id?: string | null }) => {
      const nameLower = ma.name.toLowerCase();
      const inHierarchy = accountsAsChild.has(ma.id) || accountsAsParent.has(ma.id);
      const isIC =
        ma.is_intercompany === true ||
        (!inHierarchy &&
          (nameLower.startsWith("due from ") || nameLower.startsWith("due to ")));
      return {
        id: ma.id,
        name: ma.name,
        accountNumber: ma.account_number,
        classification: ma.classification,
        accountType: ma.account_type,
        isIntercompany: isIC,
        parentAccountId: ma.parent_account_id ?? null,
      };
    }
  );

  const consolidatedBalances: RawGLBalance[] = [];

  for (const ma of masterAccounts) {
    const entityAccountIds = masterToEntityAccounts.get(ma.id) ?? [];
    const entityBalances = glBalances.filter((b) =>
      entityAccountIds.includes(b.account_id)
    );

    const periodMap = new Map<
      string,
      { beginning: number; ending: number; netChange: number }
    >();

    for (const b of entityBalances) {
      const key = `${b.period_year}-${b.period_month}`;
      const existing = periodMap.get(key) ?? {
        beginning: 0,
        ending: 0,
        netChange: 0,
      };
      existing.beginning += b.beginning_balance;
      existing.ending += b.ending_balance;
      existing.netChange += b.net_change;
      periodMap.set(key, existing);
    }

    for (const [key, vals] of periodMap) {
      const [y, m] = key.split("-").map(Number);
      consolidatedBalances.push({
        account_id: ma.id,
        entity_id: "consolidated",
        period_year: y,
        period_month: m,
        beginning_balance: vals.beginning,
        ending_balance: vals.ending,
        net_change: vals.netChange,
      });
    }
  }

  // Pro Forma Adjustments — fetch now, apply AFTER aggregation so that
  // each adjustment only appears in its target period (not subsequent ones).
  let proFormaRows: RawProFormaAdjustment[] = [];
  if (includeProForma) {
    proFormaRows = await fetchAllPaginated<RawProFormaAdjustment>((offset, limit) =>
      (admin as any)
        .from("pro_forma_adjustments")
        .select("id, entity_id, master_account_id, offset_master_account_id, period_year, period_month, amount, description, notes")
        .eq("organization_id", organizationId)
        .eq("is_excluded", false)
        .in("entity_id", entityIds)
        .range(offset, offset + limit - 1)
    );
    // NOTE: intentionally NOT injected into consolidatedBalances here.
    // Applied post-aggregation below via applyProFormaPostAggregation().
  }

  // Resolve entity names for pro forma details (only when adjustments exist)
  const entityLookup = new Map<string, { name: string; code: string }>();
  if (proFormaRows.length > 0) {
    const pfEntityIds = [...new Set(proFormaRows.map((pf) => pf.entity_id))];
    const { data: pfEntities } = await admin
      .from("entities")
      .select("id, name, code")
      .in("id", pfEntityIds);
    for (const e of pfEntities ?? []) {
      entityLookup.set(e.id, { name: e.name, code: e.code });
    }
  }

  // Allocation Adjustments (org/RE scope — net zero at consolidated level, paginated)
  // Applied post-aggregation (like pro forma) to avoid corrupting adjacent
  // months' net change via the ending_balance diff calculation.
  let allocReclassEntries: CashFlowSupplementalEntry[] = [];
  let allocEntries: AllocationEntry[] = [];
  if (includeAllocations) {
    const allocRows = await fetchAllPaginated<RawAllocationAdjustment>((offset, limit) =>
      (admin as any)
        .from("allocation_adjustments")
        .select("source_entity_id, destination_entity_id, master_account_id, destination_master_account_id, amount, description, schedule_type, period_year, period_month, start_year, start_month, end_year, end_month, is_repeating, repeat_end_year, repeat_end_month")
        .eq("organization_id", organizationId)
        .eq("is_excluded", false)
        .range(offset, offset + limit - 1)
    );

    if (allocRows.length > 0) {
      const expanded = expandAllocationAdjustments(allocRows);
      // Filter to entries belonging to entities in scope.
      // For org scope this keeps both sides (net zero at consolidated).
      // For reporting_entity scope this shows the net effect of cross-RE allocations.
      const entityIdSet = new Set(entityIds);
      allocEntries = expanded.filter((e) => entityIdSet.has(e.entity_id));

      // One-sided legs (counterpart outside scope) shift net income with no
      // balance-sheet offset, unbalancing the RE-scope balance sheet.  Add
      // the missing "Due to/from affiliates" leg so Assets = L + E.
      const dueToFromOffsets = buildAllocationDueToFromOffsets(
        allocEntries,
        (eid) => entityIdSet.has(eid)
      );
      if (dueToFromOffsets.length > 0) {
        allocEntries.push(...dueToFromOffsets);
        consolidatedAccounts.push(makeAllocDueToFromAccount());
      }

      // Build supplemental entries for intra-entity reclass allocations
      // (inter-entity transfers net to zero at consolidated and are omitted)
      allocReclassEntries = buildAllocationSupplementalEntries(allocRows, buckets);
    }
  }

  // Aggregate into buckets
  const aggregated = aggregateByBucket(
    consolidatedAccounts,
    consolidatedBalances,
    buckets,
    fiscalYearStartMonth
  );

  // Apply pro forma adjustments post-aggregation (target period only)
  if (proFormaRows.length > 0) {
    applyProFormaPostAggregation(aggregated, proFormaRows, buckets, consolidatedAccounts);
  }

  // Apply allocation adjustments post-aggregation.  Injecting into raw GL
  // data (ending_balance) corrupted adjacent months because P&L ending_balance
  // is cumulative YTD — modifying one month without subsequent months causes
  // the diff-based net change to be wrong for the next month.
  if (allocEntries.length > 0) {
    applyProFormaPostAggregation(aggregated, allocEntries, buckets, consolidatedAccounts);
  }

  // Year-end adjustments (chart-scoped) — applied as Dec-31 entries on the
  // target master account.  Reuses the pro-forma post-aggregation pipeline
  // so the impact carries forward correctly for balance-sheet accounts
  // (cumulative ending_balance) and lands in the correct year for P&L.
  const yearAdjRows = await fetchAllPaginated<{
    master_account_id: string;
    period_year: number;
    amount: number;
    offset_to_ic_net?: boolean | null;
    entity_id?: string | null;
  }>((offset, limit) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from("master_account_year_adjustments")
      .select("master_account_id, period_year, amount, offset_to_ic_net, entity_id")
      .eq("organization_id", organizationId)
      .eq("chart_id", chartId)
      .range(offset, offset + limit - 1),
  );
  const yearAdjEntries = yearAdjRows.map((r) => ({
    master_account_id: r.master_account_id,
    period_year: Number(r.period_year),
    period_month: 12,
    amount: Number(r.amount),
  }));
  if (yearAdjEntries.length > 0) {
    applyProFormaPostAggregation(aggregated, yearAdjEntries, buckets, consolidatedAccounts);
  }

  // Year-end adjustments flagged offset_to_ic_net additionally inject the
  // OPPOSITE amount into a virtual IC account so the IC elimination block
  // folds it into the synthetic "Intercompany Eliminations, Net" line.
  //
  // Sign convention: the source-account adjustment is one side of a balanced
  // journal entry; the IC offset is the other side, so it carries the
  // opposite sign (matches how pro_forma_adjustments.offset_master_account_id
  // works). Example: source = -$34,079 (reduce expense) → IC offset =
  // +$34,079, which lands in the IC sum and cancels an existing -$34,079
  // residual. Without this sign flip the offset would double the residual.
  const offsetEntries: Array<{
    master_account_id: string;
    period_year: number;
    period_month: number;
    amount: number;
  }> = [];
  for (let i = 0; i < yearAdjRows.length; i++) {
    const r = yearAdjRows[i];
    if (!r.offset_to_ic_net) continue;
    const sourceMa = masterAccounts.find(
      (m: { id: string }) => m.id === r.master_account_id,
    );
    if (!sourceMa) continue;
    const cls = sourceMa.classification as string;
    if (!["Asset", "Liability", "Revenue", "Expense"].includes(cls)) continue;

    const virtualId = `__year_adj_ic_offset_${i}__`;
    consolidatedAccounts.push({
      id: virtualId,
      name: "Intercompany Adjustment",
      accountNumber: null,
      classification: cls,
      accountType: sourceMa.account_type,
      isIntercompany: true,
      parentAccountId: null,
    });
    offsetEntries.push({
      master_account_id: virtualId,
      period_year: Number(r.period_year),
      period_month: 12,
      amount: -Number(r.amount),
    });
  }
  if (offsetEntries.length > 0) {
    applyProFormaPostAggregation(
      aggregated,
      offsetEntries,
      buckets,
      consolidatedAccounts,
    );
  }

  // Prior year aggregation for YoY
  let pyAggregated: Map<string, BucketedAmounts> | undefined;
  if (includeYoY) {
    const pyBuckets = createPriorYearBuckets(buckets);
    pyAggregated = aggregateByBucket(consolidatedAccounts, consolidatedBalances, pyBuckets, fiscalYearStartMonth);
    // Apply pro forma to prior year buckets so YoY comparisons include adjustments
    if (proFormaRows.length > 0) {
      applyProFormaPostAggregation(pyAggregated, proFormaRows, pyBuckets, consolidatedAccounts);
    }
    if (allocEntries.length > 0) {
      applyProFormaPostAggregation(pyAggregated, allocEntries, pyBuckets, consolidatedAccounts);
    }
    if (yearAdjEntries.length > 0) {
      applyProFormaPostAggregation(pyAggregated, yearAdjEntries, pyBuckets, consolidatedAccounts);
    }
    if (offsetEntries.length > 0) {
      applyProFormaPostAggregation(pyAggregated, offsetEntries, pyBuckets, consolidatedAccounts);
    }
  }

  // Intercompany elimination: remove individual intercompany P&L accounts
  // from the statement.  If intercompany revenue and expense don't perfectly
  // cancel (timing differences, data entry errors), show a single
  // "Intercompany Eliminations, Net" line with the residual.
  const intercompanyAccounts = consolidatedAccounts.filter(
    (a) => a.isIntercompany && (a.classification === "Revenue" || a.classification === "Expense")
  );
  const intercompanyIds = new Set(intercompanyAccounts.map((a) => a.id));

  if (intercompanyIds.size > 0) {
    // Compute the net intercompany effect per bucket.
    // Revenue accounts are credit-normal (stored negative in GL), so we
    // negate them to get the display-sign amount, then net against expenses.
    // A perfectly balanced pair yields zero net.
    const netChange: Record<string, number> = {};
    const netEnding: Record<string, number> = {};
    const netBeginning: Record<string, number> = {};
    const pyNetChange: Record<string, number> = {};
    const pyNetEnding: Record<string, number> = {};
    const pyNetBeginning: Record<string, number> = {};

    for (const bucket of buckets) {
      netChange[bucket.key] = 0;
      netEnding[bucket.key] = 0;
      netBeginning[bucket.key] = 0;
      pyNetChange[bucket.key] = 0;
      pyNetEnding[bucket.key] = 0;
      pyNetBeginning[bucket.key] = 0;
    }

    for (const account of intercompanyAccounts) {
      const bucketed = aggregated.get(account.id);
      if (bucketed) {
        for (const key of Object.keys(bucketed.netChange)) {
          // Sum raw GL-sign values (no sign flip).  Revenue endings are
          // negative (credit-normal) and expense endings are positive
          // (debit-normal) — a perfectly matched pair sums to zero.
          // The synthetic account that receives these totals is classified
          // as Expense; injectNetIncomeIntoBalanceSheet reads endingBalance
          // in GL-sign convention, so we must NOT convert to display-sign.
          netChange[key] = (netChange[key] ?? 0) + bucketed.netChange[key];
          netEnding[key] = (netEnding[key] ?? 0) + bucketed.endingBalance[key];
          netBeginning[key] = (netBeginning[key] ?? 0) + bucketed.beginningBalance[key];
        }
      }
      if (pyAggregated) {
        const pyBucketed = pyAggregated.get(account.id);
        if (pyBucketed) {
          for (const key of Object.keys(pyBucketed.netChange)) {
            pyNetChange[key] = (pyNetChange[key] ?? 0) + pyBucketed.netChange[key];
            pyNetEnding[key] = (pyNetEnding[key] ?? 0) + pyBucketed.endingBalance[key];
            pyNetBeginning[key] = (pyNetBeginning[key] ?? 0) + pyBucketed.beginningBalance[key];
          }
        }
      }
    }

    // Remove individual intercompany accounts from the list and aggregated maps
    for (const accountId of intercompanyIds) {
      aggregated.delete(accountId);
      pyAggregated?.delete(accountId);
    }
    // Mutate in place — remove intercompany accounts so buildStatement won't see them
    const kept = consolidatedAccounts.filter((a) => !intercompanyIds.has(a.id));
    consolidatedAccounts.length = 0;
    consolidatedAccounts.push(...kept);

    // If there's a non-zero net effect in any period, inject a synthetic
    // "Intercompany Eliminations, Net" account into Other Expense. Use a
    // 50¢ threshold to match the BS side and to suppress sub-dollar
    // floating-point residuals (e.g., a perfectly-balanced offset can leave
    // ~$0.15 after summing millions).
    const hasNetEffect =
      Object.values(netChange).some((v) => Math.abs(v) >= 0.50) ||
      Object.values(pyNetChange).some((v) => Math.abs(v) >= 0.50);

    if (hasNetEffect) {
      const syntheticId = "__intercompany_net__";
      consolidatedAccounts.push({
        id: syntheticId,
        name: "Intercompany Eliminations, Net",
        accountNumber: null,
        classification: "Expense",
        accountType: "Other Expense",
        isIntercompany: false,
      });
      aggregated.set(syntheticId, {
        netChange: { ...netChange },
        endingBalance: { ...netEnding },
        beginningBalance: { ...netBeginning },
      });
      if (pyAggregated) {
        pyAggregated.set(syntheticId, {
          netChange: { ...pyNetChange },
          endingBalance: { ...pyNetEnding },
          beginningBalance: { ...pyNetBeginning },
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Intercompany elimination — BALANCE SHEET
  // ---------------------------------------------------------------------------
  // Remove individual "Due From" (asset) and "Due To" (liability) IC accounts.
  // In a perfect consolidation these cancel to $0.  Any residual is split by
  // sign per bucket: positive (net receivable) → Asset side, negative (net
  // payable) → Liability side.  This avoids showing negative values on either
  // side of the balance sheet.
  const icBSAccounts = consolidatedAccounts.filter(
    (a) =>
      a.isIntercompany &&
      (a.classification === "Asset" || a.classification === "Liability")
  );
  const icBSIds = new Set(icBSAccounts.map((a) => a.id));

  if (icBSIds.size > 0) {
    const bsNetEnding: Record<string, number> = {};
    const bsNetBeginning: Record<string, number> = {};
    const pyBsNetEnding: Record<string, number> = {};
    const pyBsNetBeginning: Record<string, number> = {};

    for (const bucket of buckets) {
      bsNetEnding[bucket.key] = 0;
      bsNetBeginning[bucket.key] = 0;
      pyBsNetEnding[bucket.key] = 0;
      pyBsNetBeginning[bucket.key] = 0;
    }

    for (const account of icBSAccounts) {
      const bucketed = aggregated.get(account.id);
      if (bucketed) {
        for (const key of Object.keys(bucketed.endingBalance)) {
          // Sum raw GL-sign values.  Assets (debit-normal) are positive,
          // liabilities (credit-normal) are negative.  A balanced pair
          // cancels to zero.
          bsNetEnding[key] = (bsNetEnding[key] ?? 0) + bucketed.endingBalance[key];
          bsNetBeginning[key] = (bsNetBeginning[key] ?? 0) + bucketed.beginningBalance[key];
        }
      }
      if (pyAggregated) {
        const pyBucketed = pyAggregated.get(account.id);
        if (pyBucketed) {
          for (const key of Object.keys(pyBucketed.endingBalance)) {
            pyBsNetEnding[key] = (pyBsNetEnding[key] ?? 0) + pyBucketed.endingBalance[key];
            pyBsNetBeginning[key] = (pyBsNetBeginning[key] ?? 0) + pyBucketed.beginningBalance[key];
          }
        }
      }
    }

    // Remove individual IC balance sheet accounts
    for (const accountId of icBSIds) {
      aggregated.delete(accountId);
      pyAggregated?.delete(accountId);
    }
    const keptBS = consolidatedAccounts.filter((a) => !icBSIds.has(a.id));
    consolidatedAccounts.length = 0;
    consolidatedAccounts.push(...keptBS);

    // Split the net IC balance per bucket: positive amounts (net receivable)
    // go on the Asset side, negative amounts (net payable) go on the
    // Liability side.  This avoids showing a negative asset or a negative
    // liability — each side only carries its natural-sign residual.
    const assetEnding: Record<string, number> = {};
    const assetBeginning: Record<string, number> = {};
    const liabEnding: Record<string, number> = {};
    const liabBeginning: Record<string, number> = {};
    const pyAssetEnding: Record<string, number> = {};
    const pyAssetBeginning: Record<string, number> = {};
    const pyLiabEnding: Record<string, number> = {};
    const pyLiabBeginning: Record<string, number> = {};

    for (const key of Object.keys(bsNetEnding)) {
      // Positive net = debit (asset-like), negative net = credit (liability-like)
      if (bsNetEnding[key] >= 0) {
        assetEnding[key] = bsNetEnding[key];
        liabEnding[key] = 0;
      } else {
        assetEnding[key] = 0;
        liabEnding[key] = bsNetEnding[key]; // stays negative (GL credit convention)
      }
      if (bsNetBeginning[key] >= 0) {
        assetBeginning[key] = bsNetBeginning[key];
        liabBeginning[key] = 0;
      } else {
        assetBeginning[key] = 0;
        liabBeginning[key] = bsNetBeginning[key];
      }
    }
    for (const key of Object.keys(pyBsNetEnding)) {
      if (pyBsNetEnding[key] >= 0) {
        pyAssetEnding[key] = pyBsNetEnding[key];
        pyLiabEnding[key] = 0;
      } else {
        pyAssetEnding[key] = 0;
        pyLiabEnding[key] = pyBsNetEnding[key];
      }
      if (pyBsNetBeginning[key] >= 0) {
        pyAssetBeginning[key] = pyBsNetBeginning[key];
        pyLiabBeginning[key] = 0;
      } else {
        pyAssetBeginning[key] = 0;
        pyLiabBeginning[key] = pyBsNetBeginning[key];
      }
    }

    // Inject asset-side synthetic only if a current-period bucket has a
    // meaningful positive residual.  Prior-year-only values are not enough
    // to justify a line — they would show $— across all visible columns.
    const hasAssetEffect =
      Object.values(assetEnding).some((v) => Math.abs(v) >= 0.50);

    if (hasAssetEffect) {
      const syntheticAssetId = "__intercompany_bs_net_asset__";
      consolidatedAccounts.push({
        id: syntheticAssetId,
        name: "Intercompany Eliminations, Net",
        accountNumber: null,
        classification: "Asset",
        accountType: "Other Asset",
        isIntercompany: false,
      });
      const assetNetChange: Record<string, number> = {};
      for (const key of Object.keys(assetEnding)) {
        assetNetChange[key] = assetEnding[key] - (assetBeginning[key] ?? 0);
      }
      aggregated.set(syntheticAssetId, {
        netChange: assetNetChange,
        endingBalance: { ...assetEnding },
        beginningBalance: { ...assetBeginning },
      });
      if (pyAggregated) {
        const pyAssetNetChange: Record<string, number> = {};
        for (const key of Object.keys(pyAssetEnding)) {
          pyAssetNetChange[key] = pyAssetEnding[key] - (pyAssetBeginning[key] ?? 0);
        }
        pyAggregated.set(syntheticAssetId, {
          netChange: pyAssetNetChange,
          endingBalance: { ...pyAssetEnding },
          beginningBalance: { ...pyAssetBeginning },
        });
      }
    }

    // Inject liability-side synthetic only if a current-period bucket has a
    // meaningful negative residual.
    const hasLiabEffect =
      Object.values(liabEnding).some((v) => Math.abs(v) >= 0.50);

    if (hasLiabEffect) {
      const syntheticLiabId = "__intercompany_bs_net_liab__";
      consolidatedAccounts.push({
        id: syntheticLiabId,
        name: "Intercompany Eliminations, Net",
        accountNumber: null,
        classification: "Liability",
        accountType: "Long Term Liability",
        isIntercompany: false,
      });
      const liabNetChange: Record<string, number> = {};
      for (const key of Object.keys(liabEnding)) {
        liabNetChange[key] = liabEnding[key] - (liabBeginning[key] ?? 0);
      }
      aggregated.set(syntheticLiabId, {
        netChange: liabNetChange,
        endingBalance: { ...liabEnding },
        beginningBalance: { ...liabBeginning },
      });
      if (pyAggregated) {
        const pyLiabNetChange: Record<string, number> = {};
        for (const key of Object.keys(pyLiabEnding)) {
          pyLiabNetChange[key] = pyLiabEnding[key] - (pyLiabBeginning[key] ?? 0);
        }
        pyAggregated.set(syntheticLiabId, {
          netChange: pyLiabNetChange,
          endingBalance: { ...pyLiabEnding },
          beginningBalance: { ...pyLiabBeginning },
        });
      }
    }
  }

  // Budget data
  let consolidatedBudgetByAccount: Map<string, Record<string, number>> | undefined;

  if (includeBudget && entityIds.length > 0) {
    const budgetYears = [
      ...new Set(buckets.flatMap((b) => b.months.map((m) => m.year))),
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: activeVersions } = await (admin as any)
      .from("budget_versions")
      .select("id, fiscal_year, entity_id")
      .in("entity_id", entityIds)
      .eq("is_active", true)
      .in("fiscal_year", budgetYears);

    const versionIds = (activeVersions ?? []).map(
      (v: { id: string }) => v.id
    );

    if (versionIds.length > 0) {
      const budgetResult = await fetchBudgetAmounts(admin, versionIds);

      if (budgetResult.rows.length > 0) {
        // Build entityToMaster mapping (needed if column is account_id)
        const entityToMaster = new Map<string, string>();
        for (const m of mappings ?? []) {
          entityToMaster.set(m.account_id, m.master_account_id);
        }

        consolidatedBudgetByAccount = aggregateBudgetByBucket(
          budgetResult.rows,
          buckets,
          budgetResult.column,
          entityToMaster
        );
      }
    }
  }

  // Roll children's amounts into their parent rows. No-op for charts that
  // don't use the parent_account_id hierarchy (e.g. management chart).
  const displayAccounts = applyParentRollup(consolidatedAccounts, aggregated, buckets);
  if (pyAggregated) applyParentRollup(consolidatedAccounts, pyAggregated, buckets);

  // Build statements
  const incomeStatement = buildStatement(
    "income_statement",
    "Income Statement",
    INCOME_STATEMENT_SECTIONS,
    INCOME_STATEMENT_COMPUTED,
    displayAccounts,
    aggregated,
    buckets,
    true,
    consolidatedBudgetByAccount,
    pyAggregated
  );

  const netIncomeByBucket: Record<string, number> = {};
  const pyNetIncomeByBucket: Record<string, number> = {};
  const netIncomeSection = incomeStatement.sections.find(
    (s) => s.id === "net_income"
  );
  for (const bucket of buckets) {
    netIncomeByBucket[bucket.key] =
      netIncomeSection?.subtotalLine?.amounts[bucket.key] ?? 0;
    pyNetIncomeByBucket[bucket.key] =
      netIncomeSection?.subtotalLine?.priorYearAmounts?.[bucket.key] ?? 0;
  }

  const balanceSheet = buildStatement(
    "balance_sheet",
    "Balance Sheet",
    BALANCE_SHEET_SECTIONS,
    BALANCE_SHEET_COMPUTED,
    displayAccounts,
    aggregated,
    buckets,
    false,
    undefined,
    pyAggregated
  );

  // Inject Net Income into BS equity so Assets = L + E. For accountant-style
  // charts (per-entity equity rollups), allocate NI to each entity's own
  // accumulated-deficit / member's-equity line instead of a standalone row.
  const niDestinations = findEntityNIDestinations(
    masterAccounts as Array<{
      id: string;
      name: string;
      classification: string;
      parent_account_id?: string | null;
    }>,
    (mappings ?? []) as Array<{
      master_account_id: string;
      entity_id: string;
    }>,
  );

  if (niDestinations.size > 0) {
    const niByEntity = computePerEntityNI(
      consolidatedAccounts,
      masterAccounts as Array<{ id: string; classification: string }>,
      mappings ?? [],
      glBalances,
      buckets,
      fiscalYearStartMonth,
    );
    applyEntityTaggedYearAdjustments(
      niByEntity,
      yearAdjRows,
      masterAccounts as Array<{ id: string; classification: string }>,
      buckets,
    );
    reconcileEntityNIToTotal(
      niByEntity,
      niDestinations,
      netIncomeByBucket,
      buckets,
    );

    let pyNiByEntity: Map<string, Record<string, number>> | undefined;
    if (includeYoY) {
      const pyBuckets = createPriorYearBuckets(buckets);
      pyNiByEntity = computePerEntityNI(
        consolidatedAccounts,
        masterAccounts as Array<{ id: string; classification: string }>,
        mappings ?? [],
        glBalances,
        pyBuckets,
        fiscalYearStartMonth,
      );
      applyEntityTaggedYearAdjustments(
        pyNiByEntity,
        yearAdjRows,
        masterAccounts as Array<{ id: string; classification: string }>,
        pyBuckets,
      );
      reconcileEntityNIToTotal(
        pyNiByEntity,
        niDestinations,
        pyNetIncomeByBucket,
        buckets,
      );
    }

    applyEntityNIToBalanceSheet(
      balanceSheet,
      niByEntity,
      pyNiByEntity,
      niDestinations,
      buckets,
    );
  } else {
    injectNetIncomeIntoBalanceSheet(
      balanceSheet,
      displayAccounts,
      aggregated,
      buckets,
      pyAggregated,
    );
  }

  // Inject "Pro Forma Adjustments" line for amounts redirected from bank accounts
  injectProFormaAdjustmentsIntoBalanceSheet(
    balanceSheet,
    aggregated,
    buckets,
    pyAggregated
  );

  // Build supplemental entries for cash flow pro forma section
  const cfSupplementalEntries: CashFlowSupplementalEntry[] = [
    ...proFormaRows
      .map((pf) => ({
        description: pf.description,
        primaryAccountId: pf.master_account_id,
        ...(pf.offset_master_account_id ? { offsetAccountId: pf.offset_master_account_id } : {}),
        periodYear: Number(pf.period_year),
        periodMonth: Number(pf.period_month),
        amount: Number(pf.amount),
      })),
    ...allocReclassEntries,
  ];

  // Gross capex / disposal proceeds from the fixed-asset subledger (Investing).
  const assetCashFlows = await fetchAssetCashFlows(admin, entityIds, buckets);
  // Hand-entered Fixed-Asset Activity schedule (explains GL-only movements).
  const scheduleCashFlows = includeFixedAssetSchedule
    ? await fetchScheduleCashFlows(admin, entityIds, buckets)
    : undefined;
  const cashFlowStatement = buildCashFlowStatement(
    displayAccounts,
    aggregated,
    buckets,
    netIncomeByBucket,
    includeYoY ? pyAggregated : undefined,
    includeYoY ? pyNetIncomeByBucket : undefined,
    cfSupplementalEntries.length > 0 ? cfSupplementalEntries : undefined,
    assetCashFlows,
    scheduleCashFlows
  );

  const periods: Period[] = buckets.map((b) => ({
    key: b.key,
    label: b.label,
    year: b.year,
    startMonth: b.startMonth,
    endMonth: b.endMonth,
    endYear: b.endYear,
    ...(b.key === "TOTAL" ? { isTotal: true } : {}),
  }));

  // Compute server-side balance sheet check: Assets - (Liabilities + Equity)
  // Should be zero for every period if data is complete.
  const bsCheck: Record<string, number> = {};
  const totalAssetsLine = balanceSheet.sections
    .find((s) => s.id === "total_assets")?.subtotalLine;
  const totalLELine = balanceSheet.sections
    .find((s) => s.id === "total_liabilities_equity")?.subtotalLine;
  if (totalAssetsLine && totalLELine) {
    for (const b of buckets) {
      const assets = totalAssetsLine.amounts[b.key] ?? 0;
      const le = totalLELine.amounts[b.key] ?? 0;
      bsCheck[b.key] = Math.round((assets - le) * 100) / 100;
    }
  }

  // Build pro forma detail records for frontend display
  const proFormaAdjustments = proFormaRows.length > 0
    ? buildProFormaDetails(proFormaRows, masterAccounts, entityLookup, buckets)
    : undefined;

  return {
    periods,
    incomeStatement,
    balanceSheet,
    cashFlowStatement,
    diagnostics: {
      masterAccountsLoaded: masterAccounts.length,
      mappingsLoaded: (mappings ?? []).length,
      glRowsFetchedRaw: glRawCount,
      glRowsAfterFilter: glBalances.length,
      uniqueAccountsWithData: new Set(glBalances.map((b) => b.account_id)).size,
      entityCount: entityIds.length,
      paginationErrors: glHadErrors,
      bsCheck,
    },
    ...(proFormaAdjustments ? { proFormaAdjustments } : {}),
  };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scope = (searchParams.get("scope") ?? "entity") as Scope;
  const entityId = searchParams.get("entityId");
  const organizationId = searchParams.get("organizationId");
  const reportingEntityId = searchParams.get("reportingEntityId");
  const startYear = parseInt(searchParams.get("startYear") ?? "2025");
  const startMonth = parseInt(searchParams.get("startMonth") ?? "1");
  const endYear = parseInt(searchParams.get("endYear") ?? "2025");
  const endMonth = parseInt(searchParams.get("endMonth") ?? "12");
  const granularity = (searchParams.get("granularity") ?? "monthly") as Granularity;
  const includeBudget = searchParams.get("includeBudget") === "true";
  const includeYoY = searchParams.get("includeYoY") === "true";
  const includeProForma = searchParams.get("includeProForma") === "true";
  const includeAllocations = searchParams.get("includeAllocations") === "true";
  // Fixed-Asset Activity schedule reclass is on by default; pass "false" to hide.
  const includeFixedAssetSchedule =
    searchParams.get("includeFixedAssetSchedule") !== "false";
  const includeTotal = searchParams.get("includeTotal") === "true";
  const chartIdParam = searchParams.get("chartId");

  if (scope === "entity" && !entityId) {
    return NextResponse.json(
      { error: "entityId is required for entity scope" },
      { status: 400 }
    );
  }

  if (scope === "reporting_entity" && !reportingEntityId) {
    return NextResponse.json(
      { error: "reportingEntityId is required for reporting_entity scope" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Generate period buckets
  const buckets = getPeriodsInRange(
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity
  );

  if (buckets.length === 0) {
    return NextResponse.json(
      { error: "No periods in the specified range" },
      { status: 400 }
    );
  }

  // Append a synthetic "Total" bucket that spans all months when requested
  if (includeTotal && buckets.length > 1) {
    const allBucketMonths = buckets.flatMap((b) => b.months);
    buckets.push({
      key: "TOTAL",
      label: "Total",
      year: endYear,
      startMonth: buckets[0].startMonth,
      endMonth: buckets[buckets.length - 1].endMonth,
      endYear,
      months: allBucketMonths,
    });
  }

  // Collect all months we need to query
  const allMonths = collectAllMonths(buckets, includeYoY);

  // --- ENTITY SCOPE ---
  if (scope === "entity") {
    // Verify access
    const { data: entity } = await admin
      .from("entities")
      .select("id, name, code, organization_id, fiscal_year_end_month")
      .eq("id", entityId!)
      .single();

    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const fyEndMonth = entity.fiscal_year_end_month ?? 12;
    const fiscalYearStartMonth = (fyEndMonth % 12) + 1;

    // Get org info
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", entity.organization_id)
      .single();

    let chartId: string;
    try {
      chartId = await resolveChartIdOrDefault(
        admin,
        entity.organization_id,
        chartIdParam,
      );
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 400 },
      );
    }

    // Get master accounts in the active chart (paginated to avoid row-limit truncation)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const masterAccounts = await fetchAllPaginated<any>((offset, limit) =>
      admin
        .from("master_accounts")
        .select("*")
        .eq("organization_id", entity.organization_id)
        .eq("chart_id", chartId)
        .eq("is_active", true)
        .order("display_order")
        .order("account_number")
        .range(offset, offset + limit - 1)
    );

    if (masterAccounts.length === 0) {
      return NextResponse.json({
        periods: [],
        incomeStatement: { id: "income_statement", title: "Income Statement", sections: [] },
        balanceSheet: { id: "balance_sheet", title: "Balance Sheet", sections: [] },
        cashFlowStatement: { id: "cash_flow", title: "Statement of Cash Flows", sections: [] },
        metadata: {
          entityName: entity.name,
          organizationName: org?.name ?? undefined,
          generatedAt: new Date().toISOString(),
          scope,
          granularity,
          startPeriod: `${startYear}-${startMonth}`,
          endPeriod: `${endYear}-${endMonth}`,
        },
      });
    }

    // Get mappings for THIS entity only
    const masterAccountIds = masterAccounts.map((ma) => ma.id);
    const mappings = await fetchAllPaginated<any>((offset, limit) =>
      admin
        .from("master_account_mappings")
        .select("master_account_id, entity_id, account_id")
        .in("master_account_id", masterAccountIds)
        .eq("entity_id", entityId!)
        .range(offset, offset + limit - 1)
    );

    // Get GL balances for mapped accounts (paginated to avoid row limit truncation)
    const mappedAccountIds = mappings.map((m) => m.account_id);
    let glBalances: RawGLBalance[] = [];
    let entityGlRawCount = 0;
    let entityGlHadErrors = false;

    if (mappedAccountIds.length > 0) {
      const uniqueYears = [...new Set(allMonths.map((m) => m.year))];
      const uniqueMonthNums = [...new Set(allMonths.map((m) => m.month))];

      const glResult = await fetchAllGLBalances(admin, {
        filterColumn: "account_id",
        filterValues: mappedAccountIds,
        years: uniqueYears,
        months: uniqueMonthNums,
      });
      entityGlRawCount = glResult.rows.length;
      entityGlHadErrors = glResult.hadErrors;

      const monthSet = new Set(
        allMonths.map(
          (m) => `${m.year}-${String(m.month).padStart(2, "0")}`
        )
      );
      // Filter to exact (year,month) pairs needed
      glBalances = glResult.rows.filter((b) =>
        monthSet.has(
          `${b.period_year}-${String(b.period_month).padStart(2, "0")}`
        )
      );
    }

    // Build mapping: master account ID -> list of entity account_ids
    const masterToEntityAccounts = new Map<string, string[]>();
    for (const m of mappings ?? []) {
      const existing = masterToEntityAccounts.get(m.master_account_id) ?? [];
      existing.push(m.account_id);
      masterToEntityAccounts.set(m.master_account_id, existing);
    }

    // Consolidate: For each master account, sum the GL balances of mapped entity accounts
    const consolidatedAccounts: AccountInfo[] = masterAccounts.map((ma) => ({
      id: ma.id,
      name: ma.name,
      accountNumber: ma.account_number,
      classification: ma.classification,
      accountType: ma.account_type,
      isIntercompany: ma.is_intercompany ?? false,
      parentAccountId: ma.parent_account_id ?? null,
    }));

    const consolidatedBalances: RawGLBalance[] = [];

    for (const ma of masterAccounts) {
      const entityAccountIds = masterToEntityAccounts.get(ma.id) ?? [];
      const entityBalances = glBalances.filter((b) =>
        entityAccountIds.includes(b.account_id)
      );

      // Group by period
      const periodMap = new Map<
        string,
        { beginning: number; ending: number; netChange: number }
      >();

      for (const b of entityBalances) {
        const key = `${b.period_year}-${b.period_month}`;
        const existing = periodMap.get(key) ?? {
          beginning: 0,
          ending: 0,
          netChange: 0,
        };
        existing.beginning += b.beginning_balance;
        existing.ending += b.ending_balance;
        existing.netChange += b.net_change;
        periodMap.set(key, existing);
      }

      for (const [key, vals] of periodMap) {
        const [y, m] = key.split("-").map(Number);
        consolidatedBalances.push({
          account_id: ma.id, // use master account ID
          entity_id: entityId!,
          period_year: y,
          period_month: m,
          beginning_balance: vals.beginning,
          ending_balance: vals.ending,
          net_change: vals.netChange,
        });
      }
    }

    // --- Pro Forma Adjustments (entity scope) ---
    // Fetch now, apply AFTER aggregation so each adjustment only appears
    // in its target period (not subsequent ones).
    let entityProFormaRows: RawProFormaAdjustment[] = [];
    if (includeProForma) {
      // Paginated to avoid PostgREST row-limit truncation
      entityProFormaRows = await fetchAllPaginated<RawProFormaAdjustment>((offset, limit) =>
        (admin as any)
          .from("pro_forma_adjustments")
          .select("id, entity_id, master_account_id, offset_master_account_id, period_year, period_month, amount, description, notes")
          .eq("entity_id", entityId!)
          .eq("is_excluded", false)
          .range(offset, offset + limit - 1)
      );
      // NOTE: intentionally NOT injected into consolidatedBalances here.
      // Applied post-aggregation below via applyProFormaPostAggregation().
    }

    // --- Allocation Adjustments (entity scope) ---
    // Applied post-aggregation (like pro forma) to avoid corrupting adjacent
    // months' net change via the ending_balance diff calculation.
    let entityAllocReclassEntries: CashFlowSupplementalEntry[] = [];
    let entityAllocEntries: AllocationEntry[] = [];
    if (includeAllocations) {
      // Fetch allocations where this entity is source or destination (paginated)
      const allocRows = await fetchAllPaginated<RawAllocationAdjustment>((offset, limit) =>
        (admin as any)
          .from("allocation_adjustments")
          .select("source_entity_id, destination_entity_id, master_account_id, destination_master_account_id, amount, description, schedule_type, period_year, period_month, start_year, start_month, end_year, end_month, is_repeating, repeat_end_year, repeat_end_month")
          .or(`source_entity_id.eq.${entityId!},destination_entity_id.eq.${entityId!}`)
          .eq("is_excluded", false)
          .range(offset, offset + limit - 1)
      );

      if (allocRows.length > 0) {
        const expanded = expandAllocationAdjustments(allocRows);
        // Only keep entries that belong to this entity
        entityAllocEntries = expanded.filter((e) => e.entity_id === entityId!);

        // Inter-entity legs are one-sided at entity scope: the counterpart
        // lives in another entity, so the net-income shift has no balance-
        // sheet offset.  Add the "Due to/from affiliates" leg to balance.
        const dueToFromOffsets = buildAllocationDueToFromOffsets(
          entityAllocEntries,
          (eid) => eid === entityId!
        );
        if (dueToFromOffsets.length > 0) {
          entityAllocEntries.push(...dueToFromOffsets);
          consolidatedAccounts.push(makeAllocDueToFromAccount());
        }

        // Build supplemental entries for intra-entity reclass allocations
        entityAllocReclassEntries = buildAllocationSupplementalEntries(allocRows, buckets);
      }
    }

    // Aggregate into buckets
    const aggregated = aggregateByBucket(
      consolidatedAccounts,
      consolidatedBalances,
      buckets,
      fiscalYearStartMonth
    );

    // Apply pro forma adjustments post-aggregation (target period only)
    if (entityProFormaRows.length > 0) {
      applyProFormaPostAggregation(aggregated, entityProFormaRows, buckets, consolidatedAccounts);
    }

    // Apply allocation adjustments post-aggregation (same reason as consolidated)
    if (entityAllocEntries.length > 0) {
      applyProFormaPostAggregation(aggregated, entityAllocEntries, buckets, consolidatedAccounts);
    }

    // Prior year aggregation for YoY
    let pyAggregated: Map<string, BucketedAmounts> | undefined;
    if (includeYoY) {
      const pyBuckets = createPriorYearBuckets(buckets);
      pyAggregated = aggregateByBucket(consolidatedAccounts, consolidatedBalances, pyBuckets, fiscalYearStartMonth);
      // Apply pro forma to prior year buckets so YoY comparisons include adjustments
      if (entityProFormaRows.length > 0) {
        applyProFormaPostAggregation(pyAggregated, entityProFormaRows, pyBuckets, consolidatedAccounts);
      }
      if (entityAllocEntries.length > 0) {
        applyProFormaPostAggregation(pyAggregated, entityAllocEntries, pyBuckets, consolidatedAccounts);
      }
    }

    // --------------- Budget data (entity scope) ---------------
    let budgetByAccount: Map<string, Record<string, number>> | undefined;

    if (includeBudget) {
      // Determine which fiscal years we need budgets for
      const budgetYears = [
        ...new Set(buckets.flatMap((b) => b.months.map((m) => m.year))),
      ];

      // Find active budget versions for this entity in those years
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- budget tables not yet in generated types
      const { data: activeVersions } = await (admin as any)
        .from("budget_versions")
        .select("id, fiscal_year")
        .eq("entity_id", entityId!)
        .eq("is_active", true)
        .in("fiscal_year", budgetYears);

      const versionIds = (activeVersions ?? []).map(
        (v: { id: string }) => v.id
      );

      if (versionIds.length > 0) {
        const budgetResult = await fetchBudgetAmounts(admin, versionIds);

        if (budgetResult.rows.length > 0) {
          // Build entityToMaster mapping (needed if column is account_id)
          const entityToMaster = new Map<string, string>();
          for (const m of mappings ?? []) {
            entityToMaster.set(m.account_id, m.master_account_id);
          }

          budgetByAccount = aggregateBudgetByBucket(
            budgetResult.rows,
            buckets,
            budgetResult.column,
            entityToMaster
          );
        }
      }
    }

    // Roll children's amounts into their parent rows. No-op when no
    // parent_account_id is set (the management chart).
    const displayAccounts = applyParentRollup(consolidatedAccounts, aggregated, buckets);
    if (pyAggregated) applyParentRollup(consolidatedAccounts, pyAggregated, buckets);

    // Build Income Statement
    const incomeStatement = buildStatement(
      "income_statement",
      "Income Statement",
      INCOME_STATEMENT_SECTIONS,
      INCOME_STATEMENT_COMPUTED,
      displayAccounts,
      aggregated,
      buckets,
      true, // use net_change
      budgetByAccount,
      pyAggregated
    );

    // Extract net income by bucket for cash flow
    const netIncomeByBucket: Record<string, number> = {};
    const pyNetIncomeByBucket: Record<string, number> = {};
    const netIncomeSection = incomeStatement.sections.find(
      (s) => s.id === "net_income"
    );
    if (netIncomeSection?.subtotalLine) {
      for (const bucket of buckets) {
        netIncomeByBucket[bucket.key] =
          netIncomeSection.subtotalLine.amounts[bucket.key] ?? 0;
        pyNetIncomeByBucket[bucket.key] =
          netIncomeSection.subtotalLine.priorYearAmounts?.[bucket.key] ?? 0;
      }
    } else {
      for (const bucket of buckets) {
        netIncomeByBucket[bucket.key] = 0;
        pyNetIncomeByBucket[bucket.key] = 0;
      }
    }

    // Build Balance Sheet (no budget data — budgets are P&L only)
    const balanceSheet = buildStatement(
      "balance_sheet",
      "Balance Sheet",
      BALANCE_SHEET_SECTIONS,
      BALANCE_SHEET_COMPUTED,
      displayAccounts,
      aggregated,
      buckets,
      false, // use ending_balance
      undefined, // no budget for BS
      pyAggregated
    );

    // Inject Net Income into BS equity so Assets = L + E
    injectNetIncomeIntoBalanceSheet(
      balanceSheet,
      displayAccounts,
      aggregated,
      buckets,
      pyAggregated
    );

    // Inject "Pro Forma Adjustments" line for amounts redirected from bank accounts
    injectProFormaAdjustmentsIntoBalanceSheet(
      balanceSheet,
      aggregated,
      buckets,
      pyAggregated
    );

    // Build supplemental entries for cash flow pro forma section
    const entityCfSupplementalEntries: CashFlowSupplementalEntry[] = [
      ...entityProFormaRows
        .map((pf) => ({
          description: pf.description,
          primaryAccountId: pf.master_account_id,
          ...(pf.offset_master_account_id ? { offsetAccountId: pf.offset_master_account_id } : {}),
          periodYear: Number(pf.period_year),
          periodMonth: Number(pf.period_month),
          amount: Number(pf.amount),
        })),
      ...entityAllocReclassEntries,
    ];

    // Build Cash Flow Statement
    // Gross capex / disposal proceeds from the fixed-asset subledger (Investing).
    const assetCashFlows = await fetchAssetCashFlows(admin, [entityId!], buckets);
    // Hand-entered Fixed-Asset Activity schedule (explains GL-only movements).
    const scheduleCashFlows = includeFixedAssetSchedule
      ? await fetchScheduleCashFlows(admin, [entityId!], buckets)
      : undefined;
    const cashFlowStatement = buildCashFlowStatement(
      displayAccounts,
      aggregated,
      buckets,
      netIncomeByBucket,
      includeYoY ? pyAggregated : undefined,
      includeYoY ? pyNetIncomeByBucket : undefined,
      entityCfSupplementalEntries.length > 0 ? entityCfSupplementalEntries : undefined,
      assetCashFlows,
      scheduleCashFlows
    );

    // Build periods array
    const periods: Period[] = buckets.map((b) => ({
      key: b.key,
      label: b.label,
      year: b.year,
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      endYear: b.endYear,
      ...(b.key === "TOTAL" ? { isTotal: true } : {}),
    }));

    // Compute server-side balance sheet check for entity scope
    const entityBsCheck: Record<string, number> = {};
    const entityTotalAssetsLine = balanceSheet.sections
      .find((s) => s.id === "total_assets")?.subtotalLine;
    const entityTotalLELine = balanceSheet.sections
      .find((s) => s.id === "total_liabilities_equity")?.subtotalLine;
    if (entityTotalAssetsLine && entityTotalLELine) {
      for (const b of buckets) {
        const assets = entityTotalAssetsLine.amounts[b.key] ?? 0;
        const le = entityTotalLELine.amounts[b.key] ?? 0;
        entityBsCheck[b.key] = Math.round((assets - le) * 100) / 100;
      }
    }

    // Build pro forma detail records for entity scope
    const entityPfLookup = new Map<string, { name: string; code: string }>();
    entityPfLookup.set(entityId!, { name: entity.name, code: entity.code });
    const entityProFormaDetails = entityProFormaRows.length > 0
      ? buildProFormaDetails(entityProFormaRows, masterAccounts, entityPfLookup, buckets)
      : undefined;

    const response = {
      periods,
      incomeStatement,
      balanceSheet,
      cashFlowStatement,
      metadata: {
        entityName: entity.name,
        organizationName: org?.name ?? undefined,
        generatedAt: new Date().toISOString(),
        scope,
        granularity,
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
      ...(entityProFormaDetails ? { proFormaAdjustments: entityProFormaDetails } : {}),
      diagnostics: {
        masterAccountsLoaded: masterAccounts.length,
        mappingsLoaded: mappings.length,
        glRowsFetchedRaw: entityGlRawCount,
        glRowsAfterFilter: glBalances.length,
        uniqueAccountsWithData: new Set(glBalances.map((b) => b.account_id)).size,
        entityCount: 1,
        paginationErrors: entityGlHadErrors,
        bsCheck: entityBsCheck,
      },
    };

    return NextResponse.json(response);
  }

  // --- ORGANIZATION SCOPE ---
  if (scope === "organization") {
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId is required for organization scope" },
        { status: 400 }
      );
    }

    // Verify membership
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get org info
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single();

    // Get all active entities for this org
    const { data: orgEntities } = await admin
      .from("entities")
      .select("id, fiscal_year_end_month")
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    const allOrgEntityIds = (orgEntities ?? []).map(
      (e: { id: string }) => e.id,
    );
    const orgFyEnd = (orgEntities ?? [])[0]?.fiscal_year_end_month ?? 12;
    const orgFiscalYearStartMonth = (orgFyEnd % 12) + 1;

    // Drop entities that belong only to reporting entities flagged
    // `exclude_from_breakdown`. The dashboard and any other consumer of the
    // organization-scope statements treats this flag as authoritative, so
    // those entities should not contribute to consolidated revenue, EBITDA,
    // or net income totals.
    const excludedFromBreakdown = await getExcludedFromBreakdownEntityIds(
      admin,
      organizationId,
    );
    const orgEntityIds = allOrgEntityIds.filter(
      (id: string) => !excludedFromBreakdown.has(id),
    );

    let orgChartId: string;
    try {
      orgChartId = await resolveChartIdOrDefault(
        admin,
        organizationId,
        chartIdParam,
      );
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 400 },
      );
    }

    const result = await buildConsolidatedStatements({
      admin,
      organizationId,
      chartId: orgChartId,
      entityIds: orgEntityIds,
      buckets,
      allMonths,
      includeYoY,
      includeBudget,
      includeProForma,
      includeAllocations,
      includeFixedAssetSchedule,
      granularity,
      scope,
      startYear,
      startMonth,
      endYear,
      endMonth,
      fiscalYearStartMonth: orgFiscalYearStartMonth,
    });

    return NextResponse.json({
      ...result,
      metadata: {
        organizationName: org?.name ?? undefined,
        generatedAt: new Date().toISOString(),
        scope,
        granularity,
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

  // --- REPORTING ENTITY SCOPE ---
  if (scope === "reporting_entity") {
    // Fetch the reporting entity and its organization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: reportingEntity } = await (admin as any)
      .from("reporting_entities")
      .select("id, name, code, organization_id")
      .eq("id", reportingEntityId!)
      .single();

    if (!reportingEntity) {
      return NextResponse.json(
        { error: "Reporting entity not found" },
        { status: 404 }
      );
    }

    // Verify membership
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", reportingEntity.organization_id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get org info
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", reportingEntity.organization_id)
      .single();

    // Fetch member entity IDs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memberRows } = await (admin as any)
      .from("reporting_entity_members")
      .select("entity_id")
      .eq("reporting_entity_id", reportingEntityId!);

    const memberEntityIds = (memberRows ?? []).map(
      (r: { entity_id: string }) => r.entity_id
    );

    if (memberEntityIds.length === 0) {
      return NextResponse.json({
        periods: [],
        incomeStatement: { id: "income_statement", title: "Income Statement", sections: [] },
        balanceSheet: { id: "balance_sheet", title: "Balance Sheet", sections: [] },
        cashFlowStatement: { id: "cash_flow", title: "Statement of Cash Flows", sections: [] },
        metadata: {
          reportingEntityName: reportingEntity.name,
          organizationName: org?.name ?? undefined,
          generatedAt: new Date().toISOString(),
          scope,
          granularity,
          startPeriod: `${startYear}-${startMonth}`,
          endPeriod: `${endYear}-${endMonth}`,
        },
      });
    }

    // Get fiscal year end month from member entities
    const { data: reMemberEntities } = await admin
      .from("entities")
      .select("fiscal_year_end_month")
      .in("id", memberEntityIds)
      .limit(1);
    const reFyEnd = (reMemberEntities ?? [])[0]?.fiscal_year_end_month ?? 12;
    const reFiscalYearStartMonth = (reFyEnd % 12) + 1;

    let reChartId: string;
    try {
      reChartId = await resolveChartIdOrDefault(
        admin,
        reportingEntity.organization_id,
        chartIdParam,
      );
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 400 },
      );
    }

    const result = await buildConsolidatedStatements({
      admin,
      organizationId: reportingEntity.organization_id,
      chartId: reChartId,
      entityIds: memberEntityIds,
      buckets,
      allMonths,
      includeYoY,
      includeBudget,
      includeProForma,
      includeAllocations,
      includeFixedAssetSchedule,
      granularity,
      scope,
      startYear,
      startMonth,
      endYear,
      endMonth,
      fiscalYearStartMonth: reFiscalYearStartMonth,
    });

    return NextResponse.json({
      ...result,
      metadata: {
        reportingEntityName: reportingEntity.name,
        organizationName: org?.name ?? undefined,
        generatedAt: new Date().toISOString(),
        scope,
        granularity,
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

  return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
}
