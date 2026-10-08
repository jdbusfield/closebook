import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayrollWorkbook, payrollExportFileName, type PayrollExportPosition } from "../payroll-export";
import { COST_COMPONENTS, type CostComponent } from "../personnel-engine";

const m12 = (v: number) => new Array(12).fill(v) as number[];
const comps = (wages: number, taxes: number) => {
  const c = Object.fromEntries(COST_COMPONENTS.map((k) => [k, 0])) as Record<CostComponent, number>;
  c.wages = wages;
  c.fica_ss = taxes;
  return c;
};
const pos = (name: string, monthly: number): PayrollExportPosition => ({
  name, title: "Driver", employeeId: "100", status: "active", hiredThrough: "Silverco Enterprises", company: "AVON", location: "Saticoy", class: "Vehicle Rental", function: "Operations",
  payType: "Hourly", pay: 25.5, adjustment: null, startMonth: 1, endMonth: null, byMonth: m12(monthly), components: comps(monthly * 11, monthly),
});

test("payroll workbook: positions sorted, totals are formulas, tabs present", async () => {
  const components = Object.fromEntries(COST_COMPONENTS.map((k) => [k, m12(0)])) as Record<CostComponent, number[]>;
  components.wages = m12(300);
  const wb = buildPayrollWorkbook({
    fiscalYear: 2027,
    scopeLabel: "Payroll Plan",
    positions: [pos("Zed", 200), pos("Amy", 100)],
    components,
    groups: [{ name: "Avon", byMonth: m12(250) }, { name: "HDR", byMonth: m12(50) }],
  });
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Positions", "Cost Detail", "By Month", "By Company"]);
  const ws = wb.getWorksheet("Positions")!;
  assert.equal(ws.getCell("B2").value, "Name");
  assert.equal(ws.getCell("A2").value, null);
  assert.equal(ws.getCell("B3").value, "Amy");
  assert.equal(ws.getCell("B4").value, "Zed");
  assert.equal(ws.getCell("E3").value, "Active");
  assert.equal(ws.getCell("F2").value, "Hired Through");
  assert.equal(ws.getCell("F3").value, "Silverco Enterprises");
  assert.equal(ws.getCell("L3").numFmt, '#,##0.00;[Red](#,##0.00);"-"');
  // Jan in column P (B + 14 text columns), total in AB, total row on 5
  assert.equal(ws.getCell("P3").value, 100);
  assert.deepEqual(ws.getCell("AB3").value, { formula: "SUM(P3:AA3)" });
  assert.equal(ws.getCell("B5").value, "Total");
  assert.deepEqual(ws.getCell("P5").value, { formula: "SUM(P3:P4)" });

  // Round trip: file opens and keeps the rows
  const buf = await wb.xlsx.writeBuffer();
  const ExcelJS = (await import("exceljs")).default;
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buf as ArrayBuffer);
  assert.equal(back.getWorksheet("Cost Detail")!.getCell("B4").value, "Zed");
});

test("payroll workbook: no By Company tab without groups, file name", () => {
  const components = Object.fromEntries(COST_COMPONENTS.map((k) => [k, m12(0)])) as Record<CostComponent, number[]>;
  const wb = buildPayrollWorkbook({ fiscalYear: 2027, scopeLabel: "Avon Payroll", positions: [], components, groups: [] });
  assert.equal(wb.getWorksheet("By Company"), undefined);
  assert.equal(payrollExportFileName(2027, "Avon / HDR Payroll"), "Avon  HDR Payroll 2027.xlsx");
});
