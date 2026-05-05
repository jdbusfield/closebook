// Types for the accountant ↔ management financial-statement bridge.
//
// The bridge walks each line of the "from" statement to the matched line(s)
// on the "to" statement, attributing the difference to one of seven named
// reconciling categories plus a residual.

import type { LineItem, Period, StatementData } from "@/components/financial-statements/types";

export type BridgeStatement = "BS" | "PL";
export type BridgeDirection = "acc-to-mgt" | "mgt-to-acc";

export interface BridgeRequest {
  organizationId: string;
  statement: BridgeStatement;
  direction: BridgeDirection;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: "monthly" | "quarterly" | "yearly";
  /**
   * When set, scope both charts to a reporting entity (e.g., "Avon
   * Combined" = AVON + NCNT + 2F). The accountant view is typically only
   * meaningful at this scope, so the bridge supports it directly.
   */
  reportingEntityId?: string;
}

/**
 * Per-period delta amounts for a single bridge category.
 * Keyed by Period.key.
 */
export type BridgeAmounts = Record<string, number>;

export interface BridgeCategoryDeltas {
  /** Pro forma adjustment overlay on the to-chart (or removed from the from-chart) */
  proForma: BridgeAmounts;
  /** Allocation adjustment overlay */
  allocation: BridgeAmounts;
  /** Year-end adjustment differences between charts */
  yearEnd: BridgeAmounts;
  /** Intercompany elimination differences between charts */
  icElim: BridgeAmounts;
  /** Net Income presentation difference (per-entity equity vs standalone NI line) */
  niPresentation: BridgeAmounts;
  /** Catch-all for line categorization, aggregation, and rounding residuals */
  mapping: BridgeAmounts;
}

/**
 * One row of the bridge schedule. Either side may be null for unmatched
 * lines (which surface inline rather than in a separate panel).
 */
export interface BridgeRow {
  id: string;
  /** Display label – the line name on the "from" side, or "to" side if unmatched */
  label: string;
  /** Major bucket: "Assets" | "Liabilities" | "Equity" | "Revenue" | "Expense" */
  group: string;
  /** From-side line, if any */
  fromLine: LineItem | null;
  /** To-side line, if any */
  toLine: LineItem | null;
  /** Per-period from-side amounts (display sign) */
  fromAmounts: BridgeAmounts;
  /** Per-period to-side amounts (display sign) */
  toAmounts: BridgeAmounts;
  /** Category-level deltas explaining (toAmounts − fromAmounts) */
  deltas: BridgeCategoryDeltas;
  /** Sub-rows (tier 2 = master accounts that compose the from/to lines) */
  tier2?: BridgeTier2Row[];
  /** Whether this row is a header (not a real line) */
  isHeader?: boolean;
}

/**
 * Tier 2 sub-row — a master account that contributes to a bridge row.
 * Each tier-2 row knows which side of the bridge it lives on (from / to /
 * both) since accounts often only exist on one chart.
 */
export interface BridgeTier2Row {
  id: string;
  /** Master account ID */
  masterId: string;
  /** Display label, typically `${number} - ${name}` */
  label: string;
  /** "from" | "to" | "both" — which chart(s) this master appears on */
  side: "from" | "to" | "both";
  /** Per-period from-side raw aggregation (no adjustments) */
  fromRaw: BridgeAmounts;
  /** Per-period to-side raw aggregation (no adjustments) */
  toRaw: BridgeAmounts;
  /** Per-period adjustment deltas attributable to this master */
  deltas: BridgeCategoryDeltas;
}

/**
 * Tier 3 sub-row — a single GL account (entity-level account_id) that
 * maps to a master account. Returned lazily by a separate endpoint, not
 * embedded in the main bridge response.
 */
export interface BridgeTier3Row {
  id: string;
  glAccountId: string;
  entityId: string;
  entityCode: string;
  entityName: string;
  accountName: string;
  accountNumber: string | null;
  /** Per-period contribution of this GL account to the master's amount */
  amounts: BridgeAmounts;
}

export interface BridgeResponse {
  statement: BridgeStatement;
  direction: BridgeDirection;
  periods: Period[];
  /** Full statement data on the "from" side (so the UI can render it side-by-side) */
  fromStatement: StatementData;
  /** Full statement data on the "to" side */
  toStatement: StatementData;
  /** Display name for the "from" chart */
  fromChartName: string;
  /** Display name for the "to" chart */
  toChartName: string;
  /** Bridge schedule rows in render order, including unmatched */
  rows: BridgeRow[];
  /** Statement-total bridge (sum of all rows) */
  totalBridge: BridgeRow;
  metadata: {
    organizationName?: string;
    generatedAt: string;
    startPeriod: string;
    endPeriod: string;
  };
}

/** Empty per-period amounts builder. */
export function emptyAmounts(periodKeys: string[]): BridgeAmounts {
  const out: BridgeAmounts = {};
  for (const k of periodKeys) out[k] = 0;
  return out;
}

/** Empty deltas builder. */
export function emptyDeltas(periodKeys: string[]): BridgeCategoryDeltas {
  return {
    proForma: emptyAmounts(periodKeys),
    allocation: emptyAmounts(periodKeys),
    yearEnd: emptyAmounts(periodKeys),
    icElim: emptyAmounts(periodKeys),
    niPresentation: emptyAmounts(periodKeys),
    mapping: emptyAmounts(periodKeys),
  };
}

/** Sum two BridgeAmounts in place into the first. */
export function addInto(target: BridgeAmounts, src: BridgeAmounts): void {
  for (const k of Object.keys(src)) {
    target[k] = (target[k] ?? 0) + (src[k] ?? 0);
  }
}

/** Sum all categories of deltas for a period to derive the explained delta. */
export function totalExplainedDelta(deltas: BridgeCategoryDeltas, periodKey: string): number {
  return (
    (deltas.proForma[periodKey] ?? 0) +
    (deltas.allocation[periodKey] ?? 0) +
    (deltas.yearEnd[periodKey] ?? 0) +
    (deltas.icElim[periodKey] ?? 0) +
    (deltas.niPresentation[periodKey] ?? 0) +
    (deltas.mapping[periodKey] ?? 0)
  );
}
