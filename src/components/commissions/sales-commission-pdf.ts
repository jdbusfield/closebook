"use client";

/**
 * Monthly commission statement PDF — the deliverable the contract's
 * payment clause requires: gross revenue in reasonable detail, all
 * exclusions, and the fee calculation. Wordmark masthead, two totals boxes,
 * per-customer summary grouped by rate type (salesperson's accounts, then
 * excluded, then the default catch-all), then invoice-level backup.
 *
 * Conventions follow monthly-summary-pdf.ts / debt-pdf.ts: portrait letter,
 * jsPDF + jspdf-autotable via dynamic import, ASCII-only glyphs so
 * Helvetica's WinAnsi encoding renders cleanly.
 */

import {
  VERSATILE_WORDMARK_DATA_URL,
  VERSATILE_WORDMARK_ASPECT,
} from "@/lib/brand/versatile-wordmark";

const BAR_FILL: [number, number, number] = [31, 58, 95]; // deep navy, matches Excel
const SUBHEAD_FILL: [number, number, number] = [232, 236, 241];
const MUTED_TEXT: [number, number, number] = [110, 110, 110];
const ZEBRA_FILL: [number, number, number] = [247, 249, 252];
const BOX_BORDER: [number, number, number] = [200, 206, 214];

export interface CommissionPdfInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  subtotal: number;
}

export interface CommissionPdfRow {
  customerName: string;
  rateTypeName: string;
  ratePercent: number;
  invoiceCount: number;
  revenue: number;
  commission: number;
  assigned: boolean;
  invoices?: CommissionPdfInvoice[];
}

export interface CommissionPdfInput {
  entityName: string;
  salespersonName: string;
  periodLabel: string; // e.g. "July 2026"
  commissionStartDate: string | null; // YYYY-MM-DD
  /** Name of the plan's default (catch-all) rate type; its group prints last. */
  defaultRateTypeName?: string | null;
  rows: CommissionPdfRow[];
  totalRevenue: number;
  totalCommission: number;
  beforeStartCount: number;
  filename: string;
}

const money = (n: number): string => {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `($${abs})` : `$${abs}`;
};

const pct = (n: number): string =>
  `${n.toFixed(2).replace(/\.?0+$/, "")}%`;

const fmtDate = (raw: string): string => {
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return raw;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

export async function exportSalesCommissionPdf(
  input: CommissionPdfInput,
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  const autoTableMod = await import("jspdf-autotable");
  const autoTable = (autoTableMod.default ?? autoTableMod) as unknown as (
    doc: InstanceType<typeof jsPDF>,
    opts: Record<string, unknown>,
  ) => void;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  // ── Masthead: wordmark, statement title, period ──────────────────────
  const logoW = 150;
  const logoH = logoW / VERSATILE_WORDMARK_ASPECT;
  let logoPlaced = false;
  try {
    doc.addImage(VERSATILE_WORDMARK_DATA_URL, "PNG", margin, 30, logoW, logoH);
    logoPlaced = true;
  } catch {
    /* fall back to the entity name below */
  }
  doc.setTextColor(0, 0, 0);
  if (!logoPlaced) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(input.entityName, margin, 42);
  }

  const titleY = 30 + logoH + 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Commission Statement  -  ${input.salespersonName}`, margin, titleY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(input.periodLabel, margin, titleY + 15);

  // ── Two totals boxes: revenue left, commission due right ────────────
  const boxTop = titleY + 30;
  const boxH = 44;
  const gap = 16;
  const boxW = (pageWidth - margin * 2 - gap) / 2;
  const boxes: { label: string; value: string; x: number }[] = [
    { label: "Commissionable Revenue", value: money(input.totalRevenue), x: margin },
    {
      label: "Total Commission Due",
      value: money(input.totalCommission),
      x: margin + boxW + gap,
    },
  ];
  for (const b of boxes) {
    doc.setFillColor(...SUBHEAD_FILL);
    doc.setDrawColor(...BOX_BORDER);
    doc.setLineWidth(0.6);
    doc.roundedRect(b.x, boxTop, boxW, boxH, 3, 3, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED_TEXT);
    doc.text(b.label, b.x + 12, boxTop + 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text(b.value, b.x + 12, boxTop + 34);
  }

  // ── Per-customer summary, grouped by rate type ───────────────────────
  // Groups: assigned rate types highest rate first (the salesperson's own
  // accounts, then excluded 0% accounts), with the default catch-all last.
  const defaultName =
    input.defaultRateTypeName ??
    input.rows.find((r) => !r.assigned)?.rateTypeName ??
    null;
  const groupMap = new Map<
    string,
    { name: string; ratePercent: number; rows: CommissionPdfRow[] }
  >();
  for (const r of input.rows) {
    const g = groupMap.get(r.rateTypeName) ?? {
      name: r.rateTypeName,
      ratePercent: r.ratePercent,
      rows: [],
    };
    g.rows.push(r);
    groupMap.set(r.rateTypeName, g);
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    const aDef = a.name === defaultName ? 1 : 0;
    const bDef = b.name === defaultName ? 1 : 0;
    if (aDef !== bDef) return aDef - bDef;
    return b.ratePercent - a.ratePercent || a.name.localeCompare(b.name);
  });
  const orderedRows: CommissionPdfRow[] = [];

  type SummaryCell =
    | string
    | { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const summaryBody: SummaryCell[][] = [];
  const groupHeaderIdx = new Set<number>();
  const groupTotalIdx = new Set<number>();
  for (const g of groups) {
    const rows = [...g.rows].sort((a, b) => b.revenue - a.revenue);
    orderedRows.push(...rows);
    groupHeaderIdx.add(summaryBody.length);
    summaryBody.push([
      {
        content: `${g.name}  -  ${pct(g.ratePercent)}`,
        colSpan: 6,
        styles: { fontStyle: "bold", fillColor: SUBHEAD_FILL, textColor: BAR_FILL },
      },
    ]);
    for (const r of rows) {
      summaryBody.push([
        r.customerName,
        r.rateTypeName,
        pct(r.ratePercent),
        String(r.invoiceCount),
        money(r.revenue),
        money(r.commission),
      ]);
    }
    if (groups.length > 1) {
      groupTotalIdx.add(summaryBody.length);
      summaryBody.push([
        `${g.name} subtotal`,
        "",
        "",
        String(rows.reduce((s, r) => s + r.invoiceCount, 0)),
        money(rows.reduce((s, r) => s + r.revenue, 0)),
        money(rows.reduce((s, r) => s + r.commission, 0)),
      ]);
    }
  }
  summaryBody.push([
    "Total",
    "",
    "",
    String(input.rows.reduce((s, r) => s + r.invoiceCount, 0)),
    money(input.totalRevenue),
    money(input.totalCommission),
  ]);

  autoTable(doc, {
    startY: boxTop + boxH + 18,
    margin: { left: margin, right: margin },
    head: [["Customer", "Rate Type", "Rate", "Invoices", "Revenue", "Commission"]],
    body: summaryBody,
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 },
      lineWidth: 0,
    },
    headStyles: {
      fillColor: BAR_FILL,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8.5,
    },
    columnStyles: {
      0: { cellWidth: 170 },
      1: { cellWidth: 110 },
      2: { halign: "right", cellWidth: 45 },
      3: { halign: "right", cellWidth: 50 },
      4: { halign: "right" },
      5: { halign: "right" },
    },
    alternateRowStyles: { fillColor: ZEBRA_FILL },
    didParseCell: (data: {
      section: string;
      row: { index: number };
      cell: { styles: Record<string, unknown> };
    }) => {
      if (data.section !== "body") return;
      // Grand total (last row) and per-group subtotals in bold; group
      // subtotals stay light so the section headers read as the dividers.
      if (data.row.index === summaryBody.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = SUBHEAD_FILL;
      } else if (groupTotalIdx.has(data.row.index)) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [255, 255, 255];
      } else if (groupHeaderIdx.has(data.row.index)) {
        data.cell.styles.fillColor = SUBHEAD_FILL;
      }
    },
  });

  // ── Invoice detail (same rate-group order as the summary) ───────────
  const detailBody: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = [];
  for (const r of orderedRows) {
    const invoices = r.invoices ?? [];
    if (invoices.length === 0) continue;
    detailBody.push([
      {
        content: `${r.customerName}   (${pct(r.ratePercent)})`,
        colSpan: 4,
        styles: {
          fontStyle: "bold",
          fillColor: SUBHEAD_FILL,
          textColor: BAR_FILL,
        },
      },
    ]);
    for (const inv of invoices) {
      detailBody.push([
        inv.invoiceNumber,
        fmtDate(inv.invoiceDate),
        inv.status,
        money(inv.subtotal),
      ]);
    }
  }

  if (detailBody.length > 0) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text("Invoice Detail", margin, 42);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED_TEXT);
    doc.text(
      `${input.entityName}  -  ${input.salespersonName}  -  ${input.periodLabel}`,
      margin,
      55,
    );

    autoTable(doc, {
      startY: 66,
      margin: { left: margin, right: margin },
      head: [["Invoice #", "Date", "Status", "Subtotal"]],
      body: detailBody,
      theme: "plain",
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: { top: 3, bottom: 3, left: 5, right: 5 },
        lineWidth: 0,
      },
      headStyles: {
        fillColor: BAR_FILL,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
      },
      columnStyles: {
        0: { cellWidth: 120 },
        1: { cellWidth: 90 },
        2: { cellWidth: 90 },
        3: { halign: "right" },
      },
    });
  }

  // ── Page footer ──────────────────────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED_TEXT);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 24,
      { align: "right" },
    );
  }

  doc.save(
    input.filename.endsWith(".pdf") ? input.filename : `${input.filename}.pdf`,
  );
}
