import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMemberView, expiringLots, fmtMoney, fmtRate, fmtSignedPoints, type ViewLedgerRow } from "../portal/view";
import { addMonths, type RewardsSettings, type TierDef } from "../engine";

const settings: RewardsSettings = {
  programStartDate: "2027-01-01",
  previewStartDate: "2026-01-01",
  invoicePrefixes: ["V"],
  countedStatuses: ["CLOSED", "PROCESSED", "APPROVED"],
  paidStatuses: ["CLOSED"],
  eligibleRecTypes: ["R"],
  excludedICodes: [],
  bathroomICodes: [],
  weekendBonusEnabled: false,
  pointsExpireMonths: 12,
};
const tiers: TierDef[] = [
  { key: "insider", name: "Insider", sortOrder: 1, minAnnualSpend: 0, pointsPerDollar: 1, weekendPointsPerDollar: null, bathroomBonusPoints: null },
  { key: "preferred", name: "Preferred", sortOrder: 2, minAnnualSpend: 25000, pointsPerDollar: 1.25, weekendPointsPerDollar: null, bathroomBonusPoints: null },
  { key: "premier", name: "Premier", sortOrder: 3, minAnnualSpend: 100000, pointsPerDollar: 1.5, weekendPointsPerDollar: null, bathroomBonusPoints: null },
];

let n = 0;
function earn(date: string, spend: number, points: number, extra: Partial<ViewLedgerRow> = {}): ViewLedgerRow {
  n += 1;
  return {
    id: `r${n}`, entry_type: "earn", points, eligible_spend: spend, invoice_number: `V30${n}`, invoice_date: date,
    invoice_status: "CLOSED", tier_key: "insider", points_per_dollar: 1, is_preview: false, is_available: true,
    earned_on: date, expires_on: addMonths(date, 12), redemption_id: null, reason: null, rw_invoice_id: `i${n}`, ...extra,
  };
}

test("the sample member: 34,225 to spend, 6,125 pending, Preferred, $38,720 to Premier", () => {
  const rows: ViewLedgerRow[] = [
    earn("2027-01-12", 9200, 9200),
    earn("2027-01-30", 15800, 15800),
    earn("2027-02-11", 10000, 12500),
    earn("2027-02-20", 3400, 4250, { is_available: false, invoice_status: "PROCESSED" }),
    earn("2027-02-25", 19855, 24819),
    { ...earn("2027-02-28", 0, -30000), entry_type: "redeem", expires_on: null, invoice_number: null, invoice_date: null },
    earn("2027-03-12", 1525, 1906),
    earn("2027-03-14", 1500, 1875, { is_available: false, invoice_status: "PROCESSED" }),
  ];
  const v = buildMemberView(rows, tiers, settings, "2027-03-31", false);
  assert.equal(v.balance.available, 34225);
  assert.equal(v.balance.pending, 6125);
  assert.equal(v.status.tier.key, "preferred");
  assert.equal(v.status.qualifyingSpend, 61280);
  assert.equal(v.status.spendToNext, 38720);
  const y = v.byYear.get(2027)!;
  assert.equal(y.redeemed, 30000);
  assert.equal(y.redemptions, 1);
  assert.deepEqual(expiringLots({ ...v, asOf: "2028-01-12" }).map((l) => [l.expiresOn, l.left]), [["2028-02-11", 7500], ["2028-02-25", 24819], ["2028-03-12", 1906]]);
});

test("customers never see preview rows; a staff preview shows them as live", () => {
  const rows = [earn("2026-05-01", 30000, 30000, { is_preview: true, is_available: false })];
  const customer = buildMemberView(rows, tiers, settings, "2026-10-16", false);
  assert.equal(customer.rows.length, 0);
  assert.equal(customer.balance.available, 0);
  assert.equal(customer.asOf, "2027-01-01");
  const staff = buildMemberView(rows, tiers, settings, "2026-10-16", true);
  assert.equal(staff.balance.available, 30000);
  assert.equal(staff.status.tier.key, "preferred");
});

test("formatting: whole dollars, signed points, rates", () => {
  assert.equal(fmtMoney(61280), "$61,280");
  assert.equal(fmtMoney(1640, true), "$1,640.00");
  assert.equal(fmtSignedPoints(-30000), "−30,000");
  assert.equal(fmtSignedPoints(1906), "+1,906");
  assert.equal(fmtRate(1.25), "1.25 Points per $1");
  assert.equal(fmtRate(1), "1 Point per $1");
});
