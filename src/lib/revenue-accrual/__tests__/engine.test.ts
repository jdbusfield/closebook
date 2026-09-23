import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, includedItems, runAccrual } from "../engine";
import { buildJournals } from "../journals";
import { DEFAULT_SETTINGS } from "../defaults";
import { memoDates, parseRentalPeriod, shareThrough } from "../dates";
import { normKey, similarity } from "../names";
import type { Doc, Quote } from "../types";

const S = { ...DEFAULT_SETTINGS, aliases: {} };
const aug = { year: 2026, month: 8 };

const quote = (id: string, project: string, start: string, end: string, amount: number, status = "Approved"): Quote => ({
  id, project, start, end, amount, status, path: null,
});
const doc = (num: string, customer: string, date: string, lines: [number, string, string, string | null][], created = `${date}T10:00:00-07:00`): Doc => ({
  key: `Invoice:${num}`,
  num,
  type: "Invoice",
  date,
  created,
  customer,
  lines: lines.map(([amount, acct, description, className]) => ({
    amount,
    description,
    accountNumber: acct,
    accountName: `Account ${acct}`,
    className,
  })),
});

test("dates: rental share is by inclusive days", () => {
  assert.equal(shareThrough("2026-08-25", "2026-09-03", "2026-08-31"), 0.7);
  assert.equal(shareThrough("2026-09-01", "2026-09-03", "2026-08-31"), 0);
  assert.equal(shareThrough("2026-08-01", "2026-08-02", "2026-08-31"), 1);
});

test("dates: memo service dates, with and without a year, and a typo year", () => {
  assert.deepEqual(memoDates("Service 8-27-26 @ 12-1pm", "2026-09-02"), ["2026-08-27"]);
  assert.deepEqual(memoDates("Service- at 4pm on Sat(8/29)", "2026-09-02"), ["2026-08-29"]);
  assert.deepEqual(memoDates("Service 8-27-27 @ 1pm", "2026-09-02"), ["2026-08-27"]);
  assert.deepEqual(memoDates("10x10 Pop-Up Tent", "2026-09-02"), []);
  assert.deepEqual(parseRentalPeriod("8/25/26 - 9/3/26", "2026-09-05"), { start: "2026-08-25", end: "2026-09-03" });
});

test("names: keys and close spellings", () => {
  assert.equal(normKey("9-1-1 Season 10"), "911s10");
  assert.equal(normKey("Stay At Home LLC (W&T)"), "stayathome");
  assert.ok(similarity("initmacyparty", "intimacyparty") > 0.85);
});

test("allocate keeps the total to the penny", () => {
  const out = allocate(100, [
    { account: { number: "1", name: "a" }, className: "X", amount: 1 },
    { account: { number: "2", name: "b" }, className: "X", amount: 1 },
    { account: { number: "3", name: "c" }, className: "X", amount: 1 },
  ]);
  assert.equal(Math.round(out.reduce((s, a) => s + a.amount, 0) * 100), 10000);
});

test("invoice after month-end that ties to a quote accrues the earned share", () => {
  const quotes = [quote("Q1", "911 S10", "2026-08-25", "2026-09-03", 1000)];
  const docs = [doc("500", "20th Television:911:911 S10 (HDR Location)", "2026-09-04", [
    [600, "49006", "Generator", "Locations"],
    [400, "42004", "3 Yard Bin", "Locations"],
  ])];
  const r = runAccrual({ period: aug, quotes, docs, settings: S });
  const it = r.items.find((i) => i.kind === "accrual")!;
  assert.equal(it.tier, "confirmed");
  assert.equal(it.amount, 700);
  assert.deepEqual(it.allocation.map((a) => a.amount).sort((a, b) => a - b), [280, 420]);
});

test("invoice in the month for a rental running past month-end defers the rest", () => {
  const quotes = [quote("Q2", "TLYL", "2026-08-22", "2026-09-10", 2000)];
  const docs = [doc("501", "The Specter LLC:TLYL (W&T)", "2026-08-21", [[2000, "43002", "5 Ton Truck", "Production Supplies"]])];
  const r = runAccrual({ period: aug, quotes, docs, settings: S });
  const d = r.items.find((i) => i.kind === "deferral")!;
  assert.equal(d.tier, "confirmed");
  assert.equal(d.amount, 1000); // 10 of 20 days are in September
});

test("unbilled August quote accrues from its dates; an older unbilled quote goes to review", () => {
  const quotes = [
    quote("Q3", "Seana Fern", "2026-08-29", "2026-08-29", 1495),
    quote("Q4", "Old Show", "2026-07-01", "2026-07-10", 800),
  ];
  const r = runAccrual({ period: aug, quotes, docs: [], settings: S });
  const q3 = r.items.find((i) => i.quoteId === "Q3")!;
  const q4 = r.items.find((i) => i.quoteId === "Q4")!;
  assert.equal(q3.tier, "quote");
  assert.equal(q3.defaultInclude, true);
  assert.equal(q4.tier, "review");
  assert.equal(q4.defaultInclude, false);
});

test("a combined invoice on the same job covers its quotes; the part dated after month-end accrues", () => {
  const quotes = [
    quote("A", "El Dorado", "2026-08-10", "2026-08-12", 300),
    quote("B", "El Dorado", "2026-08-20", "2026-08-22", 700),
  ];
  const docs = [doc("502", "Big Indie Dawn, Inc:El Dorado (HDR)", "2026-09-05", [[950, "49009", "Tents", "Production Supplies"]])];
  const r = runAccrual({ period: aug, quotes, docs, settings: S });
  const job = r.items.filter((i) => i.tier === "job");
  assert.equal(job.reduce((s, i) => s + i.amount, 0), 950);
  const rest = r.items.find((i) => i.tier === "quote")!;
  assert.equal(rest.quoteId, "B");
  assert.equal(rest.amount, 50);
});

test("memo-dated lines on a later invoice accrue, and review items stay out until checked", () => {
  const docs = [doc("503", "WBTV:Shrinking:Shrinking S4 (HDR Location)", "2026-09-02", [
    [200, "42002", "Service 8-27-26 @ 1pm", "Bathrooms"],
    [300, "42002", "Service 9-02-26 @ 1pm", "Bathrooms"],
  ])];
  const r = runAccrual({ period: aug, quotes: [], docs, settings: S });
  const memo = r.items.filter((i) => i.source === "Service date in invoice memo");
  assert.equal(memo.length, 1);
  assert.equal(memo[0].amount, 200);
});

test("journal entries balance to the penny and reverse on the 1st", () => {
  const quotes = [quote("Q1", "911 S10", "2026-08-25", "2026-09-03", 1000.01)];
  const docs = [doc("500", "20th Television:911:911 S10 (HDR Location)", "2026-09-04", [
    [333.34, "49006", "Generator", "Locations"],
    [333.33, "42004", "Bin", "Locations"],
    [333.34, "42002", "Service", "Bathrooms"],
  ])];
  const r = runAccrual({ period: aug, quotes, docs, settings: S });
  const js = buildJournals(aug, includedItems(r, {}), S);
  assert.deepEqual(js.map((j) => [j.number, j.date]), [["26.08 Accr Rev", "2026-08-31"], ["26.08 Accr RevR", "2026-09-01"]]);
  for (const j of js) {
    const dr = j.rows.reduce((s, x) => s + (x.debit ?? 0), 0);
    const cr = j.rows.reduce((s, x) => s + (x.credit ?? 0), 0);
    assert.equal(Math.round(dr * 100), Math.round(cr * 100));
  }
  const offset = js[0].rows.find((x) => x.account.startsWith("12200"))!;
  assert.equal(offset.debit, 700.01);
  assert.equal(offset.className, "");
});
