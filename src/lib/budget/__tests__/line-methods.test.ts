import { test } from "node:test";
import assert from "node:assert/strict";
import { describeMethod, evaluateMethod, readMethod, type MethodHistory } from "../line-methods";

const history: MethodHistory = {
  priorYear: [100, 100, 200, 200, 100, 100, 100, 100, 100, 100, 100, 100],
  trailing12: 1500,
  trailing3Annualized: 1200,
  seasonality: [1, 1, 2, 2, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5],
  hasFullYear: true,
};
const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);

test("flat fills every month, or a range", () => {
  assert.deepEqual(evaluateMethod({ kind: "flat", amount: 250 }, { history }), new Array(12).fill(250));
  const part = evaluateMethod({ kind: "flat", amount: 250, start_month: 4, end_month: 6 }, { history });
  assert.equal(sum(part), 750);
  assert.equal(part[2], 0);
  assert.equal(part[3], 250);
});

test("annual spreads evenly or by last year's shape", () => {
  const even = evaluateMethod({ kind: "annual", amount: 1200 }, { history });
  assert.equal(even[0], 100);
  const shaped = evaluateMethod({ kind: "annual", amount: 1500, spread: "shape" }, { history });
  assert.ok(Math.abs(sum(shaped) - 1500) < 0.05);
  assert.equal(shaped[2], 214.29);
  assert.equal(shaped[0], 107.14);
  // Shape with no history falls back to even
  const noHist = evaluateMethod({ kind: "annual", amount: 1200, spread: "shape" }, { history: { ...history, priorYear: new Array(12).fill(0) } });
  assert.equal(noHist[5], 100);
});

test("prior_year moves each month by the percent", () => {
  const up = evaluateMethod({ kind: "prior_year", pct: 10 }, { history });
  assert.equal(up[2], 220);
  assert.equal(up[0], 110);
  assert.equal(Math.round(sum(up)), 1540);
});

test("run_rate uses trailing twelve shaped by seasonality", () => {
  const rr = evaluateMethod({ kind: "run_rate", pct: 0 }, { history });
  assert.equal(rr[0], 125);
  assert.equal(rr[2], 250);
  assert.equal(rr[10], 62.5);
  assert.equal(Math.round(sum(rr)), 1500);
  const three = evaluateMethod({ kind: "run_rate", basis: "trailing_3" }, { history });
  assert.equal(three[0], 100);
});

test("pct_of_line follows another line", () => {
  const lineTotals = new Map([["rev", new Array(12).fill(10000)]]);
  const c = evaluateMethod({ kind: "pct_of_line", pct: 2.5, source_master_id: "rev" }, { history, lineTotals });
  assert.equal(c[0], 250);
  assert.equal(sum(c), 3000);
  // Unknown source gives zeros rather than throwing
  assert.equal(sum(evaluateMethod({ kind: "pct_of_line", pct: 2.5, source_master_id: "nope" }, { history, lineTotals })), 0);
});

test("one_time lands in one month; months copies through", () => {
  const o = evaluateMethod({ kind: "one_time", amount: 48000, month: 3 }, { history });
  assert.equal(o[2], 48000);
  assert.equal(sum(o), 48000);
  const m = evaluateMethod({ kind: "months", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, { history });
  assert.equal(m[11], 12);
});

test("readMethod tolerates junk and describeMethod reads well", () => {
  assert.equal(readMethod(null), null);
  assert.equal(readMethod({ kind: "banana" }), null);
  const m = readMethod({ kind: "run_rate", pct: "5", account_ids: ["a", "b"] })!;
  assert.equal(m.pct, 5);
  assert.deepEqual(m.account_ids, ["a", "b"]);
  assert.equal(describeMethod({ kind: "run_rate", pct: 5 }, { accountCount: 2 }), "Trailing twelve months × seasonality, +5% from 2 accounts");
  assert.equal(describeMethod({ kind: "one_time", amount: 48000, month: 3 }), "$48,000 in Mar");
  assert.equal(describeMethod({ kind: "prior_year", pct: 0 }, { year: 2027 }), "2026 flat");
  assert.equal(describeMethod({ kind: "pct_of_line", pct: 2.5 }, { sourceLineName: "Rental Revenue - Vehicles" }), "2.5% of Rental Revenue - Vehicles");
});
