"use client";

/**
 * Monthly sales commission statement PDF — the deliverable the contract's
 * payment clause requires: gross revenue in reasonable detail, all
 * exclusions, and the fee calculation. Per-customer summary first, then
 * invoice-level backup grouped by customer.
 *
 * Conventions follow monthly-summary-pdf.ts / debt-pdf.ts: portrait letter,
 * jsPDF + jspdf-autotable via dynamic import, ASCII-only glyphs so
 * Helvetica's WinAnsi encoding renders cleanly.
 */

const BAR_FILL: [number, number, number] = [31, 58, 95]; // deep navy, matches Excel
const SUBHEAD_FILL: [number, number, number] = [232, 236, 241];
const MUTED_TEXT: [number, number, number] = [110, 110, 110];
const ZEBRA_FILL: [number, number, number] = [247, 249, 252];

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

  // ── Title block ──────────────────────────────────────────────────────
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(input.entityName, margin, 42);

  doc.setFontSize(12);
  doc.text(
    `Sales Commission Statement  -  ${input.salespersonName}`,
    margin,
    60,
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(input.periodLabel, margin, 75);

  doc.setFontSize(8);
  doc.setTextColor(...MUTED_TEXT);
  const basisBits = [
    "Base: RentalWorks invoice subtotal (pre-tax), by invoice date",
    input.commissionStartDate
      ? `orders placed on/after ${fmtDate(input.commissionStartDate)} only`
      : null,
    `generated ${new Date().toLocaleDateString("en-US")}`,
  ]
    .filter(Boolean)
    .join("   -   ");
  doc.text(basisBits, margin, 88);

  // ── Totals band ──────────────────────────────────────────────────────
  doc.setFillColor(...SUBHEAD_FILL);
  doc.rect(margin, 98, pageWidth - margin * 2, 30, "F");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.text("Commissionable Revenue", margin + 10, 110);
  doc.text("Total Commission Due", margin + 200, 110);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(money(input.totalRevenue), margin + 10, 123);
  doc.text(money(input.totalCommission), margin + 200, 123);

  // ── Per-customer summary ─────────────────────────────────────────────
  const summaryBody = input.rows.map((r) => [
    r.customerName,
    r.rateTypeName + (r.assigned ? "" : " (default)"),
    pct(r.ratePercent),
    String(r.invoiceCount),
    money(r.revenue),
    money(r.commission),
  ]);
  summaryBody.push([
    "Total",
    "",
    "",
    String(input.rows.reduce((s, r) => s + r.invoiceCount, 0)),
    money(input.totalRevenue),
    money(input.totalCommission),
  ]);

  autoTable(doc, {
    startY: 140,
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
      // Bold totals row (last body row) with a top rule feel.
      if (data.section === "body" && data.row.index === summaryBody.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = SUBHEAD_FILL;
      }
    },
  });

  const afterSummaryY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable
      .finalY;

  // ── Exclusion notes ──────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED_TEXT);
  const notes: string[] = [
    "Customers without an assigned rate type flow into the default rate. Customers at 0% are excluded accounts and earn no fee.",
    "VOID, no-charge, and non-billable invoices are excluded from the base.",
  ];
  if (input.beforeStartCount > 0) {
    notes.push(
      `${input.beforeStartCount} invoice${input.beforeStartCount === 1 ? "" : "s"} excluded because the underlying order was placed before the commission start date.`,
    );
  }
  let noteY = afterSummaryY + 14;
  for (const n of notes) {
    doc.text(n, margin, noteY, { maxWidth: pageWidth - margin * 2 });
    noteY += 11;
  }

  // ── Invoice detail ───────────────────────────────────────────────────
  const detailBody: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = [];
  for (const r of input.rows) {
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
      `${input.entityName} - Commission Statement - ${input.periodLabel}`,
      margin,
      doc.internal.pageSize.getHeight() - 24,
    );
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
