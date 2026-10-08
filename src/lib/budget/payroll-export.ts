/**
 * The payroll plan workbook, built from what the plan page already has
 * loaded and priced (so it ties to the page, and a version's export is that
 * group's share). Tabs:
 *  1. Positions    - one row per person: tags, pay in force, cost by month
 *  2. Cost Detail  - one row per person: full-year cost by component
 *  3. By Month     - component by month for the whole plan
 *  4. By Company   - reporting group by month (when the page has groups)
 * Totals are formulas so edits made in Excel flow through. House format:
 * Calibri 11, rows 15 high, no wrap, column A and row 1 blank.
 */
import ExcelJS from "exceljs";
import { MONTH_ABBRS } from "@/lib/budget/format";
import { COMPONENT_LABELS, COST_COMPONENTS, type CostComponent } from "@/lib/budget/personnel-engine";

export interface PayrollExportPosition {
  name: string;
  title: string | null;
  employeeId: string | null;
  status: string;
  company: string;
  location: string;
  class: string;
  function: string;
  payType: string;
  /** Pay in force: hourly rate or annual salary (or the monthly amount for Amount rows) */
  pay: number | null;
  adjustment: string | null;
  startMonth: number;
  endMonth: number | null;
  byMonth: number[];
  components: Record<CostComponent, number>;
}

export interface PayrollExportInput {
  fiscalYear: number;
  /** "Payroll Plan" or the group's name for a version's share */
  scopeLabel: string;
  positions: PayrollExportPosition[];
  components: Record<CostComponent, number[]>;
  groups: Array<{ name: string; byMonth: number[] }>;
}

const MONEY = '#,##0;[Red](#,##0);"-"';
const MONEY_CENTS = '#,##0.00;[Red](#,##0.00);"-"';
const FONT = { name: "Calibri", size: 11 } as const;
const C0 = 2; // column B

export function buildPayrollWorkbook(input: PayrollExportInput): ExcelJS.Workbook {
  const { fiscalYear } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Closebook";
  const positions = [...input.positions].sort((a, b) => a.name.localeCompare(b.name));
  const monthHeads = MONTH_ABBRS.map((m) => `${m} ${fiscalYear}`);

  // ---- 1. Positions
  {
    const text = ["Name", "Title", "Employee ID", "Status", "Company", "Location", "Class", "Function", "Pay Type", "Pay", "Adjustment", "Start", "End"];
    const ws = sheet(wb, "Positions", [...text, ...monthHeads, `${fiscalYear} Total`], text.length, { Name: 28, Title: 28, Company: 22, Adjustment: 22 });
    const cFirst = C0 + text.length;
    const first = 3;
    positions.forEach((p, i) => {
      const r = first + i;
      const row = ws.getRow(r);
      const vals: Array<string | number | null> = [
        p.name, p.title ?? "", p.employeeId ?? "", titleCase(p.status), p.company, p.location, p.class, p.function, p.payType, p.pay,
        p.adjustment ?? "", MONTH_ABBRS[clampMonth(p.startMonth) - 1], p.endMonth ? MONTH_ABBRS[clampMonth(p.endMonth) - 1] : "",
      ];
      vals.forEach((v, j) => (row.getCell(C0 + j).value = v));
      row.getCell(C0 + 9).numFmt = MONEY_CENTS;
      p.byMonth.forEach((v, m) => (row.getCell(cFirst + m).value = round2(v)));
      row.getCell(cFirst + 12).value = { formula: `SUM(${L(cFirst)}${r}:${L(cFirst + 11)}${r})` };
      styleRow(row, cFirst, cFirst + 12);
    });
    totalRow(ws, first, first + positions.length - 1, cFirst, cFirst + 12, "Total");
  }

  // ---- 2. Cost Detail
  {
    const text = ["Name", "Title", "Status", "Company"];
    const ws = sheet(wb, "Cost Detail", [...text, ...COST_COMPONENTS.map((c) => COMPONENT_LABELS[c]), `${fiscalYear} Total`], text.length, { Name: 28, Title: 28, Company: 22 });
    const cFirst = C0 + text.length;
    const cLast = cFirst + COST_COMPONENTS.length - 1;
    const first = 3;
    positions.forEach((p, i) => {
      const r = first + i;
      const row = ws.getRow(r);
      [p.name, p.title ?? "", titleCase(p.status), p.company].forEach((v, j) => (row.getCell(C0 + j).value = v));
      COST_COMPONENTS.forEach((c, j) => (row.getCell(cFirst + j).value = round2(p.components[c] ?? 0)));
      row.getCell(cLast + 1).value = { formula: `SUM(${L(cFirst)}${r}:${L(cLast)}${r})` };
      styleRow(row, cFirst, cLast + 1);
    });
    totalRow(ws, first, first + positions.length - 1, cFirst, cLast + 1, "Total");
  }

  // ---- 3. By Month
  {
    const ws = sheet(wb, "By Month", ["Component", ...monthHeads, `${fiscalYear} Total`], 1, { Component: 28 });
    const cFirst = C0 + 1;
    const first = 3;
    COST_COMPONENTS.forEach((c, i) => {
      const r = first + i;
      const row = ws.getRow(r);
      row.getCell(C0).value = COMPONENT_LABELS[c];
      (input.components[c] ?? []).forEach((v, m) => (row.getCell(cFirst + m).value = round2(v)));
      row.getCell(cFirst + 12).value = { formula: `SUM(${L(cFirst)}${r}:${L(cFirst + 11)}${r})` };
      styleRow(row, cFirst, cFirst + 12);
    });
    totalRow(ws, first, first + COST_COMPONENTS.length - 1, cFirst, cFirst + 12, "Total");
  }

  // ---- 4. By Company
  if (input.groups.length > 0) {
    const ws = sheet(wb, "By Company", ["Company", ...monthHeads, `${fiscalYear} Total`], 1, { Company: 28 });
    const cFirst = C0 + 1;
    const first = 3;
    input.groups.forEach((g, i) => {
      const r = first + i;
      const row = ws.getRow(r);
      row.getCell(C0).value = g.name;
      g.byMonth.forEach((v, m) => (row.getCell(cFirst + m).value = round2(v)));
      row.getCell(cFirst + 12).value = { formula: `SUM(${L(cFirst)}${r}:${L(cFirst + 11)}${r})` };
      styleRow(row, cFirst, cFirst + 12);
    });
    totalRow(ws, first, first + input.groups.length - 1, cFirst, cFirst + 12, "Total");
  }

  return wb;
}

/** File name, e.g. "Payroll Plan 2027.xlsx" */
export function payrollExportFileName(fiscalYear: number, scopeLabel: string): string {
  return `${scopeLabel.replace(/[\\/:*?"<>|]/g, "")} ${fiscalYear}.xlsx`;
}

/** A tab with column A and row 1 blank, header on row 2, frozen at the text columns. */
function sheet(wb: ExcelJS.Workbook, name: string, headers: string[], textCols: number, widths: Record<string, number>): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: C0, ySplit: 2 }] });
  ws.properties.defaultRowHeight = 15;
  ws.getColumn(1).width = 2;
  headers.forEach((h, i) => (ws.getColumn(C0 + i).width = widths[h] ?? (i < textCols ? 14 : 13)));
  const row = ws.getRow(2);
  headers.forEach((h, i) => {
    const c = row.getCell(C0 + i);
    c.value = h;
    c.font = { ...FONT, bold: true };
    c.border = { bottom: { style: "thin" } };
    c.alignment = { horizontal: i >= textCols ? "right" : "left", wrapText: false };
  });
  row.height = 15;
  return ws;
}

function styleRow(row: ExcelJS.Row, cNumFirst: number, cLast: number, bold = false) {
  for (let c = C0; c <= cLast; c++) {
    const cell = row.getCell(c);
    cell.font = { ...FONT, bold };
    cell.alignment = { wrapText: false, vertical: "middle" };
    if (c >= cNumFirst) cell.numFmt = MONEY;
  }
  row.height = 15;
}

function totalRow(ws: ExcelJS.Worksheet, first: number, last: number, cFirst: number, cLast: number, label: string) {
  const r = Math.max(last, first - 1) + 1;
  const row = ws.getRow(r);
  row.getCell(C0).value = label;
  for (let c = cFirst; c <= cLast; c++) {
    row.getCell(c).value = last >= first ? { formula: `SUM(${L(c)}${first}:${L(c)}${last})` } : 0;
  }
  styleRow(row, cFirst, cLast, true);
  for (let c = C0; c <= cLast; c++) row.getCell(c).border = { top: { style: "thin" } };
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function clampMonth(m: number): number {
  return Math.min(12, Math.max(1, Math.round(m || 1)));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function L(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
