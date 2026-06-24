/**
 * Shared data model + formatting for the monthly summary, used by BOTH the
 * on-page HTML preview and the PDF export so the two never diverge.
 *
 * Dollar figures are carried in WHOLE DOLLARS and rendered in thousands.
 * Percent figures (margins, utilization) are carried already in percent units
 * (e.g. 82.3, not 0.823). Rates are dollars-per-day (not thousands). "avg" is
 * an average count rendered with one decimal.
 */

export type RowKind = "money" | "pct" | "rate" | "count" | "avg";

export interface CellValues {
  actual: number | null;
  py: number | null;
  budget: number | null;
}

export interface SummaryRow {
  label: string;
  kind: RowKind;
  /** true when lower is better (operating costs) — flips favorable color. */
  invert?: boolean;
  /** bold the label + actuals (subtotals like EBITDA, Total). */
  bold?: boolean;
  /** render muted/italic and indented (margin % sub-lines). */
  sub?: boolean;
  /** a blank spacer row. */
  spacer?: boolean;
  month: CellValues;
  ytd: CellValues;
}

export interface SummarySection {
  title: string;
  rows: SummaryRow[];
  /** when false, the Budget / A v B columns render as blank em-dashes. */
  showBudget: boolean;
}

export interface MonthlySummaryInput {
  organizationName: string;
  monthLabel: string; // "May 2026"
  monthShort: string; // "May-26"
  pyShort: string; // "May-25"
  ytdShort: string; // "YTD-26"
  ytdPyShort: string; // "YTD-25"
  generatedAtIso: string;
  scopeNote?: string; // e.g. "Consolidated"
  sections: SummarySection[];
}

// ─── Formatters (ASCII-only so the PDF's WinAnsi Helvetica renders cleanly) ──
export const DASH = "—"; // em-dash (in WinAnsi)

function fmtMoneyThousands(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const k = Math.round(n / 1000);
  if (k === 0) return "$0";
  const abs = Math.abs(k).toLocaleString("en-US");
  return k < 0 ? `($${abs})` : `$${abs}`;
}

function fmtRate(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const r = Math.round(n);
  const abs = Math.abs(r).toLocaleString("en-US");
  return r < 0 ? `($${abs})` : `$${abs}`;
}

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${n.toFixed(1)}%`;
}

function fmtCount(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return Math.round(n).toLocaleString("en-US");
}

function fmtAvg(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function fmtValue(kind: RowKind, n: number | null): string {
  switch (kind) {
    case "money":
      return fmtMoneyThousands(n);
    case "rate":
      return fmtRate(n);
    case "pct":
      return fmtPct(n);
    case "count":
      return fmtCount(n);
    case "avg":
      return fmtAvg(n);
  }
}

export interface Variance {
  text: string;
  favorable: boolean | null; // null = neutral, no fill
}

/**
 * Variance vs a baseline (prior year or budget).
 *   money / rate → percent change, displayed as a signed percent.
 *   pct / avg    → point/unit delta, parenthesized when negative.
 *   count        → integer delta, parenthesized when negative.
 * `invert` flips which direction counts as favorable (operating costs).
 */
export function variance(
  kind: RowKind,
  actual: number | null,
  base: number | null,
  invert: boolean
): Variance {
  if (actual == null || base == null || !Number.isFinite(actual) || !Number.isFinite(base)) {
    return { text: DASH, favorable: null };
  }

  let delta: number; // signed magnitude used to decide favorable direction
  let text: string;

  if (kind === "pct" || kind === "avg") {
    // percentage-point / unit delta, one decimal
    delta = actual - base;
    const abs = Math.abs(delta).toFixed(1);
    text = delta < 0 ? `(${abs})` : abs;
  } else if (kind === "count") {
    delta = actual - base;
    const abs = Math.abs(Math.round(delta)).toLocaleString("en-US");
    text = delta < 0 ? `(${abs})` : abs;
  } else {
    // money / rate → percent change off the baseline magnitude
    if (base === 0) return { text: DASH, favorable: null };
    const pct = ((actual - base) / Math.abs(base)) * 100;
    delta = pct;
    text = `${pct < 0 ? "-" : ""}${Math.abs(pct).toFixed(1)}%`;
  }

  let favorable: boolean | null;
  if (Math.abs(delta) < 0.05) favorable = null;
  else {
    const up = delta > 0;
    favorable = invert ? !up : up;
  }
  return { text, favorable };
}
