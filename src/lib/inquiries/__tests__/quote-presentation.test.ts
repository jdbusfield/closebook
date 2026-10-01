import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuoteDoc, type QuotePdfDoc } from "../quote-pdf";
import { quoteEmailBlock, type Inquiry, type InquiryQuote } from "../shared";
import { DEFAULT_TEMPLATES, renderTemplate } from "../templates";
import { formatQuoteDate, quoteIssueDate, quoteValidityText } from "../quote-validity";

const inquiry = {
  id: "test-inquiry", name: "Test Customer", email: "test@example.invalid",
  reference: "HDR-TEST", source: "website", start_date: "2026-10-03",
  end_date: "2026-10-03", quotes: [],
} as unknown as Inquiry;

const quote: QuotePdfDoc = {
  quote_number: "Q-TEST", status: "draft", created_at: "2026-10-01T18:00:00Z",
  valid_until: "2026-10-02", lines: [{ description: "Existing rental item", qty: 1, rate: 125 }],
  subtotal: 125, tax_rate: 0, tax: 0, total: 125, terms: null,
};

// jsPDF emits uncompressed PDF text operators by default. Inspect only drawn
// text (not metadata such as the PDF file creation time), including escapes.
function drawnText(doc: Awaited<ReturnType<typeof buildQuoteDoc>>): string {
  return [...doc.output().matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
    .map((m) => m[1].replace(/\\([\\()])/g, "$1"))
    .join(" ").replace(/\s+/g, " ");
}

test("October 1 / October 3 quote PDF and email agree on saved October 2 expiration", async () => {
  const text = drawnText(await buildQuoteDoc(quote, inquiry));
  assert.equal(text.match(/Oct 1, 2026/g)?.length, 2);
  assert.equal(text.match(/Oct 2, 2026/g)?.length, 3);
  assert.ok(text.includes(quoteValidityText(quote)));
  assert.doesNotMatch(text, /14 days/);
  const email = quoteEmailBlock(quote as InquiryQuote);
  assert.match(email, /Issued: Oct 1, 2026/);
  assert.ok(email.includes(quoteValidityText(quote)));
  assert.match(email, /Total: \$125/);
});

test("quote re-download retains issuance across later days and process timezone boundaries", async (t) => {
  const atBoundary = { ...quote, created_at: "2026-10-02T06:59:59Z" };
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-02T07:00:00Z") });
  const first = drawnText(await buildQuoteDoc(atBoundary, inquiry));
  t.mock.timers.setTime(new Date("2026-10-10T18:00:00Z").getTime());
  const second = drawnText(await buildQuoteDoc(atBoundary, inquiry));
  for (const text of [first, second]) {
    assert.equal(text.match(/Oct 1, 2026/g)?.length, 2);
    assert.ok((text.match(/Oct 2, 2026/g)?.length ?? 0) >= 3);
    assert.doesNotMatch(text, /Oct 10, 2026/);
  }
});

test("null validity and same-day drafts show review without an implicit expiration", async () => {
  const reviewQuote = { ...quote, valid_until: null };
  const text = drawnText(await buildQuoteDoc(reviewQuote, { ...inquiry, start_date: "2026-10-01" }));
  assert.match(text, /Review required/);
  assert.match(text, /Price validity requires review/);
  assert.match(text, /REVIEW REQUIRED:/);
  assert.doesNotMatch(text, /14 days|Pricing valid through/);
  assert.match(quoteEmailBlock(reviewQuote as InquiryQuote), /Price validity requires review/);
});

test("shorter custom validity and saved custom terms survive PDF rendering", async () => {
  const custom = { ...quote, valid_until: "2026-10-01", terms: "Existing delivery instructions remain unchanged." };
  const text = drawnText(await buildQuoteDoc(custom, inquiry));
  assert.ok(text.includes(custom.terms));
  assert.ok(text.includes(quoteValidityText(custom)));
  assert.doesNotMatch(text, /Pricing valid through Oct 2/);
});

test("legacy terms remain visible with the persisted deadline and a review warning", async () => {
  const legacy = { ...quote, terms: "Pricing is held for 14 days." };
  const text = drawnText(await buildQuoteDoc(legacy, inquiry));
  assert.ok(text.includes(legacy.terms));
  assert.ok(text.includes(quoteValidityText(legacy)));
  assert.match(text, /REVIEW REQUIRED:/);
});

test("accepted quote dates use saved timestamps and never invent an acceptance date", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-10T18:00:00Z") });
  const accepted = { ...quote, status: "accepted", accepted_at: "2026-10-03T06:59:59Z" };
  const text = drawnText(await buildQuoteDoc(accepted, inquiry));
  assert.match(text, /This quote was accepted on Oct 2, 2026/);
  assert.doesNotMatch(text, /Oct 10, 2026/);
  const unknown = drawnText(await buildQuoteDoc({ ...accepted, accepted_at: null, created_at: null }, inquiry));
  assert.match(unknown, /Review required/);
  assert.doesNotMatch(unknown, /Oct 10, 2026/);
});

test("invoice variant retains invoice date and payment terms without adding quote expiry", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-10T18:00:00Z") });
  const text = drawnText(await buildQuoteDoc(quote, inquiry, "invoice"));
  assert.match(text, /INVOICE/);
  // Invoice behavior is intentionally unchanged: its date follows the local
  // generation day, while quote issuance above always uses the business calendar.
  const localInvoiceDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  assert.equal(text.split(localInvoiceDate).length - 1, 2);
  assert.doesNotMatch(text, /Pricing valid through|REVIEW REQUIRED/);
});

test("quote template merges saved issue and expiry dates and never promises a default duration", () => {
  const defaultTemplate = DEFAULT_TEMPLATES.find((tpl) => tpl.id === "quote-email-builder")!;
  const extra = {
    quote: quoteEmailBlock(quote as InquiryQuote), quote_number: quote.quote_number,
    quote_issued_on: formatQuoteDate(quoteIssueDate(quote.created_at)),
    quote_valid_until: formatQuoteDate(quote.valid_until), quote_validity: quoteValidityText(quote),
  };
  const rendered = renderTemplate(defaultTemplate, inquiry, "Test Rep", extra);
  assert.ok(rendered.body.includes(quoteValidityText(quote)));
  assert.doesNotMatch(rendered.body, /14 days|good for 3 days/);
  const custom = renderTemplate({ ...defaultTemplate, body: "{quote_number}: {quote_issued_on}; {quote_valid_until}. {quote_validity}" }, inquiry, "Test Rep", extra);
  assert.equal(custom.body, "Q-TEST: Oct 1, 2026; Oct 2, 2026. Pricing valid through Oct 2, 2026 (America/Los_Angeles).");
});
