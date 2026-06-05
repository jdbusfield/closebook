// On-demand quote PDF for the HDR Sales CRM. We persist the quote DATA (number,
// line items, totals) in rental_inquiry_quotes and regenerate the PDF here on
// demand, so there is no binary to store and edits always produce a clean doc.
//
// The layout is modeled on HDR's RentalWorks rental-order document — structured
// masthead (logo + company block, centered RENTAL/QUOTE, a boxed No./Date),
// tinted label/value info grids, "Issued To / Location / Dates" section bars, a
// boxed line-item table, and highlighted total bars — re-skinned in the HDR
// brand (cobalt #2845F0 + the cobalt HDR bubble logo).
//
// jsPDF + jspdf-autotable are already in the bundle (debt + financial PDFs),
// imported dynamically so they stay out of the initial page load. Rendered
// strings are ASCII-only (jsPDF's Helvetica is WinAnsi-encoded).

import { type Inquiry, fmtDate } from "@/lib/inquiries/shared";
import { HDR_LOGO_DATA_URL } from "@/lib/inquiries/hdr-logo";

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

const BRAND = {
  name: "Hollywood Depot Rentals",
  phone: "(818) 845-8077",
  email: "sales@hdrsiteservices.com",
  site: "hdrsiteservices.com",
  addr1: "12580 Saticoy St",
  addr2: "North Hollywood, CA 91605",
};

// Palette — HDR cobalt re-skin of the RentalWorks order's blue chrome.
const COBALT = [40, 69, 240] as const; // --hdr-500, headings + number + rule
const TINT = [221, 228, 252] as const; // section bars (light cobalt)
const TINT_SOFT = [241, 243, 255] as const; // --hdr-050, label cells
const AMOUNT_HL = [255, 250, 209] as const; // pale gold grand-total highlight (echoes the source)
const INK = [11, 19, 32] as const; // --ink-900, body text
const MUTED = [68, 80, 122] as const; // --ink-500
const SUBTLE = [107, 117, 150] as const; // --ink-400
const BORDER = [197, 202, 216] as const; // --ink-200, cell borders
const HAIR = [228, 231, 238] as const; // --ink-100, row hairlines

function money(n: number): string {
  const v = Number(n) || 0;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayLong(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type RGB = readonly [number, number, number];
type Doc = {
  setFont: (f: string, s?: string) => void;
  setFontSize: (n: number) => void;
  getTextWidth: (t: string) => number;
  setTextColor: (r: number, g: number, b: number) => void;
  setFillColor: (r: number, g: number, b: number) => void;
  setDrawColor: (r: number, g: number, b: number) => void;
  setLineWidth: (n: number) => void;
  setLineDashPattern: (pattern: number[], phase: number) => void;
  rect: (x: number, y: number, w: number, h: number, s?: string) => void;
  line: (x1: number, y1: number, x2: number, y2: number) => void;
  text: (t: string | string[], x: number, y: number, o?: Record<string, unknown>) => void;
  splitTextToSize: (t: string, w: number) => string[];
  addImage: (d: string, f: string, x: number, y: number, w: number, h: number) => void;
};

function setFill(d: Doc, c: RGB) {
  d.setFillColor(c[0], c[1], c[2]);
}
function setText(d: Doc, c: RGB) {
  d.setTextColor(c[0], c[1], c[2]);
}
function setDraw(d: Doc, c: RGB) {
  d.setDrawColor(c[0], c[1], c[2]);
}

async function buildQuoteDoc(quote: QuotePdfDoc, inquiry: Inquiry) {
  const { default: jsPDF } = await import("jspdf");
  const autoTableMod = await import("jspdf-autotable");
  const autoTable = (autoTableMod.default ?? autoTableMod) as unknown as (
    doc: InstanceType<typeof jsPDF>,
    opts: Record<string, unknown>
  ) => void;

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const d = doc as unknown as Doc;
  const margin = 40;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const right = pageWidth - margin;
  const usable = right - margin;
  const center = pageWidth / 2;

  // ─── Masthead ─────────────────────────────────────────────────────────────
  try {
    d.addImage(HDR_LOGO_DATA_URL, "JPEG", margin, 28, 52, 52);
  } catch {
    /* decorative — skip if the embed fails */
  }

  // Centered RENTAL / QUOTE.
  d.setFont("helvetica", "bold");
  d.setFontSize(10);
  setText(d, INK);
  d.text("RENTAL", center, 50, { align: "center", charSpace: 1 });
  d.setFontSize(23);
  setText(d, COBALT);
  d.text("QUOTE", center, 76, { align: "center", charSpace: 1 });

  // Right: No. box + Date / Valid.
  const labelRX = right - 124;
  d.setFont("helvetica", "bold");
  d.setFontSize(9);
  setText(d, INK);
  d.text("No:", labelRX, 47, { align: "right" });
  setFill(d, TINT_SOFT);
  setDraw(d, COBALT);
  d.setLineWidth(0.8);
  d.rect(labelRX + 8, 35, 116, 18, "FD");
  d.setFont("helvetica", "bold");
  d.setFontSize(12);
  setText(d, COBALT);
  d.text(quote.quote_number, right - 6, 47.5, { align: "right" });

  d.setFont("helvetica", "bold");
  d.setFontSize(9);
  setText(d, INK);
  d.text("Date:", labelRX, 68, { align: "right" });
  d.setFont("helvetica", "normal");
  setText(d, MUTED);
  d.text(todayLong(), labelRX + 10, 68);
  if (quote.valid_until) {
    d.setFont("helvetica", "bold");
    setText(d, INK);
    d.text("Valid:", labelRX, 82, { align: "right" });
    d.setFont("helvetica", "normal");
    setText(d, MUTED);
    d.text(fmtDate(quote.valid_until, { month: "short", day: "numeric", year: "numeric" }), labelRX + 10, 82);
  }

  // Company block, under the logo.
  d.setFont("helvetica", "bold");
  d.setFontSize(9.5);
  setText(d, INK);
  d.text(BRAND.name, margin, 100);
  d.setFont("helvetica", "normal");
  d.setFontSize(8);
  setText(d, MUTED);
  d.text(BRAND.addr1, margin, 111);
  d.text(BRAND.addr2, margin, 121);
  d.text(`Phone: ${BRAND.phone}`, margin, 131);

  // Masthead rule.
  setDraw(d, COBALT);
  d.setLineWidth(1.4);
  d.line(margin, 142, right, 142);

  // ─── Info grid (3 columns of tinted label / value rows) ───────────────────
  const cols = [
    { x: margin, w: 180 },
    { x: margin + 188, w: 168 },
    { x: margin + 366, w: usable - 366 },
  ];
  const labelW = 60;
  const field = (colX: number, y: number, label: string, value: string) => {
    setFill(d, TINT_SOFT);
    d.rect(colX, y - 9.5, labelW, 13, "F");
    d.setFont("helvetica", "bold");
    d.setFontSize(7.5);
    setText(d, INK);
    d.text(label, colX + 3, y);
    d.setFont("helvetica", "normal");
    d.setFontSize(8.5);
    setText(d, INK);
    const v = d.splitTextToSize(value || "-", 999)[0];
    d.text(v, colX + labelW + 5, y);
  };

  const gy = 162;
  const agent = quote.created_by && quote.created_by !== "You" ? quote.created_by : "HDR Team";
  // Column 1
  field(cols[0].x, gy, "Quote", quote.quote_number);
  field(cols[0].x, gy + 15, "Customer", inquiry.name || "Customer");
  field(cols[0].x, gy + 30, "Reference", inquiry.reference || "-");
  // Column 2
  field(cols[1].x, gy, "Agent", agent);
  field(cols[1].x, gy + 15, "Email", inquiry.email || "-");
  field(cols[1].x, gy + 30, "Phone", inquiry.phone || "-");
  // Column 3
  field(cols[2].x, gy, "Date", todayLong());
  field(cols[2].x, gy + 15, "Valid", quote.valid_until
    ? fmtDate(quote.valid_until, { month: "short", day: "numeric", year: "numeric" })
    : "14 days");
  field(cols[2].x, gy + 30, "Terms", "Due on acceptance");

  // ─── Section bars: Issued To / Event Location / Rental Dates ───────────────
  const by = gy + 52;
  const bar = (colX: number, w: number, title: string) => {
    setFill(d, TINT);
    d.rect(colX, by, w, 15, "F");
    d.setFont("helvetica", "bold");
    d.setFontSize(8);
    setText(d, INK);
    d.text(title, colX + 5, by + 10.3);
  };
  bar(cols[0].x, cols[0].w, "Issued To");
  bar(cols[1].x, cols[1].w, "Event Location");
  bar(cols[2].x, cols[2].w, "Rental Dates");

  const cy = by + 28;
  // Issued To
  d.setFont("helvetica", "bold");
  d.setFontSize(9);
  setText(d, INK);
  d.text(inquiry.name || "Customer", cols[0].x, cy);
  d.setFont("helvetica", "normal");
  d.setFontSize(8);
  setText(d, MUTED);
  if (inquiry.email) d.text(inquiry.email, cols[0].x, cy + 11);
  if (inquiry.phone) d.text(inquiry.phone, cols[0].x, cy + 21);
  // Event Location
  d.setFont("helvetica", "normal");
  d.setFontSize(9);
  setText(d, INK);
  d.text(String(inquiry.location || "TBD"), cols[1].x, cy);
  if (inquiry.use_case) {
    d.setFontSize(8);
    setText(d, MUTED);
    d.text(String(inquiry.use_case), cols[1].x, cy + 11);
  }
  // Rental Dates
  d.setFont("helvetica", "normal");
  d.setFontSize(9);
  setText(d, INK);
  const dateRange = inquiry.start_date
    ? `${fmtDate(inquiry.start_date, { month: "short", day: "numeric", year: "numeric" })}${
        inquiry.end_date ? ` - ${fmtDate(inquiry.end_date, { month: "short", day: "numeric", year: "numeric" })}` : ""
      }`
    : "TBD";
  d.text(dateRange, cols[2].x, cy);
  if (inquiry.duration) {
    d.setFontSize(8);
    setText(d, MUTED);
    d.text(String(inquiry.duration), cols[2].x, cy + 11);
  }

  // ─── Line-item section heading (boxed, dashed cobalt) ─────────────────────
  const headBoxY = cy + 30;
  setDraw(d, COBALT);
  d.setLineWidth(0.8);
  d.setLineDashPattern([2, 2], 0);
  d.rect(margin, headBoxY, usable, 22);
  d.setLineDashPattern([], 0);
  d.setFont("helvetica", "bold");
  d.setFontSize(14);
  setText(d, COBALT);
  d.text("QUOTE", margin + 8, headBoxY + 16);
  d.setFont("helvetica", "bold");
  d.setFontSize(7.5);
  setText(d, SUBTLE);
  d.text("ITEMIZED RENTAL", right - 12, headBoxY + 14.5, { align: "right", charSpace: 0.5 });

  // ─── Line items table ─────────────────────────────────────────────────────
  const activeLines = quote.lines.filter(
    (l) => (l.description && l.description.trim() !== "") || Number(l.rate) > 0
  );
  const bodyRows = activeLines.map((l) => {
    const qty = Number(l.qty) || 0;
    const rate = Number(l.rate) || 0;
    return [l.description?.trim() || "Item", String(qty || 1), money(rate), money((qty || 0) * rate)];
  });

  autoTable(doc, {
    startY: headBoxY + 30,
    head: [["DESCRIPTION", "QTY", "RATE", "AMOUNT"]],
    body: bodyRows.length ? bodyRows : [["No line items", "", "", ""]],
    margin: { left: margin, right: margin },
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 9.5,
      cellPadding: { top: 6, bottom: 6, left: 4, right: 4 },
      textColor: [INK[0], INK[1], INK[2]],
      lineColor: [HAIR[0], HAIR[1], HAIR[2]],
      lineWidth: { bottom: 0.4 },
    },
    headStyles: {
      fillColor: [TINT[0], TINT[1], TINT[2]],
      textColor: [INK[0], INK[1], INK[2]],
      fontStyle: "bold",
      fontSize: 8,
      cellPadding: { top: 5, bottom: 5, left: 4, right: 4 },
      lineColor: [COBALT[0], COBALT[1], COBALT[2]],
      lineWidth: { bottom: 0.8 },
    },
    columnStyles: {
      0: { cellWidth: "auto", halign: "left" },
      1: { cellWidth: 50, halign: "right" },
      2: { cellWidth: 92, halign: "right" },
      3: { cellWidth: 100, halign: "right" },
    },
  });

  const docWithTable = doc as unknown as { lastAutoTable?: { finalY: number } };
  let ty = (docWithTable.lastAutoTable?.finalY ?? headBoxY + 30) + 12;

  // ─── Total bars (right-aligned, 2-cell boxed rows) ────────────────────────
  const tw = 250;
  const tx = right - tw;
  const tlw = 150;
  const totalBar = (label: string, value: string, opts?: { strong?: boolean; hl?: boolean }) => {
    const h = opts?.strong ? 19 : 16;
    setFill(d, opts?.strong ? TINT : TINT_SOFT);
    d.rect(tx, ty, tlw, h, "F");
    if (opts?.hl) {
      setFill(d, AMOUNT_HL);
      d.rect(tx + tlw, ty, tw - tlw, h, "F");
    }
    setDraw(d, BORDER);
    d.setLineWidth(0.5);
    d.rect(tx, ty, tw, h);
    d.line(tx + tlw, ty, tx + tlw, ty + h);
    d.setFont("helvetica", "bold");
    d.setFontSize(opts?.strong ? 10.5 : 9);
    setText(d, INK);
    d.text(label, tx + 6, ty + h / 2 + 3.2);
    d.setFont("helvetica", opts?.strong ? "bold" : "normal");
    d.setFontSize(opts?.strong ? 11 : 9.5);
    d.text(value, right - 6, ty + h / 2 + 3.2, { align: "right" });
    ty += h;
  };
  totalBar("Subtotal", money(quote.subtotal));
  if (Number(quote.tax_rate) > 0 || Number(quote.tax) > 0) {
    totalBar(`Tax (${Number(quote.tax_rate) || 0}%)`, money(quote.tax));
  }
  ty += 2;
  totalBar("Quote Total", money(quote.total), { strong: true, hl: true });

  // ─── Terms ────────────────────────────────────────────────────────────────
  ty += 26;
  d.setFont("helvetica", "bold");
  d.setFontSize(8);
  setText(d, INK);
  d.text("TERMS", margin, ty, { charSpace: 0.8 });
  ty += 13;
  const termsText =
    (quote.terms && quote.terms.trim()) ||
    "Quote includes delivery, setup, and servicing. Pricing is held for 14 days. " +
      "Reply to confirm and we will hold your date.";
  d.setFont("helvetica", "normal");
  d.setFontSize(9);
  setText(d, MUTED);
  const wrapped = d.splitTextToSize(termsText, usable);
  d.text(wrapped, margin, ty);

  // ─── Footer (pinned near the bottom) ──────────────────────────────────────
  const fy = pageHeight - 40;
  setFill(d, HAIR);
  d.rect(margin, fy - 12, usable, 0.6, "F");
  d.setFont("helvetica", "normal");
  d.setFontSize(8);
  setText(d, SUBTLE);
  d.text(`${BRAND.name}   ·   ${BRAND.phone}   ·   ${BRAND.email}   ·   ${BRAND.site}`, center, fy, {
    align: "center",
  });

  return doc;
}

// Trigger a browser download of the quote PDF (filename = the quote number).
export async function downloadQuotePdf(quote: QuotePdfDoc, inquiry: Inquiry): Promise<void> {
  const doc = await buildQuoteDoc(quote, inquiry);
  doc.save(`${quote.quote_number}.pdf`);
}
