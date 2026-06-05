// On-demand quote PDF for the HDR Sales CRM. We persist the quote DATA (number,
// line items, totals) in rental_inquiry_quotes and regenerate an identical,
// branded PDF here whenever any rep clicks "Download PDF" on the deal — so there
// is no binary to store and edits always produce a clean document.
//
// jsPDF + jspdf-autotable are already in the bundle (used by the debt + financial
// PDFs), imported dynamically so they stay out of the initial page load. Rendered
// strings are ASCII-only: jsPDF's bundled Helvetica uses WinAnsi encoding, so we
// stick to hyphen-minus and plain words (em/en dashes are in WinAnsi and fine).

import { type Inquiry, fmtDate } from "@/lib/inquiries/shared";

// The minimal shape this renderer needs — satisfied by a saved InquiryQuote or a
// freshly-computed draft before it is persisted.
export interface QuotePdfDoc {
  quote_number: string;
  status?: string;
  lines: { description: string; qty: number; rate: number }[];
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  valid_until?: string | null;
  terms?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

// HDR brand block printed on every quote. Mirrors the canonical brand/HQ.
const BRAND = {
  name: "Hollywood Depot Rentals",
  email: "sales@hdrsiteservices.com",
  site: "hdrsiteservices.com",
  addr1: "12580 Saticoy St",
  addr2: "North Hollywood, CA 91605",
};

// Money with cents, comma-grouped. Accounting-safe ASCII ($1,250.00).
function money(n: number): string {
  const v = Number(n) || 0;
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function todayLong(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Build the jsPDF document (portrait letter) from a quote + its inquiry.
async function buildQuoteDoc(quote: QuotePdfDoc, inquiry: Inquiry) {
  const { default: jsPDF } = await import("jspdf");
  const autoTableMod = await import("jspdf-autotable");
  const autoTable = (autoTableMod.default ?? autoTableMod) as unknown as (
    doc: InstanceType<typeof jsPDF>,
    opts: Record<string, unknown>
  ) => void;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  const right = pageWidth - margin;

  // ─── Header band ──────────────────────────────────────────────────────────
  doc.setFillColor(40, 69, 240); // HDR blue (#2845F0)
  doc.rect(0, 0, pageWidth, 92, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text(BRAND.name, margin, 40);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(BRAND.addr1, margin, 58);
  doc.text(BRAND.addr2, margin, 71);
  doc.text(`${BRAND.email}  ·  ${BRAND.site}`, margin, 84);

  // "QUOTE" + number, right-aligned in the band.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text("QUOTE", right, 42, { align: "right" });
  doc.setFontSize(12);
  doc.text(quote.quote_number, right, 62, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(`Date: ${todayLong()}`, right, 78, { align: "right" });
  if (quote.valid_until) {
    doc.text(
      `Valid until: ${fmtDate(quote.valid_until, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })}`,
      right,
      90,
      { align: "right" }
    );
  }

  // ─── Bill-to ──────────────────────────────────────────────────────────────
  let y = 128;
  doc.setTextColor(120, 120, 120);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("PREPARED FOR", margin, y);

  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  y += 16;
  doc.text(inquiry.name || "Customer", margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(70, 70, 70);
  const contact = [inquiry.email, inquiry.phone].filter(Boolean).join("  ·  ");
  if (contact) {
    y += 14;
    doc.text(contact, margin, y);
  }

  // Reference + what they asked for, on the right side of the bill-to row.
  doc.setFontSize(9.5);
  doc.setTextColor(70, 70, 70);
  let ry = 128;
  const rline = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, right - 200, ry, { align: "left" });
    doc.setFont("helvetica", "normal");
    doc.text(value, right, ry, { align: "right" });
    ry += 14;
  };
  rline("Inquiry", inquiry.reference || "-");
  if (inquiry.use_case) rline("Event / use", String(inquiry.use_case).slice(0, 32));
  const dates = inquiry.start_date
    ? fmtDate(inquiry.start_date, { month: "short", day: "numeric", year: "numeric" })
    : "";
  if (dates) rline("Dates", dates);
  if (inquiry.location) rline("Location", String(inquiry.location).slice(0, 32));

  // ─── Line-item table ──────────────────────────────────────────────────────
  const tableTop = Math.max(y, ry) + 20;
  const activeLines = quote.lines.filter(
    (l) => (l.description && l.description.trim() !== "") || Number(l.rate) > 0
  );
  const bodyRows = activeLines.map((l) => {
    const qty = Number(l.qty) || 0;
    const rate = Number(l.rate) || 0;
    return [
      l.description?.trim() || "Item",
      String(qty || 1),
      money(rate),
      money((qty || 0) * rate),
    ];
  });

  autoTable(doc, {
    startY: tableTop,
    head: [["Description", "Qty", "Rate", "Amount"]],
    body: bodyRows.length ? bodyRows : [["No line items", "", "", ""]],
    margin: { left: margin, right: margin },
    styles: { font: "helvetica", fontSize: 10, cellPadding: 7, textColor: [30, 30, 30] },
    headStyles: {
      fillColor: [17, 24, 39],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "left",
    },
    columnStyles: {
      0: { cellWidth: "auto", halign: "left" },
      1: { cellWidth: 48, halign: "center" },
      2: { cellWidth: 90, halign: "right" },
      3: { cellWidth: 100, halign: "right" },
    },
    alternateRowStyles: { fillColor: [246, 247, 250] },
  });

  // jspdf-autotable stashes the ending Y on the doc instance.
  const docWithTable = doc as unknown as { lastAutoTable?: { finalY: number } };
  let ty = (docWithTable.lastAutoTable?.finalY ?? tableTop) + 16;

  // ─── Totals ───────────────────────────────────────────────────────────────
  const labelX = right - 200;
  const totalRow = (label: string, value: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 12 : 10);
    doc.setTextColor(bold ? 20 : 70, bold ? 20 : 70, bold ? 20 : 70);
    doc.text(label, labelX, ty, { align: "left" });
    doc.text(value, right, ty, { align: "right" });
    ty += bold ? 20 : 16;
  };
  totalRow("Subtotal", money(quote.subtotal));
  if (Number(quote.tax_rate) > 0 || Number(quote.tax) > 0) {
    totalRow(`Tax (${Number(quote.tax_rate) || 0}%)`, money(quote.tax));
  }
  // Divider above the grand total.
  doc.setDrawColor(210, 210, 210);
  doc.line(labelX, ty - 8, right, ty - 8);
  totalRow("Total", money(quote.total), true);

  // ─── Terms / notes ────────────────────────────────────────────────────────
  ty += 10;
  const termsText =
    (quote.terms && quote.terms.trim()) ||
    "Quote includes delivery, setup, and servicing. Pricing is held for 14 days. " +
      "Reply to confirm and we will hold your date.";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text("TERMS", margin, ty);
  ty += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(70, 70, 70);
  const wrapped = doc.splitTextToSize(termsText, right - margin) as string[];
  doc.text(wrapped, margin, ty);
  ty += wrapped.length * 12 + 16;

  // ─── Footer ───────────────────────────────────────────────────────────────
  doc.setDrawColor(225, 225, 225);
  doc.line(margin, ty, right, ty);
  ty += 14;
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  const preparedBy = quote.created_by && quote.created_by !== "You" ? quote.created_by : null;
  doc.text(
    `Thank you for considering ${BRAND.name}.${preparedBy ? `  Prepared by ${preparedBy}.` : ""}`,
    margin,
    ty
  );

  return doc;
}

// Trigger a browser download of the quote PDF (filename = the quote number).
export async function downloadQuotePdf(quote: QuotePdfDoc, inquiry: Inquiry): Promise<void> {
  const doc = await buildQuoteDoc(quote, inquiry);
  doc.save(`${quote.quote_number}.pdf`);
}
