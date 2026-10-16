import { test } from "node:test";
import assert from "node:assert/strict";
import { combine, current, prior, pnl, functionTotals, monthly, priorFunctions, fmtTable, fmtMoney, fmtSigned, peopleOn, type DashboardPayload, type Line, type DashMaster } from "../dashboard";

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

test("a line that nets to zero over the year still counts in the months compared", () => {
  const m = flat(0);
  m[2] = 20; m[10] = -20;
  const p: DashboardPayload = { ...payload, groups: [{ ...payload.groups[0], masters: [master({ id: "4000", section: "revenue", months: flat(100) }), master({ id: "5090", section: "direct_operating_costs", months: m, byFunction: { Fleet: m } })] }] };
  const { lines, booked } = combine(p, "AVON");
  const ytd = pnl(lines, "ytd", booked);
  assert.equal(ytd.totals.direct_operating_costs.cur, 20);
  assert.equal(ytd.totals.ebitda.cur, 800 - 20);
  assert.ok(ytd.rows.some((r) => r.lineId === "5090"));
});

test("a company's share of the consolidated total leaves out intercompany when asked", () => {
  const keep = combine(payload, "AVON");
  const drop = combine(payload, "AVON", { dropIntercompany: true });
  assert.ok(keep.lines.some((l) => l.id === "7999"));
  assert.ok(!drop.lines.some((l) => l.id === "7999"));
  const all = pnl(combine(payload, "All").lines, "pace", 8).totals.ni.cur;
  const parts = ["AVON", "HDR"].map((c) => pnl(combine(payload, c, { dropIntercompany: true }).lines, "pace", 8).totals.ni.cur);
  assert.equal(parts[0] + parts[1], all);
});

test("formats follow the chosen unit", () => {
  assert.equal(fmtTable(8_400_000, "M"), "8.40");
  assert.equal(fmtTable(8_400_000, "K"), "8,400");
  assert.equal(fmtTable(-8_400_000, "D"), "(8,400,000)");
  assert.equal(fmtTable(100, "K"), "–");
  assert.equal(fmtMoney(23_422_000, "M"), "$23.42M");
  assert.equal(fmtSigned(-1_175_000, "K"), "−$1,175K");
});

test("peopleOn adds a person's payroll components together and keeps only the picked function's share", () => {
  const person = (id: string, name: string, v: number, byFunction: Record<string, number[]>) =>
    ({ id, name, title: null, months: flat(v), total: v * 12, functions: [], locations: [], byFunction });
  const item = (id: string, label: string, people: ReturnType<typeof person>[]) =>
    ({ id, label, group: "AVON", groupName: "Avon", people }) as unknown as Line["items"][number];
  const items = [
    item("w", "Wages", [person("a", "Ana", 100, { Sales: flat(60), Fleet: flat(40) }), person("b", "Bo", 50, { Fleet: flat(50) })]),
    item("t", "Payroll taxes", [person("a", "Ana", 10, { Sales: flat(6), Fleet: flat(4) })]),
  ];
  const all = peopleOn(items, null);
  assert.deepEqual(all.map((p) => p.name), ["Ana", "Bo"]);
  assert.equal(all[0].months[0], 110);
  assert.equal(all[0].parts.length, 2);
  const fleet = peopleOn(items, "Fleet");
  assert.deepEqual(fleet.map((p) => [p.name, p.months[0]]), [["Bo", 50], ["Ana", 44]]);
  assert.equal(peopleOn(items, "Operations").length, 0);
});
