import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMasterWorkbook, type MasterGroup } from "../master-export";
import type { ModelItem } from "../model";
import type { LineMethod } from "../line-methods";

const m12 = (v: number) => new Array(12).fill(v) as number[];
const item = (label: string, kind: ModelItem["kind"], months: number[], method: LineMethod | null = null): ModelItem => ({
  id: label, kind, label, source: "Item", sourceHref: null, methodText: null, method, note: null, count: null, months, total: months.reduce((a, b) => a + b, 0), editable: true, history: null,
});

const group = (name: string, rev: number): MasterGroup => {
  const revMonths = m12(rev * 2 + 1);
  return {
    name,
    versionName: `${name} FY27`,
    assumptions: [{ label: "CA SUI rate", key: "sui_rate", scope: "org", value: 3.4, unit: "pct", text: null, note: null }],
    model: {
      priorYear: { r1: m12(rev), ic: m12(5), c1: m12(rev / 10), o1: m12(rev / 5), d1: m12(1) },
      sections: [
        { id: "revenue", title: "Revenue", masters: [
          { id: "r1", accountNumber: "4000", name: "Rental Revenue - Vehicles", months: revMonths, items: [item("RL line", "manual", m12(rev), { kind: "flat", amount: rev }), item("Missouri Fleet", "driver", m12(rev))] },
          { id: "ic", accountNumber: "4999", name: "Intercompany Revenue", months: m12(5), items: [] },
        ] },
        { id: "direct_operating_costs", title: "Direct Operating Costs", masters: [
          { id: "c1", accountNumber: "5010", name: "Merchant Fees", months: revMonths.map((v) => v * 0.03), items: [item("3% of rental", "method", revMonths.map((v) => v * 0.03), { kind: "pct_of_line", pct: 3, source_master_id: "r1" })] },
        ] },
        { id: "other_operating_costs", title: "Other Operating Costs", masters: [
          { id: "o1", accountNumber: "6300", name: "Other Expenses", months: m12(rev / 4), items: [item("Audit", "method", m12(rev / 4), { kind: "annual", amount: rev * 3, spread: "even" })] },
          // $1,000 a year spread evenly: CloseBook stores 83.33 a month (999.96 for the year)
          { id: "o2", accountNumber: "6310", name: "Dues", months: m12(83.33), items: [item("Dues", "method", m12(83.33), { kind: "annual", amount: 1000, spread: "even" })] },
        ] },
        { id: "other_expense", title: "Other Expense", masters: [{ id: "d1", accountNumber: "7000", name: "Vehicle Depreciation", months: m12(2), items: [] }] },
      ],
    },
  };
};

export const sample = () => buildMasterWorkbook({ fiscalYear: 2027, kind: "budget", through: 8, groups: [group("Avon", 100), group("HDR", 10)], intercompany: new Set(["ic"]), exportedOn: "2026-10-09" });

const text = (v: unknown) => (v && typeof v === "object" && "formula" in (v as object) ? `=${(v as { formula: string }).formula}` : String(v ?? ""));

test("budget model workbook: Summary, Detail and Assumptions tabs", () => {
  const wb = sample();
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Summary", "Detail", "Assumptions"]);
  const summary: string[] = [];
  wb.getWorksheet("Summary")!.eachRow((r) => summary.push(text(r.getCell(2).value)));
  for (const want of ["Consolidated (intercompany eliminated)", "Total Revenue", "Gross Margin", "Gross Margin %", "EBITDA", "EBITDA %", "Net Income"]) assert.ok(summary.includes(want), want);
  // Consolidated leaves out the intercompany account, each group shows it
  const cons = summary.slice(0, summary.indexOf("Net Income"));
  assert.ok(!cons.some((s) => s.includes("Intercompany")));
  assert.ok(summary.some((s) => s === "4999 Intercompany Revenue (intercompany)"));
});

test("detail: drivers feed formulas that reproduce the CloseBook amounts", () => {
  const ws = sample().getWorksheet("Detail")!;
  const rows = new Map<string, ExcelJSRow>();
  type ExcelJSRow = { n: number; driver: unknown; unit: string; jan: string };
  ws.eachRow((r, n) => {
    const line = String(r.getCell(7).value ?? "").trim();
    if (r.getCell(2).value === "Avon" && line) rows.set(line, { n, driver: r.getCell(9).value, unit: String(r.getCell(10).value ?? ""), jan: text(r.getCell(22).value) });
  });
  assert.equal(rows.get("RL line")!.driver, 100);
  assert.equal(rows.get("RL line")!.jan, `=ROUND($I${rows.get("RL line")!.n},2)`);
  const fee = rows.get("3% of rental")!;
  assert.equal(fee.driver, 0.03);
  assert.equal(fee.jan, `=ROUND($I${fee.n}*V$${rows.get("Rental Revenue - Vehicles")!.n},2)`);
  assert.equal(rows.get("Audit")!.jan, `=ROUND($I${rows.get("Audit")!.n}/12,2)`);
  assert.equal(rows.get("Dues")!.jan, `=ROUND($I${rows.get("Dues")!.n}/12,2)`);
  // 1 a month typed outside the items is listed so the account ties
  assert.ok(rows.has("Other amounts on the line"));
});
