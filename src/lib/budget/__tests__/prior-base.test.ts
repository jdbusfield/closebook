import { test } from "node:test";
import assert from "node:assert/strict";
import { actualsBase, applyPct } from "../prior-base-math";

const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
const prior = [100, 200, 300, 100, 200, 300, 100, 200, 300, 999, 0, 0];

test("actuals base keeps booked months and fills the rest at their average", () => {
  const b = actualsBase(prior, 9);
  assert.deepEqual(b.slice(0, 9), prior.slice(0, 9));
  // October's partial 999 is ignored: Oct-Dec are the Jan-Sep average (200)
  assert.deepEqual(b.slice(9), [200, 200, 200]);
  assert.equal(sum(b), 2400);
});

test("a complete year is copied as is", () => {
  assert.deepEqual(actualsBase(prior, 12), prior);
});

test("nothing booked gives zeros", () => {
  assert.deepEqual(actualsBase(prior, 0), new Array(12).fill(0));
});

test("percent moves every month", () => {
  assert.deepEqual(applyPct([100, 200], 5), [105, 210]);
  assert.deepEqual(applyPct([100, 200], -10), [90, 180]);
  assert.deepEqual(applyPct([100.005], 0), [100.01]);
});
