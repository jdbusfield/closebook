// ---------------------------------------------------------------------------
// Fixed-asset cash flows for the statement of cash flows (Investing activities).
//
// Sources GROSS capital expenditures and GROSS disposal proceeds directly from
// the fixed-asset subledger (`fixed_assets`), rather than deriving them from the
// period change in net book value.  Under ASC 230-10-45-13, investing cash flows
// are presented gross: purchases of property & equipment (cash out) and proceeds
// from disposals (cash in) are shown separately.
//
//   • additions     = Σ acquisition_cost      where acquisition_date ∈ period
//   • disposals     = Σ disposed_sale_price    where disposed_date    ∈ period
//
// Results are bucketed to match the statement's period buckets (an asset acquired
// in a month contributes to that month's bucket and to any spanning "Total"
// bucket, mirroring how the other statement sections aggregate months).
// ---------------------------------------------------------------------------

import type { PeriodBucket } from "@/lib/utils/dates";

/** One subledger line behind a bucket's additions or disposals (for drill-down). */
export interface AssetCashFlowDetail {
  entityId: string;
  /** Asset name (with tag in parentheses when present). */
  assetName: string;
  /** "YYYY-MM-DD" event date (acquisition or disposal). */
  date: string;
  /** Signed cash amount: purchases negative (cash out), proceeds positive (cash in). */
  amount: number;
}

export interface AssetCashFlows {
  /** Gross capital expenditures (positive magnitude) keyed by bucket.key */
  additionsByBucket: Record<string, number>;
  /** Gross proceeds from disposals (positive magnitude) keyed by bucket.key */
  disposalProceedsByBucket: Record<string, number>;
  /** Per-asset acquisition detail behind each bucket's additions (amount = cash out, negative). */
  additionsDetailByBucket: Record<string, AssetCashFlowDetail[]>;
  /** Per-asset disposal detail behind each bucket's proceeds (amount = cash in, positive). */
  disposalsDetailByBucket: Record<string, AssetCashFlowDetail[]>;
}

interface FixedAssetRow {
  entity_id: string;
  asset_name: string | null;
  asset_tag: string | null;
  acquisition_date: string | null;
  acquisition_cost: number | string | null;
  disposed_date: string | null;
  disposed_sale_price: number | string | null;
}

const PAGE_SIZE = 1000;

/** Parse a "YYYY-MM-DD" (or ISO) date string into { year, month } (1-12). */
function ymOf(iso: string | null): { year: number; month: number } | null {
  if (!iso) return null;
  const [y, m] = iso.split("T")[0].split("-").map(Number);
  if (!y || !m) return null;
  return { year: y, month: m };
}

/**
 * Fetch gross additions and disposal proceeds per period bucket for the given
 * entities.  Returns zero-filled maps when there is no subledger data.
 */
export async function fetchAssetCashFlows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  entityIds: string[],
  buckets: PeriodBucket[],
): Promise<AssetCashFlows> {
  const additionsByBucket: Record<string, number> = {};
  const disposalProceedsByBucket: Record<string, number> = {};
  const additionsDetailByBucket: Record<string, AssetCashFlowDetail[]> = {};
  const disposalsDetailByBucket: Record<string, AssetCashFlowDetail[]> = {};
  for (const b of buckets) {
    additionsByBucket[b.key] = 0;
    disposalProceedsByBucket[b.key] = 0;
    additionsDetailByBucket[b.key] = [];
    disposalsDetailByBucket[b.key] = [];
  }

  if (entityIds.length === 0 || buckets.length === 0) {
    return {
      additionsByBucket,
      disposalProceedsByBucket,
      additionsDetailByBucket,
      disposalsDetailByBucket,
    };
  }

  // Date window spanning all requested buckets, used to limit the query.
  const allMonths = buckets.flatMap((b) => b.months);
  const minKey = allMonths.reduce(
    (acc, m) => Math.min(acc, m.year * 100 + m.month),
    Number.MAX_SAFE_INTEGER,
  );
  const maxKey = allMonths.reduce((acc, m) => Math.max(acc, m.year * 100 + m.month), 0);
  const minDate = `${Math.floor(minKey / 100)}-${String(minKey % 100).padStart(2, "0")}-01`;
  const maxY = Math.floor(maxKey / 100);
  const maxM = maxKey % 100;
  // Exclusive upper bound = first day of the month AFTER the last bucket month,
  // avoiding invalid day-of-month dates (e.g. "2026-04-31").
  const exY = maxM === 12 ? maxY + 1 : maxY;
  const exM = maxM === 12 ? 1 : maxM + 1;
  const maxDateExclusive = `${exY}-${String(exM).padStart(2, "0")}-01`;

  // Membership test: does any bucket month equal {year, month}? Returns matching keys.
  const bucketsForMonth = (ym: { year: number; month: number }): string[] =>
    buckets
      .filter((b) => b.months.some((mm) => mm.year === ym.year && mm.month === ym.month))
      .map((b) => b.key);

  let offset = 0;
  for (;;) {
    const { data, error } = await admin
      .from("fixed_assets")
      .select("entity_id, asset_name, asset_tag, acquisition_date, acquisition_cost, disposed_date, disposed_sale_price")
      .in("entity_id", entityIds)
      .or(
        `and(acquisition_date.gte.${minDate},acquisition_date.lt.${maxDateExclusive}),` +
          `and(disposed_date.gte.${minDate},disposed_date.lt.${maxDateExclusive})`,
      )
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.warn("fetchAssetCashFlows: query error", error);
      break;
    }
    const rows = (data ?? []) as FixedAssetRow[];

    for (const row of rows) {
      const label =
        (row.asset_name ?? "Asset") + (row.asset_tag ? ` (${row.asset_tag})` : "");
      const acq = ymOf(row.acquisition_date);
      if (acq) {
        const cost = Number(row.acquisition_cost ?? 0) || 0;
        if (cost !== 0)
          for (const k of bucketsForMonth(acq)) {
            additionsByBucket[k] += cost;
            additionsDetailByBucket[k].push({
              entityId: row.entity_id,
              assetName: label,
              date: (row.acquisition_date ?? "").split("T")[0],
              amount: -cost, // cash out
            });
          }
      }
      const disp = ymOf(row.disposed_date);
      if (disp) {
        const proceeds = Number(row.disposed_sale_price ?? 0) || 0;
        if (proceeds !== 0)
          for (const k of bucketsForMonth(disp)) {
            disposalProceedsByBucket[k] += proceeds;
            disposalsDetailByBucket[k].push({
              entityId: row.entity_id,
              assetName: label,
              date: (row.disposed_date ?? "").split("T")[0],
              amount: proceeds, // cash in
            });
          }
      }
    }

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return {
    additionsByBucket,
    disposalProceedsByBucket,
    additionsDetailByBucket,
    disposalsDetailByBucket,
  };
}
