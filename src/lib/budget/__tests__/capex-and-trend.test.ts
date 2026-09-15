import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCapexMonthly, levelPayment, unitMonthlyDepreciation } from "../capex-engine";
import { trendStats } from "../trend-builds";
import { monthsBetween, monthKey } from "../actuals";
import { expandAllocation } from "../schedule-builds";

const defaults = () => ({ usefulLifeMonths: 60, salvagePct: 20 });

test("capex item: cash in service month, straight-line depreciation after salvage, fleet count", () => {
  const r = computeCapexMonthly(
    2027,
    [{ id: "a", description: "Vans", assetGroup: "Cargo Van", quantity: 5, unitCost: 40000, inServiceYear: 2027, inServiceMonth: 3, usefulLifeMonths: null, salvagePct: null, funding: "cash", debtRate: null, debtTermMonths: null, debtPct: null, status: "planned" }],
    [],
    defaults,
  );
  assert.equal(r.capexCash[2], 200000);
  assert.equal(r.capexCash[3], 0);
  // (40,000 - 8,000) / 60 = 533.33 per unit, x5
  assert.equal(r.depreciation[1], 0);
  assert.equal(r.depreciation[2], Math.round(533.3333 * 5 * 100) / 100);
  assert.equal(r.fleetDelta["Cargo Van"][1], 0);
  assert.equal(r.fleetDelta["Cargo Van"][2], 5);
  assert.equal(r.fleetDelta["Cargo Van"][11], 5);
});

test("debt-funded capex: draw in month, interest and principal after", () => {
  const r = computeCapexMonthly(
    2027,
    [{ id: "a", description: "Trucks", assetGroup: "Box Truck", quantity: 1, unitCost: 120000, inServiceYear: 2027, inServiceMonth: 1, usefulLifeMonths: 96, salvagePct: 50, funding: "debt", debtRate: 0.08, debtTermMonths: 60, debtPct: 100, status: "approved" }],
    [],
    defaults,
  );
  assert.equal(r.debtDraw[0], 120000);
  assert.equal(r.debtInterest[0], 0);
  assert.equal(r.debtInterest[1], 800); // 120,000 x 8% / 12
  const pmt = levelPayment(120000, 0.08, 60);
  assert.equal(r.debtPrincipal[1], Math.round((pmt - 800) * 100) / 100);
  assert.equal(r.depreciation[0], Math.round(unitMonthlyDepreciation(120000, 96, 50) * 100) / 100);
});

test("disposal: proceeds, gain vs NBV, depreciation stops, fleet count drops", () => {
  const r = computeCapexMonthly(
    2027,
    [],
    [{ id: "d", description: "Old cubes", assetGroup: "Cube Truck", quantity: 3, disposalYear: 2027, disposalMonth: 6, expectedProceeds: 45000, nbvAtDisposal: 30000, monthlyDepreciation: 900, status: "planned" }],
    defaults,
  );
  assert.equal(r.disposalProceeds[5], 45000);
  assert.equal(r.disposalGainLoss[5], 15000);
  assert.equal(r.depreciationAvoided[4], 0);
  assert.equal(r.depreciationAvoided[5], 900);
  assert.equal(r.fleetDelta["Cube Truck"][5], -3);
  assert.equal(r.fleetDelta["Cube Truck"][4], 0);
});

test("trend stats: seasonality averages to one and trailing twelve sums the last year", () => {
  const months = monthsBetween(2024, 1, 2026, 12);
  const series = new Map<string, number>();
  for (const m of months) series.set(monthKey(m.year, m.month), 1000 + (m.month === 7 ? 500 : 0));
  const s = trendStats("m", series, months);
  assert.equal(s.monthsWithData, 36);
  assert.equal(Math.round(s.trailing12), 12500);
  const avg = s.seasonality.reduce((t, v) => t + v, 0) / 12;
  assert.ok(Math.abs(avg - 1) < 1e-9);
  assert.ok(s.seasonality[6] > s.seasonality[0]);
});

test("allocation expansion: repeating single month and monthly spread", () => {
  const rep = expandAllocation({
    id: "1", source_entity_id: "a", destination_entity_id: "b", master_account_id: "m", destination_master_account_id: null,
    amount: 100, description: "rent", schedule_type: "single_month", period_year: 2026, period_month: 11,
    start_year: null, start_month: null, end_year: null, end_month: null, is_repeating: true, repeat_end_year: 2027, repeat_end_month: 2,
  });
  assert.equal(rep.length, 4);
  assert.deepEqual(rep[3], { year: 2027, month: 2, amount: 100 });
  const spread = expandAllocation({
    id: "2", source_entity_id: "a", destination_entity_id: "b", master_account_id: "m", destination_master_account_id: null,
    amount: 1200, description: "fees", schedule_type: "monthly_spread", period_year: null, period_month: null,
    start_year: 2027, start_month: 1, end_year: 2027, end_month: 12, is_repeating: false, repeat_end_year: null, repeat_end_month: null,
  });
  assert.equal(spread.length, 12);
  assert.equal(spread[0].amount, 100);
});
