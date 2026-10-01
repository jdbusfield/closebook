import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuoteDoc, type QuotePdfDoc } from "../quote-pdf";
import { quoteEmailBlock, type Inquiry, type InquiryQuote } from "../shared";
import { DEFAULT_TEMPLATES, renderTemplate } from "../templates";

const inquiry = {
  id: "test-inquiry", name: "Test Customer", email: "test@example.invalid",
  reference: "HDR-TEST", source: "website", start_date: "2026-10-10",
  end_date: "2026-10-10", quotes: [],
} as unknown as Inquiry;

const quote: QuotePdfDoc = {
  quote_number: "Q-TEST", status: "draft", created_at: "2026-10-01T18:00:00Z",
  valid_until: "2026-10-04", lines: [{ description: "Existing rental item", qty: 1, rate: 125 }],
  subtotal: 125, tax_rate: 0, tax: 0, total: 125, terms: null,
};

// Inspect drawn PDF text, excluding metadata such as file creation time.
function drawnText(doc: Awaited<ReturnType<typeof buildQuoteDoc>>): string {
  return [...doc.output().matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
    .map((match) => match[1].replace(/\\([\\()])/g, "$1"))
    .join(" ").replace(/\s+/g, " ");
}

test("PDF and email display the actual persisted expiration date", async () => {
  const text = drawnText(await buildQuoteDoc(quote, inquiry));
  assert.equal(text.match(/Oct 1, 2026/g)?.length, 2);
  assert.equal(text.match(/Oct 4, 2026/g)?.length, 3);
  assert.match(text, /Pricing valid through Oct 4, 2026\./);
  assert.doesNotMatch(text, /14 days|REVIEW REQUIRED/);
  const email = quoteEmailBlock(quote as InquiryQuote);
  assert.match(email, /Total: \$125\nPricing valid through Oct 4, 2026\./);
});

test("quote re-download retains issuance and expiration across days and timezone boundaries", async (t) => {
  const atBoundary = { ...quote, created_at: "2026-10-02T06:59:59Z" };
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-02T07:00:00Z") });
  const first = drawnText(await buildQuoteDoc(atBoundary, inquiry));
  t.mock.timers.setTime(new Date("2026-10-15T18:00:00Z").getTime());
  const second = drawnText(await buildQuoteDoc(atBoundary, inquiry));
  assert.equal(first, second);
  assert.equal(second.match(/Oct 1, 2026/g)?.length, 2);
  assert.doesNotMatch(second, /Oct 15, 2026/);
});

test("missing validity has no implicit duration or review requirement", async () => {
  const missing = { ...quote, valid_until: null };
  const text = drawnText(await buildQuoteDoc(missing, inquiry));
  assert.match(text, /Pricing validity date not set\./);
  assert.doesNotMatch(text, /14 days|Pricing valid through|review/i);
  assert.match(quoteEmailBlock(missing as InquiryQuote), /Pricing validity date not set\./);
});

test("saved custom expiration and custom terms render unchanged", async () => {
  const custom = { ...quote, valid_until: "2026-10-15", terms: "Pricing is held for 14 days. Existing custom instructions." };
  const text = drawnText(await buildQuoteDoc(custom, inquiry));
  assert.ok(text.includes(custom.terms));
  assert.equal(text.match(/Oct 15, 2026/g)?.length, 2);
  assert.doesNotMatch(text, /REVIEW REQUIRED|Pricing valid through/);
  assert.match(quoteEmailBlock(custom as InquiryQuote), /Pricing valid through Oct 15, 2026\./);
});

test("default email template uses the saved date without a second duration promise", () => {
  const template = DEFAULT_TEMPLATES.find((item) => item.id === "quote-email-builder")!;
  const rendered = renderTemplate(template, inquiry, "Test Rep", {
    quote: quoteEmailBlock(quote as InquiryQuote), quote_number: quote.quote_number,
  });
  assert.equal(rendered.body.match(/Pricing valid through Oct 4, 2026\./g)?.length, 1);
  assert.doesNotMatch(rendered.body, /good for 14 days|held for 14 days/);
});

test("invoice variant retains its date and payment terms", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-15T18:00:00Z") });
  const text = drawnText(await buildQuoteDoc(quote, inquiry, "invoice"));
  assert.match(text, /INVOICE/);
  const localInvoiceDate = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  assert.equal(text.split(localInvoiceDate).length - 1, 2);
  assert.match(text, /The card on file will be charged within seven \(7\) days/);
  assert.doesNotMatch(text, /Pricing valid through|Pricing validity date not set/);
});
