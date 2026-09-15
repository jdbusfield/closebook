import { test } from "node:test";
import assert from "node:assert/strict";
import { AssumptionSet } from "../assumption-keys";
import {
  monthlyBaseWage,
  pricePosition,
  reportingEntityShare,
  sumPositions,
  type HeadcountRowInput,
} from "../personnel-engine";

function row(overrides: Partial<HeadcountRowInput> = {}): HeadcountRowInput {
  return {
    id: "r1",
    name: "Test Person",
    employeeId: "1",
    paylocityCompanyId: "316791",
    reportingEntityId: "re",
    isRequisition: false,
    status: "active",
    payType: "Hourly",
    baseRate: 25,
    annualSalary: null,
    stdHoursWeek: 40,
    ftePct: 100,
    startMonth: 1,
    endMonth: null,
    meritPct: 0,
    meritMonth: null,
    bonusTarget: 0,
    commissionAnnual: 0,
    otPct: 0,
    dtPct: 0,
    mealPct: 0,
    otherEarningsMonthly: 0,
    benefitsMonthly: 0,
    matchPct: 0,
    lifeDisabilityMonthly: 0,
    wcClassCode: null,
    ptoHoursPerPeriod: 0,
    otherCostsMonthly: 0,
    entityAllocations: [],
    classAllocations: [],
    ...overrides,
  };
}

const ctx = (rows: ConstructorParameters<typeof AssumptionSet>[0] = []) => ({
  year: 2027,
  assumptions: new AssumptionSet(rows),
});

test("hourly base wage = rate x hours x 52 / 12", () => {
  assert.equal(Math.round(monthlyBaseWage(row()) * 100) / 100, Math.round(((25 * 40 * 52) / 12) * 100) / 100);
});

test("salary base wage = annual / 12", () => {
  assert.equal(monthlyBaseWage(row({ payType: "Salary", annualSalary: 120000, baseRate: null })), 10000);
});

test("employer taxes apply caps on cumulative wages, FUTA and SUI stop after 7,000", () => {
  const p = pricePosition(row({ payType: "Salary", annualSalary: 120000, baseRate: null }), ctx());
  // Month 1: 10,000 wages -> FUTA on 7,000 = 42; SUI 3.4% on 7,000 = 238; ETT 7
  assert.equal(p.components.futa[0], 42);
  assert.equal(p.components.sui[0], 238);
  assert.equal(p.components.ett[0], 7);
  assert.equal(p.components.futa[1], 0);
  assert.equal(p.components.sui[1], 0);
  // Medicare has no cap
  assert.equal(p.components.medicare[11], 145);
  // Social Security every month (120k < 184.5k base)
  assert.equal(p.components.fica_ss[11], 620);
  assert.equal(p.componentTotals.wages, 120000);
});

test("Social Security stops once the wage base is reached", () => {
  const p = pricePosition(row({ payType: "Salary", annualSalary: 240000, baseRate: null }), ctx());
  // 20,000 / month; base 184,500 reached in month 10 (9 months = 180,000; 4,500 taxable in month 10)
  assert.equal(p.components.fica_ss[8], 1240);
  assert.equal(p.components.fica_ss[9], 279);
  assert.equal(p.components.fica_ss[10], 0);
});

test("start and end months zero the outside months, merit applies from merit month", () => {
  const p = pricePosition(
    row({ payType: "Salary", annualSalary: 60000, baseRate: null, startMonth: 3, endMonth: 8, meritPct: 10, meritMonth: 6 }),
    ctx(),
  );
  assert.equal(p.activeMonths, 6);
  assert.equal(p.components.wages[0], 0);
  assert.equal(p.components.wages[2], 5000);
  assert.equal(p.components.wages[5], 5500);
  assert.equal(p.components.wages[8], 0);
});

test("bonus accrues monthly by default and lands in payout month when bonus_accrual = 0", () => {
  const accrued = pricePosition(row({ bonusTarget: 12000 }), ctx());
  assert.equal(accrued.components.bonus[0], 1000);
  assert.equal(accrued.componentTotals.bonus, 12000);
  const payout = pricePosition(
    row({ bonusTarget: 12000 }),
    ctx([
      { scope: "org", scope_id: null, key: "bonus_accrual", value: 0 },
      { scope: "org", scope_id: null, key: "bonus_payout_month", value: 3 },
    ]),
  );
  assert.equal(payout.components.bonus[0], 0);
  assert.equal(payout.components.bonus[2], 12000);
});

test("overtime, benefits renewal, match, workers comp and PTO", () => {
  const p = pricePosition(
    row({
      otPct: 10,
      benefitsMonthly: 500,
      matchPct: 4,
      wcClassCode: "8810",
      ptoHoursPerPeriod: 3.08,
    }),
    ctx([
      { scope: "org", scope_id: null, key: "benefit_renewal_pct", value: 12 },
      { scope: "org", scope_id: null, key: "benefit_renewal_month", value: 7 },
      { scope: "org", scope_id: "8810", key: "wc_rate", value: 0.5 },
    ]),
  );
  const base = (25 * 40 * 52) / 12;
  assert.equal(p.components.overtime[0], Math.round(base * 0.1 * 100) / 100);
  assert.equal(p.components.benefits[0], 500);
  assert.equal(p.components.benefits[6], 560);
  assert.equal(p.components.match[0], Math.round(base * 1.1 * 0.04 * 100) / 100);
  assert.equal(p.components.workers_comp[0], Math.round((base * 1.1 / 100) * 0.5 * 100) / 100);
  // 3.08 h x 26/12 checks x $25
  assert.equal(p.components.pto[0], Math.round(3.08 * (26 / 12) * 25 * 100) / 100);
});

test("requisition waits for benefits and books recruiting in the start month", () => {
  const p = pricePosition(
    row({ isRequisition: true, startMonth: 4, benefitsMonthly: 0 }),
    ctx([
      { scope: "org", scope_id: null, key: "new_hire_benefits_monthly", value: 700 },
      { scope: "org", scope_id: null, key: "benefits_waiting_months", value: 2 },
      { scope: "org", scope_id: null, key: "recruiting_cost_per_hire", value: 1500 },
    ]),
  );
  assert.equal(p.components.benefits[3], 0);
  assert.equal(p.components.benefits[4], 0);
  assert.equal(p.components.benefits[5], 700);
  assert.equal(p.components.recruiting[3], 1500);
  assert.equal(p.components.recruiting[4], 0);
});

test("reporting entity share scales every component", () => {
  const r = row({ entityAllocations: [{ entity_id: "a", pct: 60 }, { entity_id: "b", pct: 40 }] });
  const share = reportingEntityShare(r, new Set(["a"]));
  assert.equal(share, 0.6);
  const full = pricePosition(r, ctx());
  const part = pricePosition(r, { ...ctx(), reShare: share });
  assert.equal(part.components.wages[0], Math.round(full.components.wages[0] * 0.6 * 100) / 100);
});

test("excluded rows price to zero and sums add up", () => {
  const a = pricePosition(row(), ctx());
  const b = pricePosition(row({ id: "r2", status: "excluded" }), ctx());
  assert.equal(b.total, 0);
  const s = sumPositions([a, b]);
  assert.equal(s.total, a.total);
  assert.equal(s.totalByMonth[0], a.totalByMonth[0]);
});
