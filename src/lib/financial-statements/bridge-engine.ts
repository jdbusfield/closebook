// Bridge engine — pulls statements + adjustments for both charts and emits
// a per-line reconciliation between them.

import type { LineItem, Period, StatementData } from "@/components/financial-statements/types";
import {
  type BridgeAmounts,
  type BridgeCategoryDeltas,
  type BridgeRow,
  type BridgeTier2Row,
  emptyAmounts,
  emptyDeltas,
  totalExplainedDelta,
} from "./bridge-types";
import { indexStatement, linkLines, type IndexedLine, type ExplicitLink } from "./bridge-line-linker";

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
interface LineLevelAggregation {
  /** Per-line totals */
  byLine: Map<string, BridgeAmounts>;
  /** Per (lineId, masterId) totals — used for tier-2 attribution */
  byLineMaster: Map<string, Map<string, BridgeAmounts>>;
}

function aggregateAdjustmentsByLine(
  rows: Array<{ master_account_id: string; amount: number; period_year: number; period_month: number }>,
  masterToRoot: Map<string, string>,
  rootToLine: Map<string, LineItem>,
  classificationByMaster: Map<string, string>,
  periods: PeriodBucketLite[],
  periodKeys: string[],
): LineLevelAggregation {
  const byLine = new Map<string, BridgeAmounts>();
  const byLineMaster = new Map<string, Map<string, BridgeAmounts>>();
  for (const r of rows) {
    const root = masterToRoot.get(r.master_account_id) ?? r.master_account_id;
    const line = rootToLine.get(root);
    if (!line) continue;
    const bucketKey = findBucketForMonth(periods, r.period_year, r.period_month);
    if (!bucketKey) continue;
    const cls = classificationByMaster.get(r.master_account_id) ?? "";
    const sign = isCreditNormal(cls) ? -1 : 1;
    const signed = sign * r.amount;

    if (!byLine.has(line.id)) byLine.set(line.id, emptyAmounts(periodKeys));
    byLine.get(line.id)![bucketKey] += signed;

    if (!byLineMaster.has(line.id)) byLineMaster.set(line.id, new Map());
    const masterMap = byLineMaster.get(line.id)!;
    if (!masterMap.has(r.master_account_id)) masterMap.set(r.master_account_id, emptyAmounts(periodKeys));
    masterMap.get(r.master_account_id)![bucketKey] += signed;
  }
  return { byLine, byLineMaster };
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

export interface BridgeLinkRow {
  accountantMasterId: string;
  managementMasterId: string;
}

export interface ComputeBridgeArgs {
  fromCtx: ChartContext;
  toCtx: ChartContext;
  periods: Period[];
  periodBuckets: PeriodBucketLite[];
  /** Explicit cross-chart line links — overrides heuristic when present. */
  bridgeLinks?: BridgeLinkRow[];
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
  bridgeLinks,
}: ComputeBridgeArgs): ComputedBridge {
  const periodKeys = periods.map((p) => p.key);

  const fromIndex = indexStatement(fromCtx.statement);
  const toIndex = indexStatement(toCtx.statement);

  // Translate accountant/management explicit links into from-→to direction
  // for the linker. The bridgeLinks rows are stored as
  // (accountantMasterId, managementMasterId); whichever side the user
  // chose for "from" determines which master ID becomes the from key.
  const explicit: ExplicitLink[] = (bridgeLinks ?? []).map((l) =>
    fromCtx.chartKind === "accountant"
      ? { fromMasterId: l.accountantMasterId, toMasterId: l.managementMasterId }
      : { fromMasterId: l.managementMasterId, toMasterId: l.accountantMasterId },
  );

  const pairs = linkLines(fromIndex, toIndex, explicit);

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
  const toProForma = aggregateAdjustmentsByLine(
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

  const fromProForma = aggregateAdjustmentsByLine(
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

  const toAllocations = aggregateAdjustmentsByLine(
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

  const fromAllocations = aggregateAdjustmentsByLine(
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

  const toYearEnd = aggregateAdjustmentsByLine(
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

  const fromYearEnd = aggregateAdjustmentsByLine(
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

  // Build a "what masters are under each line" map per chart, walking
  // parent_account_id chains in the master list and matching against
  // rootToLine. Lets tier-2 enumerate masters even when no adjustment
  // touched them.
  const fromMastersByLine = mastersByLine(fromCtx.masters, fromMasterToRoot, fromRootToLine);
  const toMastersByLine = mastersByLine(toCtx.masters, toMasterToRoot, toRootToLine);

  const fromMasterById = new Map(fromCtx.masters.map((m) => [m.id, m]));
  const toMasterById = new Map(toCtx.masters.map((m) => [m.id, m]));

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
    if (toLine) addAmountsByLine(deltas.proForma, toProForma.byLine.get(toLine.id), 1);
    if (fromLine) addAmountsByLine(deltas.proForma, fromProForma.byLine.get(fromLine.id), -1);

    // Allocations: same convention
    if (toLine) addAmountsByLine(deltas.allocation, toAllocations.byLine.get(toLine.id), 1);
    if (fromLine) addAmountsByLine(deltas.allocation, fromAllocations.byLine.get(fromLine.id), -1);

    // Year-end: chart-scoped — both charts may have entries; net = to − from
    if (toLine) addAmountsByLine(deltas.yearEnd, toYearEnd.byLine.get(toLine.id), 1);
    if (fromLine) addAmountsByLine(deltas.yearEnd, fromYearEnd.byLine.get(fromLine.id), -1);

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

    const tier2 = buildTier2({
      fromLine,
      toLine,
      fromMastersByLine,
      toMastersByLine,
      fromMasterById,
      toMasterById,
      proForma: { from: fromProForma, to: toProForma },
      allocations: { from: fromAllocations, to: toAllocations },
      yearEnd: { from: fromYearEnd, to: toYearEnd },
      periodKeys,
    });

    rows.push({
      id: `bridge_${rows.length}`,
      label,
      group,
      fromLine,
      toLine,
      fromAmounts,
      toAmounts,
      deltas,
      tier2,
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

/**
 * Build a Map<lineId, masterIds[]> by walking each master to its root and
 * looking up which line displays that root. Lets tier 2 enumerate all
 * masters under a line, not just the ones that received an adjustment.
 */
function mastersByLine(
  masters: { id: string }[],
  masterToRoot: Map<string, string>,
  rootToLine: Map<string, LineItem>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of masters) {
    const root = masterToRoot.get(m.id) ?? m.id;
    const line = rootToLine.get(root);
    if (!line) continue;
    if (!out.has(line.id)) out.set(line.id, []);
    out.get(line.id)!.push(m.id);
  }
  return out;
}

interface BuildTier2Args {
  fromLine: LineItem | null;
  toLine: LineItem | null;
  fromMastersByLine: Map<string, string[]>;
  toMastersByLine: Map<string, string[]>;
  fromMasterById: Map<string, MasterAccountRow>;
  toMasterById: Map<string, MasterAccountRow>;
  proForma: { from: LineLevelAggregation; to: LineLevelAggregation };
  allocations: { from: LineLevelAggregation; to: LineLevelAggregation };
  yearEnd: { from: LineLevelAggregation; to: LineLevelAggregation };
  periodKeys: string[];
}

/**
 * For a linked pair (or unmatched line), produce one tier-2 row per
 * master account that contributes to either side. A master might appear
 * on the from-chart only, the to-chart only, or both.
 *
 * Per-master adjustment deltas are looked up from the
 * (lineId → masterId → BridgeAmounts) maps already produced by
 * aggregateAdjustmentsByLine.
 */
function buildTier2(args: BuildTier2Args): BridgeTier2Row[] {
  const {
    fromLine, toLine,
    fromMastersByLine, toMastersByLine,
    fromMasterById, toMasterById,
    proForma, allocations, yearEnd,
    periodKeys,
  } = args;

  const fromMasterIds = fromLine ? (fromMastersByLine.get(fromLine.id) ?? []) : [];
  const toMasterIds = toLine ? (toMastersByLine.get(toLine.id) ?? []) : [];

  // Build a unified set of (chartSide, masterId) → master ref. Names
  // sometimes match across charts (same chart of accounts seed); when they
  // do, collapse into a single tier-2 row labelled "both".
  type Combined = {
    masterId: string;
    name: string;
    accountNumber: string | null;
    side: "from" | "to" | "both";
  };
  const combined: Map<string, Combined> = new Map();

  for (const id of fromMasterIds) {
    const m = fromMasterById.get(id);
    if (!m) continue;
    const key = nameKey(m);
    const existing = combined.get(key);
    if (existing) {
      existing.side = "both";
    } else {
      combined.set(key, { masterId: id, name: m.name, accountNumber: m.account_number, side: "from" });
    }
  }
  for (const id of toMasterIds) {
    const m = toMasterById.get(id);
    if (!m) continue;
    const key = nameKey(m);
    const existing = combined.get(key);
    if (existing) {
      existing.side = "both";
      // Prefer to-side master ID for adjustment lookups when collapsed
      existing.masterId = id;
    } else {
      combined.set(key, { masterId: id, name: m.name, accountNumber: m.account_number, side: "to" });
    }
  }

  const out: BridgeTier2Row[] = [];

  for (const [, c] of combined) {
    const deltas: BridgeCategoryDeltas = emptyDeltas(periodKeys);

    // Sign convention same as line-level: introduced going to-side (+),
    // removed going from-side (−).
    if (toLine) {
      addByMaster(deltas.proForma, proForma.to.byLineMaster.get(toLine.id), c, 1);
      addByMaster(deltas.allocation, allocations.to.byLineMaster.get(toLine.id), c, 1);
      addByMaster(deltas.yearEnd, yearEnd.to.byLineMaster.get(toLine.id), c, 1);
    }
    if (fromLine) {
      addByMaster(deltas.proForma, proForma.from.byLineMaster.get(fromLine.id), c, -1);
      addByMaster(deltas.allocation, allocations.from.byLineMaster.get(fromLine.id), c, -1);
      addByMaster(deltas.yearEnd, yearEnd.from.byLineMaster.get(fromLine.id), c, -1);
    }

    out.push({
      id: `t2_${c.masterId}`,
      masterId: c.masterId,
      label: c.accountNumber ? `${c.accountNumber} — ${c.name}` : c.name,
      side: c.side,
      // Raw amounts left empty for v1 — populated when the lazy GL endpoint
      // is wired in. Keeping the shape stable so the UI doesn't need to
      // change.
      fromRaw: emptyAmounts(periodKeys),
      toRaw: emptyAmounts(periodKeys),
      deltas,
    });
  }

  // Sort: matched-on-both first, then by label
  out.sort((a, b) => {
    const sideRank = (s: string) => (s === "both" ? 0 : s === "from" ? 1 : 2);
    const sr = sideRank(a.side) - sideRank(b.side);
    if (sr !== 0) return sr;
    return a.label.localeCompare(b.label);
  });

  return out;
}

function nameKey(m: MasterAccountRow): string {
  return `${(m.account_number ?? "").trim()}|${m.name.trim().toLowerCase()}`;
}

function addByMaster(
  target: BridgeAmounts,
  src: Map<string, BridgeAmounts> | undefined,
  combined: { masterId: string; side: "from" | "to" | "both" },
  sign: number,
): void {
  if (!src) return;
  // For "both" rows we don't know which sub-side the adjustment came from;
  // try the masterId we recorded. If absent, no contribution from this side.
  const amounts = src.get(combined.masterId);
  if (!amounts) return;
  for (const k of Object.keys(amounts)) {
    target[k] = (target[k] ?? 0) + sign * amounts[k];
  }
}

// Re-exports used by callers
export type { IndexedLine };
