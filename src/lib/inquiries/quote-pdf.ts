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
import { VERSATILE_LOGO_DATA_URL } from "@/lib/inquiries/versatile-logo";

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
  /** When set (with status "accepted"), the PDF renders as an order confirmation. */
  accepted_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

// Per-brand identity + accent palette. The renderer picks one per document by
// the inquiry's brand (Versatile vs HDR) so a Versatile lead prints a Versatile-
// branded quote/invoice and an HDR lead prints HDR's. HDR is the default, so
// existing HDR output is byte-for-byte unchanged.
interface BrandTheme {
  name: string;
  phone: string;
  email: string;
  site: string;
  addr1: string;
  addr2: string;
  team: string;
  logo: string;
  cobalt: readonly [number, number, number]; // accent: headings, number, rules
  tint: readonly [number, number, number]; // section bars
  tintSoft: readonly [number, number, number]; // label cells
}

const THEMES: Record<"hdr" | "versatile", BrandTheme> = {
  // HDR cobalt re-skin of the RentalWorks order's blue chrome.
  hdr: {
    name: "Hollywood Depot Rentals",
    phone: "(818) 845-8077",
    email: "sales@hdrsiteservices.com",
    site: "hdrsiteservices.com",
    addr1: "12580 Saticoy St",
    addr2: "North Hollywood, CA 91605",
    team: "HDR Team",
    logo: HDR_LOGO_DATA_URL,
    cobalt: [40, 69, 240], // --hdr-500
    tint: [221, 228, 252], // light cobalt
    tintSoft: [241, 243, 255], // --hdr-050
  },
  // Versatile Studios brand red (#d2232a), Cahuenga Blvd address.
  versatile: {
    name: "Versatile Studios",
    phone: "(213) 935-8124",
    email: "rentals@versatilestudios.com",
    site: "versatilestudios.com",
    addr1: "1000 N Cahuenga Blvd",
    addr2: "Los Angeles, CA 90038",
    team: "Versatile Team",
    logo: VERSATILE_LOGO_DATA_URL,
    cobalt: [210, 35, 42], // #d2232a
    tint: [248, 220, 221], // light red
    tintSoft: [253, 242, 242], // very light red
  },
};

// Pick the brand by the inquiry: website/ads leads carry source "versatile", and
// every Versatile inquiry (incl. rep-created) gets a "VS-" reference — either
// signal selects Versatile; anything else stays HDR (the default).
function pickTheme(inquiry: Inquiry): BrandTheme {
  const isVersatile =
    (inquiry.source || "").toLowerCase() === "versatile" ||
    /^VS-/i.test(inquiry.reference || "");
  return isVersatile ? THEMES.versatile : THEMES.hdr;
}

// Palette — brand-neutral chrome shared by both themes.
const GREEN = [21, 128, 61] as const; // accepted treatment (emerald-700)
const GREEN_TINT = [220, 252, 231] as const; // pale green fill for accepted bars
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

export type QuoteDocVariant = "quote" | "invoice";

// Derive an invoice number from the quote number so the two docs are visibly
// related, preserving the brand prefix (HDR-Q1010 → HDR-INV1010, VS-Q1010 →
// VS-INV1010); falls back to an INV- prefix.
function invoiceNumberFor(quoteNumber: string): string {
  if (/-Q\d/i.test(quoteNumber)) return quoteNumber.replace(/-Q/i, "-INV");
  return `INV-${quoteNumber}`;
}

export async function buildQuoteDoc(
  quote: QuotePdfDoc,
  inquiry: Inquiry,
  variant: QuoteDocVariant = "quote"
) {
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

  // Brand the document by the inquiry (Versatile vs HDR). These shadow the old
  // module-level constants, so every reference below uses the selected brand.
  const BRAND = pickTheme(inquiry);
  const COBALT = BRAND.cobalt;
  const TINT = BRAND.tint;
  const TINT_SOFT = BRAND.tintSoft;
  const LOGO = BRAND.logo;
  const TEAM = BRAND.team;

  // Accepted variant: same document, re-chromed as a confirmation the rep can
  // send back to the customer — green ACCEPTED stamp, acceptance date in place
  // of the validity window, and confirmation terms.
  // Invoice variant: the same branded layout, re-titled INVOICE with an invoice
  // number, an "Amount Due" total, and payment terms. Generated from an accepted
  // quote so the figures match exactly. The accepted-quote (green confirmation)
  // treatment only applies to the quote variant.
  const isInvoice = variant === "invoice";
  const accepted = !isInvoice && quote.status === "accepted";
  const docNumber = isInvoice ? invoiceNumberFor(quote.quote_number) : quote.quote_number;
  // Bill-to override: the quote/invoice is issued in billing_name + billing_address
  // when set, otherwise the inquiry's own contact name. Address is free-form,
  // split into trimmed non-empty lines for the Issued To block.
  const billTo = inquiry.billing_name || inquiry.name || "Customer";
  const billAddrLines = (inquiry.billing_address || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const acceptedDate = quote.accepted_at
    ? fmtDate(quote.accepted_at, { month: "short", day: "numeric", year: "numeric" })
    : todayLong();

  // ─── Masthead ─────────────────────────────────────────────────────────────
  try {
    d.addImage(LOGO, "JPEG", margin, 28, 52, 52);
  } catch {
    /* decorative — skip if the embed fails */
  }

  // Centered RENTAL / QUOTE | INVOICE.
  d.setFont("helvetica", "bold");
  d.setFontSize(10);
  setText(d, INK);
  d.text("RENTAL", center, 50, { align: "center", charSpace: 1 });
  d.setFontSize(23);
  setText(d, COBALT);
  d.text(isInvoice ? "INVOICE" : "QUOTE", center, 76, { align: "center", charSpace: 1 });

  // Green ACCEPTED stamp under the title.
  if (accepted) {
    const stamp = `ACCEPTED  ·  ${acceptedDate}`;
    d.setFont("helvetica", "bold");
    d.setFontSize(9);
    // getTextWidth ignores charSpace — pad enough that the tracked text clears
    // the box on both sides.
    const sw = d.getTextWidth(stamp) + 40;
    setFill(d, GREEN_TINT);
    setDraw(d, GREEN);
    d.setLineWidth(1);
    d.rect(center - sw / 2, 86, sw, 17, "FD");
    setText(d, GREEN);
    d.text(stamp, center, 97.5, { align: "center", charSpace: 0.6 });
  }

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
  d.text(docNumber, right - 6, 47.5, { align: "right" });

  d.setFont("helvetica", "bold");
  d.setFontSize(9);
  setText(d, INK);
  d.text("Date:", labelRX, 68, { align: "right" });
  d.setFont("helvetica", "normal");
  setText(d, MUTED);
  d.text(todayLong(), labelRX + 10, 68);
  if (isInvoice) {
    d.setFont("helvetica", "bold");
    setText(d, INK);
    d.text("Due:", labelRX, 82, { align: "right" });
    d.setFont("helvetica", "normal");
    setText(d, MUTED);
    d.text("On receipt", labelRX + 10, 82);
  } else if (accepted) {
    d.setFont("helvetica", "bold");
    setText(d, GREEN);
    d.text("Accepted:", labelRX, 82, { align: "right" });
    d.setFont("helvetica", "normal");
    setText(d, MUTED);
    d.text(acceptedDate, labelRX + 10, 82);
  } else if (quote.valid_until) {
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
  // A label/value row. By default the value is a single clipped line; pass
  // `wrapColW` (the column's full width) to let a long value wrap onto a second
  // line within the column instead of overrunning into the next one. Only use
  // wrapping on a column's BOTTOM row — the second line drops into the gap above
  // the section bars, so wrapping a middle row would collide with the row below.
  const field = (
    colX: number,
    y: number,
    label: string,
    value: string,
    wrapColW?: number
  ) => {
    setFill(d, TINT_SOFT);
    d.rect(colX, y - 9.5, labelW, 13, "F");
    d.setFont("helvetica", "bold");
    d.setFontSize(7.5);
    setText(d, INK);
    d.text(label, colX + 3, y);
    d.setFont("helvetica", "normal");
    d.setFontSize(8.5);
    setText(d, INK);
    const valX = colX + labelW + 5;
    const maxW = wrapColW ? wrapColW - labelW - 8 : 999;
    const lines = d.splitTextToSize(value || "-", maxW).slice(0, 2);
    lines.forEach((ln: string, i: number) => d.text(ln, valX, y + i * 9));
  };

  const gy = 162;
  const agent = quote.created_by && quote.created_by !== "You" ? quote.created_by : TEAM;
  // Column 1 — Customer last so a long bill-to name can wrap.
  field(cols[0].x, gy, isInvoice ? "Invoice" : "Quote", docNumber);
  field(cols[0].x, gy + 15, "Reference", inquiry.reference || "-");
  field(cols[0].x, gy + 30, "Customer", billTo, cols[0].w);
  // Column 2 — Email last so a long address can wrap.
  field(cols[1].x, gy, "Agent", agent);
  field(cols[1].x, gy + 15, "Phone", inquiry.phone || "-");
  field(cols[1].x, gy + 30, "Email", inquiry.email || "-", cols[1].w);
  // Column 3
  field(cols[2].x, gy, "Date", todayLong());
  if (isInvoice) {
    field(cols[2].x, gy + 15, "Due", "On receipt");
    field(cols[2].x, gy + 30, "Status", "Invoiced");
  } else if (accepted) {
    field(cols[2].x, gy + 15, "Accepted", acceptedDate);
    field(cols[2].x, gy + 30, "Status", "Confirmed");
  } else {
    field(cols[2].x, gy + 15, "Valid", quote.valid_until
      ? fmtDate(quote.valid_until, { month: "short", day: "numeric", year: "numeric" })
      : "14 days");
    field(cols[2].x, gy + 30, "Terms", "Due on acceptance");
  }

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
  // Issued To — bill-to name then any address lines. Email/phone are NOT repeated
  // here; they already appear in the info grid above. Each address line shifts the
  // line-item heading down by one row (addrOffset) so nothing collides.
  const addrOffset = billAddrLines.length * 10;
  d.setFont("helvetica", "bold");
  d.setFontSize(9);
  setText(d, INK);
  d.text(billTo, cols[0].x, cy);
  d.setFont("helvetica", "normal");
  d.setFontSize(8);
  setText(d, MUTED);
  billAddrLines.forEach((ln, i) => {
    d.text(d.splitTextToSize(ln, cols[0].w)[0], cols[0].x, cy + 11 + i * 10);
  });
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

  // ─── Line-item section heading (boxed; solid cobalt invoice / solid green
  //     accepted / dashed cobalt draft) ───────────────────────────────────────
  const headBoxY = cy + 30 + addrOffset;
  setDraw(d, accepted ? GREEN : COBALT);
  d.setLineWidth(0.8);
  if (!accepted && !isInvoice) d.setLineDashPattern([2, 2], 0);
  d.rect(margin, headBoxY, usable, 22);
  d.setLineDashPattern([], 0);
  d.setFont("helvetica", "bold");
  d.setFontSize(14);
  setText(d, accepted ? GREEN : COBALT);
  d.text(isInvoice ? "INVOICE" : accepted ? "ACCEPTED QUOTE" : "QUOTE", margin + 8, headBoxY + 16);
  d.setFont("helvetica", "bold");
  d.setFontSize(7.5);
  setText(d, SUBTLE);
  d.text(
    isInvoice ? "AMOUNT DUE" : accepted ? "CONFIRMED RENTAL" : "ITEMIZED RENTAL",
    right - 12,
    headBoxY + 14.5,
    { align: "right", charSpace: 0.5 }
  );

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
      setFill(d, accepted ? GREEN_TINT : AMOUNT_HL);
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
  totalBar(isInvoice ? "Amount Due" : accepted ? "Accepted Total" : "Quote Total", money(quote.total), {
    strong: true,
    hl: true,
  });

  // The note/terms below are absolute-positioned free text with no auto-paging,
  // and the footer is pinned at the page bottom. A long or multi-line note would
  // otherwise run into the footer, so keep each block together: if it wouldn't
  // fit above the footer zone, start a fresh page first. (The footer is drawn
  // once at the end, landing on whatever the last page turns out to be.)
  const maxContentY = pageHeight - 72;
  const ensureSpace = (blockHeight: number) => {
    if (ty + blockHeight > maxContentY) {
      doc.addPage();
      ty = margin;
    }
  };

  // ─── Custom note (inquiry-level; printed only when the rep has enabled it for
  //     THIS document via note_on_quote / note_on_invoice) ────────────────────
  const showNote = isInvoice ? inquiry.note_on_invoice : inquiry.note_on_quote;
  const noteText = (inquiry.document_note || "").trim();
  if (showNote && noteText) {
    d.setFont("helvetica", "normal");
    d.setFontSize(9);
    const wrappedNote = d.splitTextToSize(noteText, usable);
    // gap(26) + heading(13) + one line per wrapped row (~11pt) — kept on one page.
    ensureSpace(26 + 13 + wrappedNote.length * 11);
    ty += 26;
    d.setFont("helvetica", "bold");
    d.setFontSize(8);
    setText(d, INK);
    d.text("NOTE", margin, ty, { charSpace: 0.8 });
    ty += 13;
    d.setFont("helvetica", "normal");
    d.setFontSize(9);
    setText(d, MUTED);
    d.text(wrappedNote, margin, ty);
    // Advance to the last note line so the TERMS block below clears it.
    ty += (wrappedNote.length - 1) * 11;
  }

  // ─── Terms ────────────────────────────────────────────────────────────────
  const termsText = isInvoice
    ? // Invoices carry payment terms, not the quote's validity language — so we
      // ignore any saved quote terms here.
      `By accepting this invoice, you authorize ${BRAND.name} to charge the credit card on file for the full amount of this invoice. ` +
      "The card on file will be charged within seven (7) days of the start date of your rental. " +
      "This amount includes delivery, setup, and servicing. " +
      `Please reference invoice ${docNumber} on any payment-related correspondence.`
    : (quote.terms && quote.terms.trim()) ||
      (accepted
        ? `This quote was accepted on ${acceptedDate} and your rental is confirmed. ` +
          "Pricing includes delivery, setup, and servicing. We will reach out ahead of " +
          "your start date to coordinate delivery access, power, and water."
        : "Quote includes delivery, setup, and servicing. Pricing is held for 14 days. " +
          "Reply to confirm and we will hold your date.");
  d.setFont("helvetica", "normal");
  d.setFontSize(9);
  const wrapped = d.splitTextToSize(termsText, usable);
  ensureSpace(26 + 13 + wrapped.length * 11);
  ty += 26;
  d.setFont("helvetica", "bold");
  d.setFontSize(8);
  setText(d, INK);
  d.text("TERMS", margin, ty, { charSpace: 0.8 });
  ty += 13;
  d.setFont("helvetica", "normal");
  d.setFontSize(9);
  setText(d, MUTED);
  d.text(wrapped, margin, ty);
  ty += (wrapped.length - 1) * 11; // advance past wrapped terms to the last line

  // ─── Acceptance / signature block (invoices only) ─────────────────────────
  // Gives the customer a place to sign + print their name so a returned invoice
  // serves as written confirmation that the order was accepted.
  if (isInvoice) {
    ensureSpace(140);
    ty += 30;
    d.setFont("helvetica", "bold");
    d.setFontSize(8);
    setText(d, INK);
    d.text("ACCEPTANCE", margin, ty, { charSpace: 0.8 });
    ty += 12;
    d.setFont("helvetica", "normal");
    d.setFontSize(8.5);
    setText(d, MUTED);
    d.text(
      "By signing below, you confirm the items and amount above and accept this invoice.",
      margin,
      ty
    );

    const sigW = 250;
    const dateX = right - 150;
    // Signature line (left) + Date line (right).
    ty += 40;
    setDraw(d, BORDER);
    d.setLineWidth(0.8);
    d.line(margin, ty, margin + sigW, ty);
    d.line(dateX, ty, right, ty);
    ty += 11;
    d.setFont("helvetica", "bold");
    d.setFontSize(7.5);
    setText(d, SUBTLE);
    d.text("Signature", margin, ty);
    d.text("Date", dateX, ty);

    // Print name line.
    ty += 32;
    setDraw(d, BORDER);
    d.line(margin, ty, margin + sigW, ty);
    ty += 11;
    setText(d, SUBTLE);
    d.text("Print name", margin, ty);
  }

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

// Trigger a browser download of the quote PDF (filename = the quote number,
// suffixed when it's the accepted confirmation copy).
export async function downloadQuotePdf(quote: QuotePdfDoc, inquiry: Inquiry): Promise<void> {
  const doc = await buildQuoteDoc(quote, inquiry);
  const suffix = quote.status === "accepted" ? "-ACCEPTED" : "";
  doc.save(`${quote.quote_number}${suffix}.pdf`);
}

// Trigger a browser download of the INVOICE PDF generated from a quote. The
// figures match the quote exactly; the doc is re-titled with an invoice number.
export async function downloadInvoicePdf(quote: QuotePdfDoc, inquiry: Inquiry): Promise<void> {
  const doc = await buildQuoteDoc(quote, inquiry, "invoice");
  doc.save(`${invoiceNumberFor(quote.quote_number)}.pdf`);
}
