"use client";

/**
 * PDF summary of the debt roll-forward for investor / bank circulation.
 * Layout: polished title block, KPI band, and an instrument-level
 * roll-forward grouped by entity (entity header → individual loan rows →
 * entity subtotal, with a grand total at the bottom).
 *
 * Instrument selection is handled upstream: the caller filters the
 * rollforward down to the selected loans before passing it in, so this
 * renderer just walks whatever entities/debt-types/instruments it receives.
 *
 * Formatting decisions driving the layout:
 *   - Landscape letter, 36pt margins → 720pt of usable width per row
 *   - Every column width is explicit so head/body/foot all align precisely
 *   - Numeric columns show full dollar amounts (comma-grouped, rounded),
 *     sized so "-$28,214,891" fits on one line at 7pt bold
 *   - ASCII-only text in rendered strings. jsPDF's bundled Helvetica uses
 *     WinAnsi encoding — U+2212 true minus, U+25B2/BC triangles, and
 *     U+0394 Δ are NOT in the glyph table, so using them triggers glyph
 *     substitution that cascades into visible letter-spacing and truncated
 *     cells. Stick to hyphen-minus, plain words, and em/en dashes
 *     (U+2014/2013 ARE in WinAnsi).
 *   - Head, body, and foot share identical alignment + cellWidth per
 *     column → nothing shifts when rows render at different lengths
 *
 * jsPDF + jspdf-autotable is already in the bundle (used by the accrued
 * interest page), so this stays a zero-install add-on.
 */

import { formatLongDate } from "@/lib/utils/excel";
import {
  DEBT_TYPE_LABELS,
  type GroupedRollForward,
  type InstrumentRollForward,
  type RollForwardTotals,
} from "@/lib/utils/debt-rollforward";

export interface PdfOptions {
  organizationName: string;
  scopeLabel: string;
  startIso: string;
  endIso: string;
  asOfIso: string;
}

// Full dollar amount, comma-grouped, rounded to whole dollars. Accounting
// format — negatives render as `($1,234)` rather than `-$1,234`. ASCII-only
// glyphs so it survives Helvetica's WinAnsi encoding (em-dash for zero is in
// WinAnsi; U+2212 true minus is not, which is why we avoid it).
function fullDollars(n: number): string {
  if (Math.abs(n) < 0.5) return "—";
  const rounded = Math.round(n);
  const abs = Math.abs(rounded);
  const formatted = `$${abs.toLocaleString("en-US")}`;
  return rounded < 0 ? `(${formatted})` : formatted;
}

// Fixed-width text columns. The remaining usable width splits evenly across
// the numeric columns that survive the blank-column drop.
const INSTRUMENT_W = 130;
const TYPE_W = 50;

// Column definition — one per column in the instrument-level table.
// Each column produces the cell string for three row types: individual
// instruments, entity subtotals, and the grand total. Building head, body,
// foot, and columnStyles from this single list keeps them in lockstep.
interface Col {
  head: string;
  halign: "left" | "right" | "center";
  isLabel?: boolean; // instrument / subtotal label column
  isType?: boolean; // debt-type column
  instr: (i: InstrumentRollForward) => string;
  subtotal: (totals: RollForwardTotals) => string;
  grand: () => string;
}

// Shorthand for the debt-type column (the table already has width pressure,
// so prefer "LOC" to "Line of Credit", etc.).
const DEBT_TYPE_SHORT: Record<string, string> = {
  term_loan: "Term Loan",
  line_of_credit: "LOC",
  revolving_credit: "Revolving",
  mortgage: "Mortgage",
  equipment_loan: "Equipment",
  balloon_loan: "Balloon",
  bridge_loan: "Bridge",
  sba_loan: "SBA",
  other: "Other",
};
function debtTypeShort(raw: string): string {
  return DEBT_TYPE_SHORT[raw] ?? DEBT_TYPE_LABELS[raw] ?? raw;
}
function instrumentLabel(inst: InstrumentRollForward): string {
  const base = inst.instrument.instrument_name || inst.instrument.lender_name || "Untitled";
  const loanNo = inst.instrument.loan_number;
  return loanNo ? `${base} (#${loanNo})` : base;
}

export async function exportDebtPdf(
  rf: GroupedRollForward,
  opts: PdfOptions
): Promise<void> {
  // Dynamic import — keeps jsPDF out of the initial bundle for users who
  // never click Export.
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

  const t = rf.totals;
  const netDelta = t.endingBalance - t.beginningBalance;

  // ─── Title block ─────────────────────────────────────────────────────────
  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, pageWidth, 72, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(opts.organizationName || "Organization", margin, 32);

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Debt Roll-Forward — Supplemental to Financial Statements",
    margin,
    50
  );

  doc.setFontSize(10);
  doc.text(
    `${opts.scopeLabel}  ·  ${formatLongDate(opts.startIso)} through ${formatLongDate(opts.endIso)}`,
    margin,
    64
  );

  // ─── KPI band ────────────────────────────────────────────────────────────
  // Principal Paid is a cash outflow so it's rendered in red with the
  // accounting (parentheses) negative format. Fees is dropped from the
  // band entirely when there's no fee activity in the period.
  type KpiTile = {
    label: string;
    value: string;
    valueColor?: readonly [number, number, number];
  };
  const principalPaidValue = fullDollars(-t.netPrincipalPaid);
  const kpis: KpiTile[] = [
    { label: "Beginning", value: fullDollars(t.beginningBalance) },
    { label: "Draws", value: fullDollars(t.draws) },
    {
      label: "Principal Paid",
      value: principalPaidValue,
      valueColor:
        principalPaidValue === "—" ? undefined : ([190, 18, 60] as const),
    },
    { label: "Interest Paid", value: fullDollars(t.interestPayments) },
    { label: "Fees", value: fullDollars(t.fees) },
    { label: "Ending", value: fullDollars(t.endingBalance) },
  ].filter((k) => k.label !== "Fees" || k.value !== "—");

  const kpiTop = 96;
  const kpiHeight = 58;
  const kpiGap = 8;
  const totalGapWidth = kpiGap * (kpis.length - 1);
  const kpiWidth = (pageWidth - margin * 2 - totalGapWidth) / kpis.length;
  kpis.forEach((k, i) => {
    const x = margin + i * (kpiWidth + kpiGap);
    doc.setDrawColor(220, 220, 220);
    doc.setFillColor(247, 249, 252);
    doc.roundedRect(x, kpiTop, kpiWidth, kpiHeight, 4, 4, "FD");

    doc.setTextColor(107, 114, 128);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.text(k.label.toUpperCase(), x + 10, kpiTop + 18);

    const [vr, vg, vb] = k.valueColor ?? [0, 0, 0];
    doc.setTextColor(vr, vg, vb);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(k.value, x + 10, kpiTop + 42);
  });

  // ─── Roll-Forward by Instrument ──────────────────────────────────────────
  // Flatten to an instrument list so we can check what activity actually
  // exists across the filtered rollforward. Optional columns (Veh. Payoff,
  // Payoff, Adj) are dropped entirely when zero everywhere — no blank
  // column, no dead header.
  const allInstruments: InstrumentRollForward[] = rf.entities.flatMap((eg) =>
    eg.debtTypes.flatMap((dt) => dt.instruments)
  );
  const hasAnyActivity = (pick: (i: InstrumentRollForward) => number): boolean =>
    allInstruments.some((i) => Math.abs(pick(i)) >= 0.5);

  const hasVehiclePayoff = hasAnyActivity((i) => i.vehiclePayoffs);
  const hasPayoff = hasAnyActivity((i) => i.payoffs);
  const hasAdj = hasAnyActivity(
    (i) => i.adjustments + i.reversals + i.noteRenewals
  );

  const cols: Col[] = [
    {
      head: "Instrument",
      halign: "left",
      isLabel: true,
      instr: (i) => instrumentLabel(i),
      subtotal: () => "Subtotal",
      grand: () => "Grand Total",
    },
    {
      head: "Type",
      halign: "center",
      isType: true,
      instr: (i) => debtTypeShort(i.instrument.debt_type),
      subtotal: () => "",
      grand: () => "",
    },
    {
      head: "Beginning",
      halign: "right",
      instr: (i) => fullDollars(i.beginningBalance),
      subtotal: (s) => fullDollars(s.beginningBalance),
      grand: () => fullDollars(t.beginningBalance),
    },
    {
      head: "Draws",
      halign: "right",
      instr: (i) => fullDollars(i.draws),
      subtotal: (s) => fullDollars(s.draws),
      grand: () => fullDollars(t.draws),
    },
    {
      head: "Principal",
      halign: "right",
      instr: (i) => fullDollars(-i.principalPayments),
      subtotal: (s) => fullDollars(-s.principalPayments),
      grand: () => fullDollars(-t.principalPayments),
    },
  ];
  if (hasVehiclePayoff) {
    cols.push({
      head: "Veh. Payoff",
      halign: "right",
      instr: (i) => fullDollars(-i.vehiclePayoffs),
      subtotal: (s) => fullDollars(-s.vehiclePayoffs),
      grand: () => fullDollars(-t.vehiclePayoffs),
    });
  }
  if (hasPayoff) {
    cols.push({
      head: "Payoff",
      halign: "right",
      instr: (i) => fullDollars(-i.payoffs),
      subtotal: (s) => fullDollars(-s.payoffs),
      grand: () => fullDollars(-t.payoffs),
    });
  }
  if (hasAdj) {
    cols.push({
      head: "Adj",
      halign: "right",
      instr: (i) => fullDollars(i.adjustments + i.reversals + i.noteRenewals),
      subtotal: (s) =>
        fullDollars(s.adjustments + s.reversals + s.noteRenewals),
      grand: () => fullDollars(t.adjustments + t.reversals + t.noteRenewals),
    });
  }
  cols.push(
    {
      head: "Ending",
      halign: "right",
      instr: (i) => fullDollars(i.endingBalance),
      subtotal: (s) => fullDollars(s.endingBalance),
      grand: () => fullDollars(t.endingBalance),
    },
    {
      head: "Change",
      halign: "right",
      instr: (i) => fullDollars(i.endingBalance - i.beginningBalance),
      subtotal: (s) => fullDollars(s.endingBalance - s.beginningBalance),
      grand: () => fullDollars(netDelta),
    },
    {
      head: "Interest",
      halign: "right",
      instr: (i) => fullDollars(i.interestPayments),
      subtotal: (s) => fullDollars(s.interestPayments),
      grand: () => fullDollars(t.interestPayments),
    }
  );

  // Size the remaining columns. Instrument + Type are fixed; numeric cols
  // split the rest evenly.
  const usableWidth = pageWidth - margin * 2;
  const numericCount = cols.filter((c) => !c.isLabel && !c.isType).length;
  const numWidth = (usableWidth - INSTRUMENT_W - TYPE_W) / numericCount;

  const columnStyles: Record<
    number,
    { cellWidth: number; halign: "left" | "right" | "center" }
  > = {};
  cols.forEach((c, i) => {
    columnStyles[i] = {
      cellWidth: c.isLabel ? INSTRUMENT_W : c.isType ? TYPE_W : numWidth,
      halign: c.halign,
    };
  });
  const endingColIndex = cols.findIndex((c) => c.head === "Ending");

  // Build the body. Each entity gets an entity-header row (full-width span),
  // one row per instrument, and an entity-subtotal row. The grand total
  // lives in the foot so it repeats cleanly if the table wraps to a new
  // page.
  type CellDef = {
    content: string;
    colSpan?: number;
    styles?: Record<string, unknown>;
  };

  const ENTITY_HEADER_FILL: [number, number, number] = [235, 235, 235];
  const ENTITY_HEADER_TEXT: [number, number, number] = [0, 0, 0];
  const SUBTOTAL_FILL: [number, number, number] = [245, 245, 245];
  const NEG_TEXT: [number, number, number] = [190, 18, 60];

  const styleInstrumentCell = (
    content: string,
    isEndingCol: boolean
  ): Record<string, unknown> => {
    const styles: Record<string, unknown> = {};
    if (content.startsWith("(")) styles.textColor = NEG_TEXT;
    if (isEndingCol) styles.fontStyle = "bold";
    return styles;
  };

  const styleSubtotalCell = (content: string): Record<string, unknown> => {
    const styles: Record<string, unknown> = {
      fontStyle: "bold",
      fillColor: SUBTOTAL_FILL,
    };
    if (content.startsWith("(")) styles.textColor = NEG_TEXT;
    return styles;
  };

  const body: CellDef[][] = [];
  for (const eg of rf.entities) {
    const entityInstruments = eg.debtTypes.flatMap((dt) => dt.instruments);
    if (entityInstruments.length === 0) continue;

    const entityTitle = eg.entity.code
      ? `${eg.entity.name}  —  ${eg.entity.code}`
      : eg.entity.name;
    body.push([
      {
        content: entityTitle,
        colSpan: cols.length,
        styles: {
          fontStyle: "bold",
          fillColor: ENTITY_HEADER_FILL,
          textColor: ENTITY_HEADER_TEXT,
          halign: "left",
          fontSize: 8,
        },
      },
    ]);

    for (const inst of entityInstruments) {
      body.push(
        cols.map((c, i) => {
          const content = c.instr(inst);
          return { content, styles: styleInstrumentCell(content, i === endingColIndex) };
        })
      );
    }

    body.push(
      cols.map((c) => {
        const content = c.subtotal(eg.totals);
        return { content, styles: styleSubtotalCell(content) };
      })
    );
  }

  // Tighter spacing than before — the net-change callout used to sit in
  // this gap; without it the KPI band and section title can breathe a bit
  // less.
  let cursorY = kpiTop + kpiHeight + 22;

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Roll-Forward by Instrument", margin, cursorY);
  cursorY += 8;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    tableWidth: usableWidth,
    head: [cols.map((c) => c.head)],
    body,
    foot: [
      cols.map((c) => {
        const content = c.grand();
        const styles: Record<string, unknown> = {};
        if (content.startsWith("(")) styles.textColor = NEG_TEXT;
        return { content, styles };
      }),
    ],
    styles: {
      font: "helvetica",
      fontSize: 7,
      cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
      lineColor: [220, 220, 220],
      lineWidth: 0.5,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [0, 0, 0],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 7,
      halign: "right",
    },
    footStyles: {
      fillColor: [220, 220, 220],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 7,
    },
    columnStyles,
    didParseCell: (data: Record<string, unknown>) => {
      const section = data.section as string;
      const columnIndex = (data.column as { index: number }).index;
      const cell = data.cell as {
        text: string[];
        styles: Record<string, unknown>;
        colSpan?: number;
      };
      // Skip row-span cells (entity headers already carry explicit styles).
      if ((cell.colSpan ?? 1) > 1) return;
      const cfg = columnStyles[columnIndex];
      // Mirror per-column alignment on head and foot so numbers line up with
      // the body. footStyles alone doesn't express "right-align numerics
      // except the 'Grand Total' label" — per-column override here does.
      if ((section === "head" || section === "foot") && cfg) {
        cell.styles.halign = cfg.halign;
      }
    },
  });

  // ─── Footer on every page ────────────────────────────────────────────────
  // Shortened caption + page number only when paginated, so the two strings
  // don't collide in the middle of the bottom margin on single-page reports.
  const totalPages = doc.getNumberOfPages();
  const footerCaption =
    "Paydowns shown as negatives. Amounts rounded to the nearest dollar.";
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setTextColor(140, 140, 140);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(footerCaption, margin, pageHeight - 22);
    if (totalPages > 1) {
      doc.text(
        `Page ${p} of ${totalPages}`,
        pageWidth - margin,
        pageHeight - 22,
        { align: "right" }
      );
    }
  }

  const safe = opts.scopeLabel.replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`debt-roll-forward-${safe}-${opts.startIso}-to-${opts.endIso}.pdf`);
}

