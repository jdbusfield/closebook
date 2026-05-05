// Bridge engine — pulls statements + adjustments for both charts and emits
// a per-line reconciliation between them.

import type { LineItem, Period, StatementData } from "@/components/financial-statements/types";
import {
  type BridgeAmounts,
  type BridgeRow,
  emptyAmounts,
  emptyDeltas,
  totalExplainedDelta,
} from "./bridge-types";
import { indexStatement, linkLines, type IndexedLine } from "./bridge-line-linker";

// ---------------------------------------------------------------------------
// Inputs collected from the database / FS API
// ---------------------------------------------------------------------------

export interface MasterAccountRow {
  id: string;
  name: string;
  classification: string;
  account_type: string;
  account_number: string | null;
  parent_account_id: string | null;
  is_intercompany: boolean | null;
}

export interface ProFormaRow {
  master_account_id: string;
  offset_master_account_id: string | null;
  amount: number;
  period_year: number;
  period_month: number;
}

export interface AllocationEntryRow {
  /** Resolved master_account_id (could be source or destination) */
  master_account_id: string;
  amount: number;
  period_year: number;
  period_month: number;
}

export interface YearAdjRow {
  master_account_id: string;
  period_year: number;
  amount: number;
  offset_to_ic_net?: boolean | null;
  entity_id?: string | null;
}

export interface ChartContext {
  chartId: string;
  chartKind: "management" | "accountant";
  chartName: string;
  statement: StatementData;
  masters: MasterAccountRow[];
  proForma: ProFormaRow[];
  allocations: AllocationEntryRow[];
  yearEnd: YearAdjRow[];
}

export interface PeriodBucketLite {
  key: string;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  isTotal?: boolean;
}

// ---------------------------------------------------------------------------
// Master-account → root master walking
// ---------------------------------------------------------------------------

/**
 * Build a map from master_account_id → root master_account_id by walking
 * parent_account_id. The root is the master that appears as a display line
 * after applyParentRollup.
 */
function buildMasterToRoot(masters: MasterAccountRow[]): Map<string, string> {
  const byId = new Map(masters.map((m) => [m.id, m]));
  const memo = new Map<string, string>();

  function walk(id: string, seen: Set<string>): string {
    if (memo.has(id)) return memo.get(id)!;
    if (seen.has(id)) return id; // cycle — treat self as root
    seen.add(id);
    const m = byId.get(id);
    if (!m || !m.parent_account_id) {
      memo.set(id, id);
      return id;
    }
    const rootId = walk(m.parent_account_id, seen);
    memo.set(id, rootId);
    return rootId;
  }

  for (const m of masters) walk(m.id, new Set());
  return memo;
}

/**
 * Build a map from root master_account_id → the LineItem that displays it.
 * Walks the statement's drillDownMeta.masterAccountIds.
 */
function buildRootToLine(stmt: StatementData): Map<string, LineItem> {
  const out = new Map<string, LineItem>();
  for (const section of stmt.sections) {
    for (const line of section.lines) {
      const ids = line.drillDownMeta?.masterAccountIds ?? [];
      for (const id of ids) {
        out.set(id, line);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Period-bucket helpers — locate which bucket a (year, month) falls into
// ---------------------------------------------------------------------------

function findBucketForMonth(
  periods: PeriodBucketLite[],
  year: number,
  month: number,
): string | null {
  for (const p of periods) {
    if (p.isTotal) continue;
    const startKey = p.startYear * 12 + (p.startMonth - 1);
    const endKey = p.endYear * 12 + (p.endMonth - 1);
    const k = year * 12 + (month - 1);
    if (k >= startKey && k <= endKey) return p.key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-line adjustment overlays (line-level attribution)
// ---------------------------------------------------------------------------

/**
 * Aggregate adjustments to the per-line level on a chart. Returns:
 *   Map<lineId, BridgeAmounts>
 *
 * For pro forma and allocation, we use the same bucket-allocation rules as
 * the underlying pipeline (period_year / period_month → bucket).
 *
 * For year-end adjustments, the period is always Dec of the year.
 *
 * Display sign convention: adjustments stored in GL sign get flipped for
 * Revenue/Liability/Equity classifications when surfaced in the bridge so
 * the math matches the displayed statement values.
 */
function aggregateAdjustmentsByLine(
  rows: Array<{ master_account_id: string; amount: number; period_year: number; period_month: number }>,
  masterToRoot: Map<string, string>,
  rootToLine: Map<string, LineItem>,
  classificationByMaster: Map<string, string>,
  periods: PeriodBucketLite[],
  periodKeys: string[],
): Map<string, BridgeAmounts> {
  const out = new Map<string, BridgeAmounts>();
  for (const r of rows) {
    const root = masterToRoot.get(r.master_account_id) ?? r.master_account_id;
    const line = rootToLine.get(root);
    if (!line) continue;
    const bucketKey = findBucketForMonth(periods, r.period_year, r.period_month);
    if (!bucketKey) continue;
    if (!out.has(line.id)) out.set(line.id, emptyAmounts(periodKeys));
    const cls = classificationByMaster.get(r.master_account_id) ?? "";
    const sign = isCreditNormal(cls) ? -1 : 1;
    out.get(line.id)![bucketKey] += sign * r.amount;
  }
  return out;
}

function isCreditNormal(classification: string): boolean {
  return classification === "Revenue" || classification === "Liability" || classification === "Equity";
}

// ---------------------------------------------------------------------------
// Display-amount extraction
// ---------------------------------------------------------------------------

function lineAmounts(line: LineItem | null, periodKeys: string[]): BridgeAmounts {
  const out = emptyAmounts(periodKeys);
  if (!line) return out;
  for (const k of periodKeys) {
    out[k] = line.amounts[k] ?? 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Engine entry point
// ---------------------------------------------------------------------------

export interface ComputeBridgeArgs {
  fromCtx: ChartContext;
  toCtx: ChartContext;
  periods: Period[];
  periodBuckets: PeriodBucketLite[];
}

export interface ComputedBridge {
  rows: BridgeRow[];
  totalBridge: BridgeRow;
}

export function computeBridge({
  fromCtx,
  toCtx,
  periods,
  periodBuckets,
}: ComputeBridgeArgs): ComputedBridge {
  const periodKeys = periods.map((p) => p.key);

  const fromIndex = indexStatement(fromCtx.statement);
  const toIndex = indexStatement(toCtx.statement);
  const pairs = linkLines(fromIndex, toIndex);

  const fromMasterToRoot = buildMasterToRoot(fromCtx.masters);
  const toMasterToRoot = buildMasterToRoot(toCtx.masters);
  const fromRootToLine = buildRootToLine(fromCtx.statement);
  const toRootToLine = buildRootToLine(toCtx.statement);
  const fromClsByMaster = new Map(fromCtx.masters.map((m) => [m.id, m.classification]));
  const toClsByMaster = new Map(toCtx.masters.map((m) => [m.id, m.classification]));

  // Per-line adjustment overlays.
  // The bridge is direction-aware: a category that is "introduced" going
  // from-→to adds to (toAmounts − fromAmounts); a category that is
  // "removed" going from-→to subtracts.
  //
  // Pro forma & allocations exist on management only by current convention.
  // If from = ACC, going to MGT INTRODUCES them (+).
  // If from = MGT, going to ACC REMOVES them (−).
  const toProFormaByLine = aggregateAdjustmentsByLine(
    toCtx.proForma.map((p) => ({
      master_account_id: p.master_account_id,
      amount: p.amount,
      period_year: p.period_year,
      period_month: p.period_month,
    })),
    toMasterToRoot,
    toRootToLine,
    toClsByMaster,
    periodBuckets,
    periodKeys,
  );

  const fromProFormaByLine = aggregateAdjustmentsByLine(
    fromCtx.proForma.map((p) => ({
      master_account_id: p.master_account_id,
      amount: p.amount,
      period_year: p.period_year,
      period_month: p.period_month,
    })),
    fromMasterToRoot,
    fromRootToLine,
    fromClsByMaster,
    periodBuckets,
    periodKeys,
  );

  const toAllocationsByLine = aggregateAdjustmentsByLine(
    toCtx.allocations.map((a) => ({
      master_account_id: a.master_account_id,
      amount: a.amount,
      period_year: a.period_year,
      period_month: a.period_month,
    })),
    toMasterToRoot,
    toRootToLine,
    toClsByMaster,
    periodBuckets,
    periodKeys,
  );

  const fromAllocationsByLine = aggregateAdjustmentsByLine(
    fromCtx.allocations.map((a) => ({
      master_account_id: a.master_account_id,
      amount: a.amount,
      period_year: a.period_year,
      period_month: a.period_month,
    })),
    fromMasterToRoot,
    fromRootToLine,
    fromClsByMaster,
    periodBuckets,
    periodKeys,
  );

  const toYearEndByLine = aggregateAdjustmentsByLine(
    toCtx.yearEnd.map((y) => ({
      master_account_id: y.master_account_id,
      amount: y.amount,
      period_year: y.period_year,
      period_month: 12,
    })),
    toMasterToRoot,
    toRootToLine,
    toClsByMaster,
    periodBuckets,
    periodKeys,
  );

  const fromYearEndByLine = aggregateAdjustmentsByLine(
    fromCtx.yearEnd.map((y) => ({
      master_account_id: y.master_account_id,
      amount: y.amount,
      period_year: y.period_year,
      period_month: 12,
    })),
    fromMasterToRoot,
    fromRootToLine,
    fromClsByMaster,
    periodBuckets,
    periodKeys,
  );

  const rows: BridgeRow[] = [];
  for (const p of pairs) {
    const fromIL = p.fromIdx !== null ? fromIndex[p.fromIdx] : null;
    const toIL = p.toIdx !== null ? toIndex[p.toIdx] : null;

    const fromLine = fromIL?.line ?? null;
    const toLine = toIL?.line ?? null;

    if (fromLine?.isHeader || toLine?.isHeader) continue;

    const fromAmounts = lineAmounts(fromLine, periodKeys);
    const toAmounts = lineAmounts(toLine, periodKeys);

    const deltas = emptyDeltas(periodKeys);

    // Pro forma: introduced going from-→to (so add to-side, subtract from-side)
    if (toLine) addAmountsByLine(deltas.proForma, toProFormaByLine.get(toLine.id), 1);
    if (fromLine) addAmountsByLine(deltas.proForma, fromProFormaByLine.get(fromLine.id), -1);

    // Allocations: same convention
    if (toLine) addAmountsByLine(deltas.allocation, toAllocationsByLine.get(toLine.id), 1);
    if (fromLine) addAmountsByLine(deltas.allocation, fromAllocationsByLine.get(fromLine.id), -1);

    // Year-end: chart-scoped — both charts may have entries; net = to − from
    if (toLine) addAmountsByLine(deltas.yearEnd, toYearEndByLine.get(toLine.id), 1);
    if (fromLine) addAmountsByLine(deltas.yearEnd, fromYearEndByLine.get(fromLine.id), -1);

    // IC elimination & NI presentation: detected by line label matching.
    // Both charts run their own IC eliminations, so the residual is captured
    // in the mapping bucket unless we can attribute it specifically.
    const isICLine =
      (fromLine?.label ?? "").toLowerCase().includes("intercompany") ||
      (toLine?.label ?? "").toLowerCase().includes("intercompany");
    if (isICLine) {
      // Move the residual into the IC bucket — that's the most honest
      // attribution we can make at the line level.
      for (const k of periodKeys) {
        const explainedSoFar = totalExplainedDelta(deltas, k);
        const total = (toAmounts[k] ?? 0) - (fromAmounts[k] ?? 0);
        deltas.icElim[k] += total - explainedSoFar;
      }
    }

    // NI presentation: lines that contain "net income" or "accumulated"
    // (deficit/equity) on either side.
    const isNILine =
      (fromLine?.label ?? "").toLowerCase().match(/net income|accumulated|retained/) ||
      (toLine?.label ?? "").toLowerCase().match(/net income|accumulated|retained/);
    if (isNILine && !isICLine) {
      for (const k of periodKeys) {
        const explainedSoFar = totalExplainedDelta(deltas, k);
        const total = (toAmounts[k] ?? 0) - (fromAmounts[k] ?? 0);
        deltas.niPresentation[k] += total - explainedSoFar;
      }
    }

    // Mapping = residual after named categories.
    if (!isICLine && !isNILine) {
      for (const k of periodKeys) {
        const explainedSoFar = totalExplainedDelta(deltas, k);
        const total = (toAmounts[k] ?? 0) - (fromAmounts[k] ?? 0);
        const residual = total - explainedSoFar;
        if (Math.abs(residual) >= 0.005) deltas.mapping[k] += residual;
      }
    }

    const label =
      fromLine?.label ?? toLine?.label ?? "(unknown)";
    const group = (fromIL ?? toIL)!.group;

    rows.push({
      id: `bridge_${rows.length}`,
      label,
      group,
      fromLine,
      toLine,
      fromAmounts,
      toAmounts,
      deltas,
    });
  }

  // Statement-total bridge
  const totalFrom = emptyAmounts(periodKeys);
  const totalTo = emptyAmounts(periodKeys);
  const totalDeltas = emptyDeltas(periodKeys);

  for (const r of rows) {
    // Skip subtotal/grand-total rows from the totals so we don't double-count
    if (r.fromLine?.isTotal || r.fromLine?.isGrandTotal) continue;
    if (!r.fromLine && (r.toLine?.isTotal || r.toLine?.isGrandTotal)) continue;
    for (const k of periodKeys) {
      totalFrom[k] += r.fromAmounts[k] ?? 0;
      totalTo[k] += r.toAmounts[k] ?? 0;
      totalDeltas.proForma[k] += r.deltas.proForma[k] ?? 0;
      totalDeltas.allocation[k] += r.deltas.allocation[k] ?? 0;
      totalDeltas.yearEnd[k] += r.deltas.yearEnd[k] ?? 0;
      totalDeltas.icElim[k] += r.deltas.icElim[k] ?? 0;
      totalDeltas.niPresentation[k] += r.deltas.niPresentation[k] ?? 0;
      totalDeltas.mapping[k] += r.deltas.mapping[k] ?? 0;
    }
  }

  const totalBridge: BridgeRow = {
    id: "bridge_total",
    label: "Bridge Total",
    group: "Total",
    fromLine: null,
    toLine: null,
    fromAmounts: totalFrom,
    toAmounts: totalTo,
    deltas: totalDeltas,
  };

  return { rows, totalBridge };
}

function addAmountsByLine(
  target: BridgeAmounts,
  src: BridgeAmounts | undefined,
  sign: number,
): void {
  if (!src) return;
  for (const k of Object.keys(src)) {
    target[k] = (target[k] ?? 0) + sign * src[k];
  }
}

// Re-exports used by callers
export type { IndexedLine };
