// ---------------------------------------------------------------------------
// Fixed-Asset Activity schedule → cash-flow Investing reclassification.
//
// Reads hand-entered `fixed_asset_cf_entries` and aggregates them per period
// bucket so the cash-flow engine can decompose the "Other property & equipment
// activity, net" plug into labeled lines.  Each entry's stored `amount` is a
// positive magnitude; this module converts it to a signed CASH-BASIS amount
// (the −ΔNBV convention used by the Investing section):
//
//   cash_purchase     -> −|amount|  (asset acquired, cash/financing use)
//   disposal_proceeds -> +|amount|  (cash received on a disposal)
//   disposal_writeoff -> +|amount|  (non-cash NBV removal — a source, labeled)
//   reclass_transfer  ->  amount    (signed: + if assets decreased, − if added)
//
// These entries only reclassify cash-flow geography; the Investing TOTAL stays
// anchored to the GL carrying-value change, so the statement keeps articulating.
// ---------------------------------------------------------------------------

import type { PeriodBucket } from "@/lib/utils/dates";
import type { FixedAssetCfEntryType } from "@/components/financial-statements/types";

export interface ScheduleEntryDetail {
  entityId: string;
  entryType: FixedAssetCfEntryType;
  description: string;
  /** Signed cash-basis amount (see module header). */
  amount: number;
}

export interface ScheduleCashFlows {
  /** Cash capex (negative) keyed by bucket.key */
  cashPurchasesByBucket: Record<string, number>;
  /** Disposal proceeds (positive) keyed by bucket.key */
  disposalProceedsByBucket: Record<string, number>;
  /** Non-cash write-offs keyed by bucket.key */
  writeoffByBucket: Record<string, number>;
  /** Non-cash reclasses / transfers keyed by bucket.key */
  reclassByBucket: Record<string, number>;
  /** Per-entry detail keyed by bucket.key (for drill-down). */
  detailByBucket: Record<string, ScheduleEntryDetail[]>;
}

interface ScheduleRow {
  entity_id: string;
  period_year: number;
  period_month: number;
  entry_type: FixedAssetCfEntryType;
  amount: number | string | null;
  description: string | null;
}

const PAGE_SIZE = 1000;

/** Convert a stored magnitude + type into a signed cash-basis amount. */
export function scheduleCashBasis(type: FixedAssetCfEntryType, amount: number): number {
  const a = Number(amount) || 0;
  switch (type) {
    case "cash_purchase":
      return -Math.abs(a);
    case "disposal_proceeds":
      return Math.abs(a);
    case "disposal_writeoff":
      return Math.abs(a);
    case "reclass_transfer":
      return a; // signed as entered
    default:
      return 0;
  }
}

/**
 * Fetch and bucket active fixed-asset schedule entries for the given entities.
 * Returns zero-filled maps when there is no schedule data.
 */
export async function fetchScheduleCashFlows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  entityIds: string[],
  buckets: PeriodBucket[],
): Promise<ScheduleCashFlows> {
  const cashPurchasesByBucket: Record<string, number> = {};
  const disposalProceedsByBucket: Record<string, number> = {};
  const writeoffByBucket: Record<string, number> = {};
  const reclassByBucket: Record<string, number> = {};
  const detailByBucket: Record<string, ScheduleEntryDetail[]> = {};
  for (const b of buckets) {
    cashPurchasesByBucket[b.key] = 0;
    disposalProceedsByBucket[b.key] = 0;
    writeoffByBucket[b.key] = 0;
    reclassByBucket[b.key] = 0;
    detailByBucket[b.key] = [];
  }

  if (entityIds.length === 0 || buckets.length === 0) {
    return {
      cashPurchasesByBucket,
      disposalProceedsByBucket,
      writeoffByBucket,
      reclassByBucket,
      detailByBucket,
    };
  }

  // Which bucket keys does a {year, month} belong to? (mirrors asset-cash-flows)
  const bucketsForMonth = (year: number, month: number): string[] =>
    buckets
      .filter((b) => b.months.some((mm) => mm.year === year && mm.month === month))
      .map((b) => b.key);

  const years = [...new Set(buckets.flatMap((b) => b.months.map((m) => m.year)))];

  let offset = 0;
  for (;;) {
    const { data, error } = await admin
      .from("fixed_asset_cf_entries")
      .select("entity_id, period_year, period_month, entry_type, amount, description")
      .in("entity_id", entityIds)
      .in("period_year", years)
      .eq("is_excluded", false)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.warn("fetchScheduleCashFlows: query error", error);
      break;
    }
    const rows = (data ?? []) as ScheduleRow[];

    for (const row of rows) {
      const keys = bucketsForMonth(row.period_year, row.period_month);
      if (keys.length === 0) continue;
      const signed = scheduleCashBasis(row.entry_type, Number(row.amount ?? 0));
      if (signed === 0) continue;
      for (const k of keys) {
        switch (row.entry_type) {
          case "cash_purchase":
            cashPurchasesByBucket[k] += signed;
            break;
          case "disposal_proceeds":
            disposalProceedsByBucket[k] += signed;
            break;
          case "disposal_writeoff":
            writeoffByBucket[k] += signed;
            break;
          case "reclass_transfer":
            reclassByBucket[k] += signed;
            break;
        }
        detailByBucket[k].push({
          entityId: row.entity_id,
          entryType: row.entry_type,
          description: row.description ?? "",
          amount: signed,
        });
      }
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return {
    cashPurchasesByBucket,
    disposalProceedsByBucket,
    writeoffByBucket,
    reclassByBucket,
    detailByBucket,
  };
}
