"use client";

/**
 * One-page monthly performance summary PDF, designed to attach to the
 * financial package. Mirrors the CEO summary model: four stacked sections
 * (Performance, Utilization, Rates, Fleet Size), each with a Month block and
 * a Year-to-Date block, and red/green conditional formatting on the variance
 * columns (vs Prior Year and vs Budget).
 *
 * Conventions follow debt-pdf.ts:
 *   - Landscape letter, jsPDF + jspdf-autotable (already bundled, zero-install).
 *   - ASCII-only glyphs so Helvetica's WinAnsi encoding renders cleanly
 *     (hyphen-minus, parentheses for negatives, em-dash for blank cells).
 *   - The caller assembles the clean SummaryInput model; this module only
 *     formats and lays out, so the P&L / KPI plumbing stays out of here.
 *
 * P&L dollar figures are passed in WHOLE DOLLARS and rendered in thousands.
 * Percent figures (margins, utilization) are passed already in percent units
 * (e.g. 82.3, not 0.823). Rates are dollars-per-day (not thousands).
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
  /** bold the label + actuals (subtotals like Gross Margin, EBITDA). */
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

// ─── Colors ──────────────────────────────────────────────────────────────
const FAV_FILL: [number, number, number] = [214, 243, 222]; // pale green
const FAV_TEXT: [number, number, number] = [21, 110, 61];
const UNFAV_FILL: [number, number, number] = [248, 219, 219]; // pale red
const UNFAV_TEXT: [number, number, number] = [157, 31, 31];
const BAR_FILL: [number, number, number] = [17, 17, 17]; // section title bar
const SUBHEAD_FILL: [number, number, number] = [238, 238, 238];
const MUTED_TEXT: [number, number, number] = [110, 110, 110];

// ─── Formatters (ASCII-only) ───────────────────────────────────────────────
const DASH = "—"; // em-dash (in WinAnsi)

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

function fmtValue(kind: RowKind, n: number | null): string {
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

interface Variance {
  text: string;
  favorable: boolean | null; // null = neutral, no fill
}

/**
 * Variance vs a baseline (prior year or budget).
 *   money / rate → percent change, displayed as a signed percent.
 *   pct          → percentage-point delta, parenthesized when negative.
 *   count        → integer delta, parenthesized when negative.
 * `invert` flips which direction counts as favorable (operating costs).
 */
function variance(
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

export async function exportMonthlySummaryPdf(
  input: MonthlySummaryInput
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const autoTableMod = await import("jspdf-autotable");
  const autoTable = (autoTableMod.default ?? autoTableMod) as unknown as (
    doc: InstanceType<typeof jsPDF>,
    opts: Record<string, unknown>
  ) => void;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  const usableWidth = pageWidth - margin * 2;

  // ─── Title block ─────────────────────────────────────────────────────────
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(input.organizationName || "Organization", margin, 30);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Monthly Performance Summary  —  ${input.monthLabel}`, margin, 47);

  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED_TEXT);
  const scopeBits = [
    input.scopeNote ?? "Consolidated",
    "$ in thousands",
  ].join("   ·   ");
  doc.text(scopeBits, margin, 60);

  // ─── Column geometry ─────────────────────────────────────────────────────
  // 1 label column + 5 Month columns + 5 YTD columns.
  const LABEL_W = 150;
  const numCount = 10;
  const numW = (usableWidth - LABEL_W) / numCount;
  const columnStyles: Record<number, { cellWidth: number; halign: "left" | "right" }> = {
    0: { cellWidth: LABEL_W, halign: "left" },
  };
  for (let i = 1; i <= numCount; i++) {
    columnStyles[i] = { cellWidth: numW, halign: "right" };
  }

  // Year-to-Date block is shown first (left), Month block second (right).
  const subHead = [
    "",
    input.ytdShort,
    input.ytdPyShort,
    "A v PY",
    "Budget",
    "A v B",
    input.monthShort,
    input.pyShort,
    "A v PY",
    "Budget",
    "A v B",
  ];

  type CellDef = { content: string; styles?: Record<string, unknown> };

  // Build the body cells for one block (Month or YTD) of a row.
  function blockCells(row: SummaryRow, vals: CellValues, showBudget: boolean): CellDef[] {
    const actualStyles: Record<string, unknown> = {};
    if (row.bold) actualStyles.fontStyle = "bold";
    if (row.sub) actualStyles.textColor = MUTED_TEXT;

    const baseStyles: Record<string, unknown> = {};
    if (row.sub) baseStyles.textColor = MUTED_TEXT;

    const varCell = (base: number | null, show: boolean): CellDef => {
      if (!show) return { content: DASH, styles: { textColor: [180, 180, 180] } };
      const v = variance(row.kind, vals.actual, base, !!row.invert);
      const styles: Record<string, unknown> = {};
      if (v.favorable === true) {
        styles.fillColor = FAV_FILL;
        styles.textColor = FAV_TEXT;
      } else if (v.favorable === false) {
        styles.fillColor = UNFAV_FILL;
        styles.textColor = UNFAV_TEXT;
      } else {
        styles.textColor = MUTED_TEXT;
      }
      return { content: v.text, styles };
    };

    return [
      { content: fmtValue(row.kind, vals.actual), styles: actualStyles },
      { content: fmtValue(row.kind, vals.py), styles: baseStyles },
      varCell(vals.py, true),
      { content: showBudget ? fmtValue(row.kind, vals.budget) : DASH, styles: showBudget ? baseStyles : { textColor: [180, 180, 180] } },
      varCell(vals.budget, showBudget),
    ];
  }

  function bodyForSection(section: SummarySection): CellDef[][] {
    return section.rows.map((row) => {
      if (row.spacer) {
        return Array.from({ length: 11 }, () => ({ content: "", styles: { minCellHeight: 4 } }));
      }
      const labelStyles: Record<string, unknown> = { halign: "left" };
      if (row.bold) labelStyles.fontStyle = "bold";
      if (row.sub) {
        labelStyles.textColor = MUTED_TEXT;
        labelStyles.fontStyle = "italic";
        labelStyles.cellPadding = { top: 2, right: 4, bottom: 2, left: 16 };
      }
      return [
        { content: row.label, styles: labelStyles },
        ...blockCells(row, row.ytd, section.showBudget),
        ...blockCells(row, row.month, section.showBudget),
      ];
    });
  }

  let cursorY = 76;

  for (const section of input.sections) {
    // Section title bar (full width, dark).
    const barH = 16;
    doc.setFillColor(...BAR_FILL);
    doc.rect(margin, cursorY, usableWidth, barH, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(section.title.toUpperCase(), margin + 6, cursorY + 11);
    // Month / Year-to-Date block markers on the bar.
    doc.setFontSize(8);
    doc.setTextColor(200, 200, 200);
    doc.text("YEAR-TO-DATE", margin + LABEL_W + numW * 2.5, cursorY + 11, { align: "center" });
    doc.text("MONTH", margin + LABEL_W + numW * 7.5, cursorY + 11, { align: "center" });

    cursorY += barH;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      tableWidth: usableWidth,
      head: [subHead],
      body: bodyForSection(section),
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 7.5,
        cellPadding: { top: 2.5, right: 4, bottom: 2.5, left: 4 },
        lineColor: [225, 225, 225],
        lineWidth: 0.5,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: SUBHEAD_FILL,
        textColor: [40, 40, 40],
        fontStyle: "bold",
        fontSize: 7,
        halign: "right",
        lineColor: [210, 210, 210],
        lineWidth: 0.5,
      },
      columnStyles,
      didParseCell: (data: Record<string, unknown>) => {
        const section2 = data.section as string;
        const columnIndex = (data.column as { index: number }).index;
        const cell = data.cell as { styles: Record<string, unknown> };
        if (section2 === "head") {
          cell.styles.halign = columnIndex === 0 ? "left" : "right";
        }
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const finalY = (doc as any).lastAutoTable?.finalY ?? cursorY + 40;
    cursorY = finalY + 10;
  }

  // ─── Footer ──────────────────────────────────────────────────────────────
  doc.setTextColor(...MUTED_TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(
    "Operating-cost variances are shaded by favorability (green = favorable). Utilization, rate, and fleet figures show actual vs prior year only.",
    margin,
    pageHeight - 20
  );
  doc.text(
    `Generated ${input.generatedAtIso.slice(0, 10)}`,
    pageWidth - margin,
    pageHeight - 20,
    { align: "right" }
  );

  const safeMonth = input.monthShort.replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`monthly-summary-${safeMonth}.pdf`);
}
