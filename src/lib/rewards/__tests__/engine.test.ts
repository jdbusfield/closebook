import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonths,
  coversWeekend,
  computeBalance,
  computeMemberEarnings,
  eligibleSpend,
  isInScope,
  openLots,
  roundPoints,
  tierStatus,
  type CachedInvoice,
  type CachedItem,
  type RewardsSettings,
  type TierDef,
} from "../engine";

const settings: RewardsSettings = {
  programStartDate: "2027-01-01",
  previewStartDate: "2026-01-01",
  invoicePrefixes: ["V"],
  countedStatuses: ["CLOSED", "PROCESSED", "APPROVED"],
  paidStatuses: ["CLOSED"],
  eligibleRecTypes: ["R"],
  excludedICodes: ["DMG"],
  bathroomICodes: [],
  weekendBonusEnabled: false,
  pointsExpireMonths: 12,
};

const tiers: TierDef[] = [
  { key: "insider", name: "Insider", sortOrder: 1, minAnnualSpend: 0, pointsPerDollar: 1, weekendPointsPerDollar: null, bathroomBonusPoints: null },
  { key: "preferred", name: "Preferred", sortOrder: 2, minAnnualSpend: 25000, pointsPerDollar: 1.25, weekendPointsPerDollar: null, bathroomBonusPoints: null },
  { key: "premier", name: "Premier", sortOrder: 3, minAnnualSpend: 100000, pointsPerDollar: 1.5, weekendPointsPerDollar: 2, bathroomBonusPoints: null },
  { key: "v_list", name: "V-List", sortOrder: 4, minAnnualSpend: 300000, pointsPerDollar: 2, weekendPointsPerDollar: 3, bathroomBonusPoints: null },
];

let seq = 0;
function inv(date: string, subTotal: number, extra: Partial<CachedInvoice> = {}): CachedInvoice {
  seq += 1;
  return {
    rwInvoiceId: `id-${seq}`,
    invoiceNumber: `V${300000 + seq}`,
    invoiceDate: date,
    billingStartDate: date,
    billingEndDate: date,
    status: "CLOSED",
    customerId: "C1",
    customerName: "Acme Productions",
    subTotal,
    ...extra,
  };
}
const rental = (extended: number): CachedItem => ({ iCode: "CUBE", recType: "R", extended, quantity: 1 });

function earn(invoices: CachedInvoice[], items?: Map<string, CachedItem[]>, s: RewardsSettings = settings) {
  const map = items ?? new Map(invoices.map((i) => [i.rwInvoiceId, [rental(Math.abs(i.subTotal))]]));
  return computeMemberEarnings(invoices, map, tiers, s);
}

test("eligible spend prorates the net subtotal onto rental lines", () => {
  const i = inv("2027-02-01", 900); // subtotal after a 10% discount on $1,000 of lines
  const items: CachedItem[] = [
    rental(600),
    { iCode: "TAPE", recType: "S", extended: 300, quantity: 3 }, // sales item: no points
    { iCode: "DMG", recType: "R", extended: 100, quantity: 1 }, // excluded I-code
  ];
  assert.equal(eligibleSpend(i, items, settings), 540);
  assert.equal(eligibleSpend(i, [], settings), 0);
});

test("scope: prefix, status and start date", () => {
  assert.equal(isInScope(inv("2027-03-01", 100), settings), true);
  assert.equal(isInScope(inv("2027-03-01", 100, { invoiceNumber: "A123" }), settings), false);
  assert.equal(isInScope(inv("2027-03-01", 100, { status: "VOID" }), settings), false);
  assert.equal(isInScope(inv("2025-12-31", 100), settings), false);
  assert.equal(isInScope(inv("2026-06-01", 100), settings), true); // preview
});

test("points, availability and expiry on a live invoice", () => {
  const { rows } = earn([inv("2027-02-10", 1000), inv("2027-02-11", 500, { status: "PROCESSED" })]);
  assert.equal(rows[0].points, 1000);
  assert.equal(rows[0].isAvailable, true);
  assert.equal(rows[0].isPreview, false);
  assert.equal(rows[0].expiresOn, "2028-02-10");
  assert.equal(rows[1].isAvailable, false); // not paid yet
});

test("preview invoices are never available and never seed a live tier", () => {
  const { rows, spendByYear } = earn([inv("2026-05-01", 150000), inv("2027-01-15", 1000)]);
  assert.equal(rows[0].isPreview, true);
  assert.equal(rows[0].isAvailable, false);
  // 2026 reached Premier, but 2027 starts at Insider.
  assert.equal(rows[1].tierKey, "insider");
  assert.equal(rows[1].points, 1000);
  assert.equal(tierStatus(spendByYear, tiers, settings, "2027-06-01").tier.key, "insider");
});

test("a live tier lasts through the next calendar year", () => {
  const { rows, spendByYear } = earn([inv("2027-03-01", 30000), inv("2027-03-02", 1000), inv("2028-01-05", 1000)]);
  assert.equal(rows[1].tierKey, "preferred");
  assert.equal(rows[2].tierKey, "preferred"); // carried into 2028
  const s2028 = tierStatus(spendByYear, tiers, settings, "2028-06-01");
  assert.equal(s2028.tier.key, "preferred");
  assert.equal(s2028.expiresOn, "2028-12-31");
  assert.equal(s2028.next?.key, "premier");
  assert.equal(s2028.spendToNext, 99000);
  assert.equal(s2028.spendToKeep, 24000);
  assert.equal(tierStatus(spendByYear, tiers, settings, "2029-06-01").tier.key, "insider");
});

test("the invoice that crosses a threshold earns at the old rate", () => {
  const { rows } = earn([inv("2027-02-01", 20000), inv("2027-02-02", 10000), inv("2027-02-03", 1000)]);
  assert.equal(rows[1].tierKey, "insider"); // $20K -> $30K crosses Preferred
  assert.equal(rows[1].points, 10000);
  assert.equal(rows[2].tierKey, "preferred");
  assert.equal(rows[2].points, 1250);
});

test("a reversal takes back exactly what its base invoice earned", () => {
  const base = inv("2027-03-01", 30000);
  const reversal = inv("2027-03-05", -30000, { invoiceNumber: `${base.invoiceNumber}A` });
  const { rows, spendByYear } = earn([inv("2027-02-01", 1000), base, reversal]);
  const baseRow = rows.find((r) => r.invoiceNumber === base.invoiceNumber)!;
  const revRow = rows.find((r) => r.invoiceNumber === reversal.invoiceNumber)!;
  assert.equal(revRow.points, -baseRow.points);
  assert.equal(spendByYear.get(2027), 1000);
});

test("weekend rate applies only when switched on", () => {
  const big = inv("2027-01-04", 100000, { billingStartDate: "2027-01-04", billingEndDate: "2027-01-05" }); // Mon-Tue
  const wknd = inv("2027-01-08", 1000, { billingStartDate: "2027-01-08", billingEndDate: "2027-01-11" }); // Fri-Mon
  assert.equal(earn([big, wknd]).rows[1].points, 1500);
  const on = earn([big, wknd], undefined, { ...settings, weekendBonusEnabled: true }).rows[1];
  assert.equal(on.weekendApplied, true);
  assert.equal(on.points, 2000);
});

test("helpers", () => {
  assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
  assert.equal(addMonths("2027-03-15", 12), "2028-03-15");
  assert.equal(coversWeekend("2027-01-04", "2027-01-08"), false); // Mon-Fri
  assert.equal(coversWeekend("2027-01-09", null), true); // Saturday
  assert.equal(roundPoints(-100.5), -101);
  assert.equal(roundPoints(100.5), 101);
});

test("balance: oldest points are spent first, then expire after 12 months", () => {
  const e = (points: number, earnedOn: string, expiresOn: string | null = addMonths(earnedOn, 12), isAvailable = true) =>
    ({ points, earnedOn, expiresOn, isAvailable, isPreview: false });
  const entries = [
    e(1000, "2027-01-10"),
    e(2000, "2027-06-10"),
    e(500, "2027-07-01", addMonths("2027-07-01", 12), false), // unpaid
    e(-1500, "2027-08-01", null), // redemption: uses all of Jan, 500 of Jun
  ];
  const mid = computeBalance(entries, "2027-12-01");
  assert.equal(mid.available, 1500);
  assert.equal(mid.pending, 500);
  assert.equal(mid.expired, 0);
  const later = computeBalance(entries, "2028-06-15");
  assert.equal(later.expired, 1500);
  assert.equal(later.available, 0);
  // A preview entry never counts.
  assert.equal(computeBalance([{ ...e(5000, "2026-03-01"), isPreview: true }], "2026-04-01").available, 0);
});

test("open lots: what is left of each batch, oldest first", () => {
  const e = (points: number, earnedOn: string) => ({ points, earnedOn, expiresOn: points > 0 ? addMonths(earnedOn, 12) : null, isAvailable: true, isPreview: false });
  const lots = openLots([e(9200, "2027-01-12"), e(15800, "2027-01-30"), e(12500, "2027-02-11"), e(-30000, "2027-02-28")], "2027-06-01");
  assert.deepEqual(lots.map((l) => [l.earnedOn, l.left, l.expiresOn]), [["2027-02-11", 7500, "2028-02-11"]]);
});
