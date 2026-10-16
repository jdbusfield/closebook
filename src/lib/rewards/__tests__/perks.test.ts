import { test } from "node:test";
import assert from "node:assert/strict";
import { allowanceState, periodStart, redemptionRefund } from "../perks";

test("period starts", () => {
  assert.equal(periodStart("2027-03-17", "week"), "2027-03-15"); // Wednesday -> Monday
  assert.equal(periodStart("2027-03-14", "week"), "2027-03-08"); // Sunday -> prior Monday
  assert.equal(periodStart("2027-03-17", "month"), "2027-03-01");
  assert.equal(periodStart("2027-05-17", "quarter"), "2027-04-01");
  assert.equal(periodStart("2027-05-17", "year"), "2027-01-01");
  assert.equal(periodStart("2027-05-17", "order"), null);
});

test("allowance counts only this period's uses", () => {
  const uses = [
    { usedOn: "2027-02-27", quantity: 1 },
    { usedOn: "2027-03-02", quantity: 1 },
  ];
  assert.deepEqual(allowanceState(1, "month", uses, "2027-03-20"), {
    allowance: 1,
    used: 1,
    remaining: 0,
    periodStart: "2027-03-01",
  });
  assert.equal(allowanceState(4, "week", uses, "2027-03-20")?.remaining, 4);
  assert.equal(allowanceState(null, "month", uses, "2027-03-20"), null);
});

test("redemption refund rounds down", () => {
  assert.equal(redemptionRefund(50000, 25), 12500);
  assert.equal(redemptionRefund(1001, 25), 250);
  assert.equal(redemptionRefund(1000, null), 0);
});
