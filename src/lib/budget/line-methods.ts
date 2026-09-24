/**
 * Line methods: how one named item under a budget line gets its twelve
 * months. JD budgets at the master-account level of the Financial Model,
 * and under each master writes items that say why the number is what it is
 * ("Software: trailing twelve months plus 5%", "Audit fee: $48,000 in
 * March"). Each item carries one of these methods; the amounts are derived
 * from it, so a recompute can refresh them when actuals or other lines move.
 *
 * Pure: no database. The caller supplies the history the method needs.
 */

export type MethodKind =
  | "flat" // the same amount every month, optionally for part of the year
  | "annual" // one yearly figure spread evenly or by last year's shape
  | "prior_year" // last year's months, each moved by a percent
  | "run_rate" // trailing run rate shaped by seasonality, moved by a percent
  | "pct_of_line" // a percent of another budgeted line, month by month
  | "one_time" // one amount in one month
  | "months"; // twelve typed amounts

/** Where a history-based method reads its actuals from. */
export interface MethodSource {
  /** Specific entity accounts under the master (from "Break out by account"); absent = the whole master */
  account_ids?: string[];
}

export interface LineMethod extends MethodSource {
  kind: MethodKind;
  /** flat: per month; annual: for the year; one_time: the amount */
  amount?: number;
  /** prior_year, run_rate: change from history; pct_of_line: share of the source line */
  pct?: number;
  /** flat, annual, prior_year, run_rate: months in force (1-12, inclusive); default whole year */
  start_month?: number;
  end_month?: number;
  /** one_time */
  month?: number;
  /** annual: "even" or "shape" (last year's shape) */
  spread?: "even" | "shape";
  /** run_rate: which history to annualize */
  basis?: "trailing_12" | "trailing_3";
  /** pct_of_line: the master account whose budget this follows */
  source_master_id?: string;
  /** months */
  months?: number[];
}

/** History for one item's source: the master or its chosen accounts. */
export interface MethodHistory {
  /** Last fiscal year's twelve months, January first */
  priorYear: number[];
  /** Sum of the last twelve months of actuals */
  trailing12: number;
  /** Last three months, annualized */
  trailing3Annualized: number;
  /** Twelve seasonality factors averaging one */
  seasonality: number[];
  /** Whether the last twelve months were all booked */
  hasFullYear: boolean;
}

export interface MethodContext {
  history: MethodHistory;
  /** Budgeted months of other lines, by master id, for pct_of_line */
  lineTotals?: Map<string, number[]>;
}

const ZERO = () => new Array(12).fill(0) as number[];

function inRange(m: LineMethod, i: number): boolean {
  const start = Math.min(12, Math.max(1, Math.round(m.start_month ?? 1)));
  const end = Math.min(12, Math.max(start, Math.round(m.end_month ?? 12)));
  return i + 1 >= start && i + 1 <= end;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Twelve months for an item, January first. */
export function evaluateMethod(m: LineMethod, ctx: MethodContext): number[] {
  const out = ZERO();
  const h = ctx.history;
  switch (m.kind) {
    case "flat": {
      const amt = Number(m.amount ?? 0);
      for (let i = 0; i < 12; i++) if (inRange(m, i)) out[i] = amt;
      break;
    }
    case "annual": {
      const total = Number(m.amount ?? 0);
      const active = Array.from({ length: 12 }, (_, i) => inRange(m, i));
      const n = active.filter(Boolean).length || 1;
      const shapeTotal = h.priorYear.reduce((t, v, i) => (active[i] ? t + v : t), 0);
      const useShape = m.spread === "shape" && shapeTotal > 0;
      for (let i = 0; i < 12; i++) {
        if (!active[i]) continue;
        out[i] = useShape ? (total * h.priorYear[i]) / shapeTotal : total / n;
      }
      break;
    }
    case "prior_year": {
      const f = 1 + Number(m.pct ?? 0) / 100;
      for (let i = 0; i < 12; i++) if (inRange(m, i)) out[i] = (h.priorYear[i] ?? 0) * f;
      break;
    }
    case "run_rate": {
      const f = 1 + Number(m.pct ?? 0) / 100;
      const basis = m.basis ?? (h.hasFullYear ? "trailing_12" : "trailing_3");
      const base = basis === "trailing_12" ? h.trailing12 : h.trailing3Annualized;
      for (let i = 0; i < 12; i++) if (inRange(m, i)) out[i] = (base / 12) * (h.seasonality[i] ?? 1) * f;
      break;
    }
    case "pct_of_line": {
      const src = m.source_master_id ? ctx.lineTotals?.get(m.source_master_id) : undefined;
      const f = Number(m.pct ?? 0) / 100;
      if (src) for (let i = 0; i < 12; i++) if (inRange(m, i)) out[i] = (src[i] ?? 0) * f;
      break;
    }
    case "one_time": {
      const month = Math.min(12, Math.max(1, Math.round(m.month ?? 1)));
      out[month - 1] = Number(m.amount ?? 0);
      break;
    }
    case "months": {
      for (let i = 0; i < 12; i++) out[i] = Number(m.months?.[i] ?? 0);
      break;
    }
  }
  return out.map(round2);
}

/** The percent sign the change shows with. */
function pctText(p: number | undefined): string {
  const v = Number(p ?? 0);
  if (!v) return "flat";
  return `${v > 0 ? "+" : ""}${Math.round(v * 10) / 10}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function rangeText(m: LineMethod): string {
  const s = m.start_month ?? 1;
  const e = m.end_month ?? 12;
  if (s === 1 && e === 12) return "";
  return `, ${MONTHS[s - 1]} to ${MONTHS[e - 1]}`;
}

/** One line of plain English for the method, for the item row. */
export function describeMethod(m: LineMethod, opts?: { sourceLineName?: string; year?: number; accountCount?: number }): string {
  const fmt = (v: number | undefined) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v ?? 0));
  const prior = opts?.year ? String(opts.year - 1) : "last year";
  const src = opts?.accountCount ? ` from ${opts.accountCount} account${opts.accountCount === 1 ? "" : "s"}` : "";
  switch (m.kind) {
    case "flat":
      return `${fmt(m.amount)} a month${rangeText(m)}`;
    case "annual":
      return `${fmt(m.amount)} for the year, ${m.spread === "shape" ? `by ${prior}'s shape` : "spread evenly"}${rangeText(m)}`;
    case "prior_year":
      return `${prior} ${pctText(m.pct)}${src}${rangeText(m)}`;
    case "run_rate":
      return `${m.basis === "trailing_3" ? "Last three months annualized" : "Trailing twelve months"} × seasonality, ${pctText(m.pct)}${src}${rangeText(m)}`;
    case "pct_of_line":
      return `${Math.round(Number(m.pct ?? 0) * 100) / 100}% of ${opts?.sourceLineName ?? "another line"}${rangeText(m)}`;
    case "one_time":
      return `${fmt(m.amount)} in ${MONTHS[Math.min(12, Math.max(1, Math.round(m.month ?? 1))) - 1]}`;
    case "months":
      return "Typed by month";
  }
}

export const METHOD_KINDS: Array<{ kind: MethodKind; label: string; help: string }> = [
  { kind: "run_rate", label: "Run rate", help: "Trailing twelve months, shaped by seasonality, moved by a percent." },
  { kind: "prior_year", label: "Last year, adjusted", help: "Each month of last year moved by a percent." },
  { kind: "flat", label: "Same each month", help: "One amount every month, or for part of the year." },
  { kind: "annual", label: "Annual total", help: "A yearly figure spread evenly or by last year's shape." },
  { kind: "pct_of_line", label: "Percent of a line", help: "Follows another budgeted line, month by month." },
  { kind: "one_time", label: "One time", help: "A single amount in one month." },
  { kind: "months", label: "By month", help: "Type the twelve months yourself." },
];

/** Reads a stored method, tolerating junk. */
export function readMethod(raw: unknown): LineMethod | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const kind = String(m.kind ?? "");
  if (!METHOD_KINDS.some((k) => k.kind === kind)) return null;
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v));
  return {
    kind: kind as MethodKind,
    amount: num(m.amount),
    pct: num(m.pct),
    start_month: num(m.start_month),
    end_month: num(m.end_month),
    month: num(m.month),
    spread: m.spread === "shape" ? "shape" : m.spread === "even" ? "even" : undefined,
    basis: m.basis === "trailing_3" ? "trailing_3" : m.basis === "trailing_12" ? "trailing_12" : undefined,
    source_master_id: typeof m.source_master_id === "string" && m.source_master_id ? m.source_master_id : undefined,
    months: Array.isArray(m.months) ? Array.from({ length: 12 }, (_, i) => Number((m.months as unknown[])[i] ?? 0)) : undefined,
    account_ids: Array.isArray(m.account_ids) ? m.account_ids.map(String).filter(Boolean) : undefined,
  };
}
