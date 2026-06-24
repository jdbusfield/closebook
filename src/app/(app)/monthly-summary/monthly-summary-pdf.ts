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

import {
  DASH,
  fmtValue,
  variance,
  type CellValues,
  type MonthlySummaryInput,
  type SummaryPanel,
  type SummaryRow,
  type SummarySection,
} from "./monthly-summary-model";

// ─── Colors (jsPDF RGB tuples) ─────────────────────────────────────────────
const FAV_FILL: [number, number, number] = [214, 243, 222]; // pale green
const FAV_TEXT: [number, number, number] = [21, 110, 61];
const UNFAV_FILL: [number, number, number] = [248, 219, 219]; // pale red
const UNFAV_TEXT: [number, number, number] = [157, 31, 31];
const BAR_FILL: [number, number, number] = [17, 17, 17]; // section title bar
const SUBHEAD_FILL: [number, number, number] = [238, 238, 238];
const MUTED_TEXT: [number, number, number] = [110, 110, 110];

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
  // Label column, then two equal halves: Year-to-Date (left) and Month (right).
  // Each half splits into 5 columns when the section carries budget data, else
  // 3 — so the YTD↔Month divide stays aligned across every section while
  // non-budget sections drop the empty Budget / A v B columns entirely.
  const LABEL_W = 150;
  const halfW = (usableWidth - LABEL_W) / 2;

  const blockHeads = (showBudget: boolean, first: string, second: string): string[] =>
    showBudget ? [first, second, "A v PY", "Budget", "A v B"] : [first, second, "A v PY"];

  function headFor(section: SummarySection): string[] {
    return [
      "",
      ...blockHeads(section.showBudget, input.ytdShort, input.ytdPyShort),
      ...blockHeads(section.showBudget, input.monthShort, input.pyShort),
    ];
  }

  function columnStylesFor(
    section: SummarySection
  ): Record<number, { cellWidth: number; halign: "left" | "right" }> {
    const n = section.showBudget ? 5 : 3;
    const colW = halfW / n;
    const cs: Record<number, { cellWidth: number; halign: "left" | "right" }> = {
      0: { cellWidth: LABEL_W, halign: "left" },
    };
    for (let i = 1; i <= 2 * n; i++) cs[i] = { cellWidth: colW, halign: "right" };
    return cs;
  }

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

    const cells: CellDef[] = [
      { content: fmtValue(row.kind, vals.actual), styles: actualStyles },
      { content: fmtValue(row.kind, vals.py), styles: baseStyles },
      varCell(vals.py, true),
    ];
    // Budget + A v B columns only when the section has budget data.
    if (showBudget) {
      cells.push({ content: fmtValue(row.kind, vals.budget), styles: baseStyles });
      cells.push(varCell(vals.budget, true));
    }
    return cells;
  }

  function bodyForSection(section: SummarySection): CellDef[][] {
    const colCount = 1 + 2 * (section.showBudget ? 5 : 3);
    return section.rows.map((row) => {
      if (row.spacer) {
        return Array.from({ length: colCount }, () => ({ content: "", styles: { minCellHeight: 4 } }));
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
    doc.text("YEAR-TO-DATE", margin + LABEL_W + halfW / 2, cursorY + 11, { align: "center" });
    doc.text("MONTH", margin + LABEL_W + halfW * 1.5, cursorY + 11, { align: "center" });

    cursorY += barH;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      tableWidth: usableWidth,
      head: [headFor(section)],
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
      columnStyles: columnStylesFor(section),
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

  // ─── Bottom panels (compact, side-by-side) ─────────────────────────────────
  function renderPanel(
    panel: SummaryPanel,
    x: number,
    w: number,
    top: number
  ): number {
    const barH = 15;
    doc.setFillColor(...BAR_FILL);
    doc.rect(x, top, w, barH, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(panel.title.toUpperCase(), x + 5, top + 10);

    const body = panel.rows.map((r) => {
      const cells: { content: string; styles: Record<string, unknown> }[] = [
        { content: r.label, styles: { halign: "left", fontStyle: r.bold ? "bold" : "normal" } },
        {
          content: fmtValue(panel.kind, r.current),
          styles: { halign: "right", fontStyle: r.bold ? "bold" : "normal" },
        },
      ];
      if (panel.showPy) {
        cells.push({ content: fmtValue(panel.kind, r.py), styles: { halign: "right" } });
        const v = variance(panel.kind, r.current, r.py, !!panel.invert);
        const st: Record<string, unknown> = { halign: "right" };
        if (panel.colorVariance && v.favorable === true) {
          st.fillColor = FAV_FILL;
          st.textColor = FAV_TEXT;
        } else if (panel.colorVariance && v.favorable === false) {
          st.fillColor = UNFAV_FILL;
          st.textColor = UNFAV_TEXT;
        } else {
          st.textColor = MUTED_TEXT;
        }
        cells.push({ content: v.text, styles: st });
      }
      return cells;
    });

    const head = panel.showPy
      ? [["", panel.currentLabel, panel.pyLabel, "A v PY"]]
      : [["", panel.currentLabel]];
    const cw: Record<number, { cellWidth: number; halign: "left" | "right" }> = panel.showPy
      ? {
          0: { cellWidth: w * 0.4, halign: "left" },
          1: { cellWidth: w * 0.2, halign: "right" },
          2: { cellWidth: w * 0.2, halign: "right" },
          3: { cellWidth: w * 0.2, halign: "right" },
        }
      : {
          0: { cellWidth: w * 0.55, halign: "left" },
          1: { cellWidth: w * 0.45, halign: "right" },
        };

    autoTable(doc, {
      startY: top + barH,
      margin: { left: x, right: pageWidth - (x + w) },
      tableWidth: w,
      head,
      body,
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 7,
        cellPadding: { top: 2, right: 4, bottom: 2, left: 4 },
        lineColor: [225, 225, 225],
        lineWidth: 0.5,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: SUBHEAD_FILL,
        textColor: [40, 40, 40],
        fontStyle: "bold",
        fontSize: 6.5,
        halign: "right",
        lineColor: [210, 210, 210],
        lineWidth: 0.5,
      },
      columnStyles: cw,
      didParseCell: (data: Record<string, unknown>) => {
        const sect = data.section as string;
        const ci = (data.column as { index: number }).index;
        const cell = data.cell as { styles: Record<string, unknown> };
        if (sect === "head") cell.styles.halign = ci === 0 ? "left" : "right";
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (doc as any).lastAutoTable?.finalY ?? top + barH + 40;
  }

  if (input.panels && input.panels.length > 0) {
    const n = input.panels.length;
    const gap = 12;
    const panelW = (usableWidth - gap * (n - 1)) / n;
    const top = cursorY;
    let maxY = top;
    input.panels.forEach((panel, i) => {
      const x = margin + i * (panelW + gap);
      const fy = renderPanel(panel, x, panelW, top);
      if (fy > maxY) maxY = fy;
    });
    cursorY = maxY + 10;
  }

  const safeMonth = input.monthShort.replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`monthly-summary-${safeMonth}.pdf`);
}
