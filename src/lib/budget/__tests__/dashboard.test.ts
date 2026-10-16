import { test } from "node:test";
import assert from "node:assert/strict";
import { combine, current, prior, pnl, functionTotals, monthly, priorFunctions, fmtTable, fmtMoney, fmtSigned, type DashboardPayload, type DashMaster } from "../dashboard";

const flat = (v: number) => new Array(12).fill(v) as number[];
const master = (p: Partial<DashMaster> & { id: string; section: string }): DashMaster => ({
  accountNumber: p.id, name: p.id, intercompany: false, months: flat(0), prior: flat(0), byFunction: {}, items: [], ...p,
});
const payload: DashboardPayload = {
  fiscalYear: 2027,
  asOf: "2026-10-16",
  groups: [
    {
      reportingEntityId: "re1", code: "AVON", name: "Avon", version: { id: "v1", name: "FY", status: "draft", isActive: false }, priorYearMonths: 8, priorYearSource: "financial_model",
      masters: [
        master({ id: "4000", section: "revenue", months: flat(100), prior: flat(90) }),
        master({ id: "6000", section: "other_operating_costs", months: flat(40), prior: flat(30), byFunction: { Fleet: flat(30), Sales: flat(10) } }),
        master({ id: "7999", section: "other_expense", intercompany: true, months: flat(5), byFunction: { Overhead: flat(5) } }),
        master({ id: "7000", section: "other_expense", months: flat(20), prior: flat(20), byFunction: { Fleet: flat(20) } }),
      ],
    },
    {
      reportingEntityId: "re2", code: "HDR", name: "HDR", version: { id: "v2", name: "FY", status: "draft", isActive: false }, priorYearMonths: 9, priorYearSource: "financial_model",
      masters: [
        master({ id: "4000", section: "revenue", months: flat(50), prior: flat(40) }),
        master({ id: "6000", section: "other_operating_costs", months: flat(10), prior: flat(10), byFunction: { Operations: flat(10) } }),
      ],
    },
  ],
};

test("All companies drops intercompany lines and uses the shortest booked period", () => {
  const { lines, booked } = combine(payload, "All");
  assert.equal(booked, 8);
  assert.ok(!lines.some((l) => l.id === "7999"));
  assert.equal(lines.find((l) => l.id === "4000")!.months[0], 150);
  const one = combine(payload, "AVON");
  assert.ok(one.lines.some((l) => l.id === "7999"));
});

test("pace annualizes booked months; ytd compares the same months", () => {
  assert.equal(current(flat(10), "pace", 8), 120);
  assert.equal(current(flat(10), "ytd", 8), 80);
  assert.equal(prior(flat(9), "pace", 8), 108);
  assert.equal(prior(flat(9), "ytd", 8), 72);
  assert.equal(prior(flat(9), "pace", 0), 0);
});

test("the P&L ties: EBITDA and net income from the sections, function columns add to totals", () => {
  const { lines, booked } = combine(payload, "All");
  const { totals, rows } = pnl(lines, "pace", booked);
  assert.equal(totals.revenue.cur, 1800);
  assert.equal(totals.other_operating_costs.cur, 600);
  assert.equal(totals.ebitda.cur, 1200);
  assert.equal(totals.ni.cur, 1200 - 240);
  const rent = rows.find((r) => r.lineId === "6000")!;
  assert.equal(Object.values(rent.byFn).reduce((t, v) => t + v, 0), rent.cur);
  assert.deepEqual(Object.keys(rent.byFn).sort(), ["Fleet", "Operations", "Sales"]);
  assert.equal(totals.ebitda.byFn.Revenue, 1800);
  assert.equal(totals.ebitda.byFn.Fleet, -360);
  // Last year: revenue 130/mo booked 8, annualized
  assert.equal(Math.round(totals.revenue.prior), 1560);
});

test("function totals split operating cost from below the line; last year follows the budget mix", () => {
  const { lines, booked } = combine(payload, "All");
  const f = functionTotals(lines, "pace", booked);
  assert.equal(f.Fleet.cur, 360);
  assert.equal(f.Fleet.below, 240);
  assert.equal(f.Operations.cur, 120);
  const rent = lines.find((l) => l.id === "6000")!;
  const pf = priorFunctions(rent);
  // budget mix: Fleet 360, Sales 120, Ops 120 of 600; last year 40/mo
  assert.equal(pf.Fleet[0], 24);
  assert.equal(pf.Operations[0], 8);
});

test("monthly shows last year only for booked months", () => {
  const { lines, booked } = combine(payload, "All");
  const m = monthly(lines, booked);
  assert.equal(m[0].revenue, 150);
  assert.equal(m[0].ebitda, 100);
  assert.equal(m[0].priorRevenue, 130);
  assert.equal(m[11].priorRevenue, null);
});

test("formats follow the chosen unit", () => {
  assert.equal(fmtTable(8_400_000, "M"), "8.40");
  assert.equal(fmtTable(8_400_000, "K"), "8,400");
  assert.equal(fmtTable(-8_400_000, "D"), "(8,400,000)");
  assert.equal(fmtTable(100, "K"), "–");
  assert.equal(fmtMoney(23_422_000, "M"), "$23.42M");
  assert.equal(fmtSigned(-1_175_000, "K"), "−$1,175K");
});
