/**
 * The budget "master list" workbook: one tab, one long list. Per reporting
 * group, every account line with its items beneath it, then a Consolidated
 * block. Columns: last year's closed months (Jan through `through`), last
 * year's total and monthly average, then the budget months, total, average
 * and the change in the monthly average. Account rows sum their item rows
 * with formulas, and Total and Consolidated rows are SUMIFS over Account rows,
 * so edits made in Excel flow through. Intercompany accounts stay in each
 * group but are left out of the Consolidated block.
 */
import ExcelJS from "exceljs";
import type { ModelItem } from "@/lib/budget/model";
import { MONTH_ABBRS } from "@/lib/budget/format";

export interface MasterModel {
  priorYear: Record<string, number[]>;
  sections: Array<{
    id: string;
    title: string;
    masters: Array<{ id: string; accountNumber: string | null; name: string; months: number[]; items: ModelItem[]; ownNumber?: boolean; zeroMonths?: number[] }>;
  }>;
}

export interface MasterGroup {
  name: string;
  versionName: string;
  model: MasterModel;
}

const KIND_LABEL: Record<ModelItem["kind"], string> = {
  payroll: "Payroll",
  schedule: "Schedule",
  driver: "Fleet driver",
  capex: "Capex",
  run_rate: "Run rate",
  method: "Method",
  manual: "Item",
  entered: "Entered amount",
  zeroed: "Zeroed months",
};

const MONEY = '#,##0;[Red](#,##0);"-"';
const PCT = '0.0%;[Red]-0.0%;"-"';
// SUMIFS ranges run to a fixed bottom row so rows added in Excel are still counted
const MAX_ROW = 5000;

export function buildMasterWorkbook(opts: { fiscalYear: number; kind: "budget" | "forecast"; through: number; groups: MasterGroup[]; intercompany: Set<string>; exportedOn: string }): ExcelJS.Workbook {
  const { fiscalYear, kind, through, intercompany } = opts;
  const models = opts.groups;
  // ---- Layout: column A and row 1 blank; header on row 2 from column B
  const py = fiscalYear - 1;
  const pyMonths = MONTH_ABBRS.slice(0, through);
  const headers = [
    "Entity", "Section", "Account", "Account Name", "Level", "Line", "Type", "Method",
    ...pyMonths.map((m) => `${m} ${py}`), `${py} ${through === 12 ? "Total" : `${MONTH_ABBRS[0]}-${MONTH_ABBRS[through - 1]}`}`, `${py} Avg / Mo`,
    ...MONTH_ABBRS.map((m) => `${m} ${fiscalYear}`), `${fiscalYear} Total`, `${fiscalYear} Avg / Mo`,
    "Avg Change", "Avg Change %",
  ];
  const C0 = 2; // column B
  const col = (name: string) => C0 + headers.indexOf(name);
  const L = (c: number) => columnLetter(c);
  const cEntity = col("Entity"), cSection = col("Section"), cAccount = col("Account"), cLevel = col("Level");
  const cPyFirst = C0 + 8, cPyLast = cPyFirst + through - 1, cPyTotal = cPyLast + 1, cPyAvg = cPyLast + 2;
  const cBFirst = cPyAvg + 1, cBLast = cBFirst + 11, cBTotal = cBLast + 1, cBAvg = cBLast + 2, cChg = cBLast + 3, cChgPct = cBLast + 4;
  const HEADER_ROW = 2;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Closebook";
  const ws = wb.addWorksheet(`${fiscalYear} ${kind === "budget" ? "Budget" : "Forecast"} Master`, { views: [{ state: "frozen", xSplit: cAccount + 1, ySplit: HEADER_ROW }] });
  ws.properties.defaultRowHeight = 15;
  ws.getColumn(1).width = 2;
  const widths: Record<string, number> = { Entity: 16, Section: 22, Account: 9, "Account Name": 32, Level: 9, Line: 40, Type: 14, Method: 40 };
  headers.forEach((h, i) => (ws.getColumn(C0 + i).width = widths[h] ?? 13));
  const header = ws.getRow(HEADER_ROW);
  headers.forEach((h, i) => {
    const c = header.getCell(C0 + i);
    c.value = h;
    c.font = { name: "Calibri", size: 11, bold: true };
    c.border = { bottom: { style: "thin" } };
    if (i >= 8) c.alignment = { horizontal: "right" };
  });

  let r = HEADER_ROW + 1;
  const accountRows: Array<{ row: number }> = [];
  const rowRef = (c: number, row: number) => `${L(c)}${row}`;
  const writeRow = (vals: {
    entity: string; section: string; account: string; accountName: string; level: "Account" | "Detail" | "Total"; line: string; type?: string; method?: string;
    prior?: number[] | null; budget?: number[] | null; budgetFormulaRange?: [number, number] | null; sumifs?: { criteria: string } | null; bold?: boolean;
  }) => {
    const row = ws.getRow(r);
    row.getCell(cEntity).value = vals.entity;
    row.getCell(cSection).value = vals.section;
    row.getCell(cAccount).value = vals.account;
    row.getCell(col("Account Name")).value = vals.accountName;
    row.getCell(cLevel).value = vals.level;
    row.getCell(col("Line")).value = vals.line;
    row.getCell(col("Type")).value = vals.type ?? "";
    row.getCell(col("Method")).value = vals.method ?? "";
    const numCols = [...range(cPyFirst, cPyLast), ...range(cBFirst, cBLast)];
    for (const c of numCols) {
      const cell = row.getCell(c);
      const isPrior = c <= cPyLast;
      const i = isPrior ? c - cPyFirst : c - cBFirst;
      if (vals.sumifs) {
        cell.value = { formula: `SUMIFS(${L(c)}$${HEADER_ROW + 1}:${L(c)}$${MAX_ROW},$${L(cLevel)}$${HEADER_ROW + 1}:$${L(cLevel)}$${MAX_ROW},"Account",${vals.sumifs.criteria})` };
      } else if (!isPrior && vals.budgetFormulaRange) {
        cell.value = { formula: `SUM(${L(c)}${vals.budgetFormulaRange[0]}:${L(c)}${vals.budgetFormulaRange[1]})` };
      } else {
        const src = isPrior ? vals.prior : vals.budget;
        if (src) cell.value = round2(src[i] ?? 0);
      }
    }
    if (vals.prior || vals.sumifs) {
      row.getCell(cPyTotal).value = { formula: `SUM(${rowRef(cPyFirst, r)}:${rowRef(cPyLast, r)})` };
      row.getCell(cPyAvg).value = { formula: `${rowRef(cPyTotal, r)}/${through}` };
    }
    row.getCell(cBTotal).value = { formula: `SUM(${rowRef(cBFirst, r)}:${rowRef(cBLast, r)})` };
    row.getCell(cBAvg).value = { formula: `${rowRef(cBTotal, r)}/12` };
    if (vals.prior || vals.sumifs) {
      row.getCell(cChg).value = { formula: `${rowRef(cBAvg, r)}-${rowRef(cPyAvg, r)}` };
      row.getCell(cChgPct).value = { formula: `IF(${rowRef(cPyAvg, r)}=0,0,${rowRef(cChg, r)}/ABS(${rowRef(cPyAvg, r)}))` };
    }
    for (let c = C0; c <= cChgPct; c++) {
      const cell = row.getCell(c);
      cell.font = { name: "Calibri", size: 11, bold: !!vals.bold, color: vals.level === "Detail" ? { argb: "FF595959" } : undefined };
      cell.alignment = { wrapText: false, vertical: "middle" };
      if (c >= cPyFirst) cell.numFmt = c === cChgPct ? PCT : MONEY;
    }
    row.height = 15;
    return r++;
  };

  // Consolidated rows, in first-seen order: account key -> label
  const consolidated = new Map<string, { section: string; account: string; name: string }>();
  const sectionOrder: string[] = [];

  for (const { name: entity, model } of models) {
    for (const s of model.sections) {
      if (!sectionOrder.includes(s.title)) sectionOrder.push(s.title);
      for (const m of s.masters) {
        const prior = model.priorYear[m.id] ?? null;
        const has = m.months.some((v) => v !== 0) || m.items.length > 0 || (prior ?? []).some((v) => v !== 0);
        if (!has) continue;
        const account = m.accountNumber ?? "";
        const ic = intercompany.has(m.id);
        const items = m.items.filter((it) => it.months.some((v) => v !== 0) || it.kind !== "zeroed");
        // Anything on the line that no item explains (typed cells next to builds) gets its own row, so the account ties to the budget page
        if (items.length) {
          const rest = m.months.map((v, i) => round2(v - items.reduce((t, it) => t + (it.months[i] ?? 0), 0)));
          if (rest.some((v) => Math.abs(v) >= 0.01)) items.push({ id: `rest-${m.id}`, kind: "entered", label: "Other amounts on the line", source: "Line", sourceHref: null, methodText: "Typed into the line, not in an item", method: null, note: null, count: null, months: rest, total: round2(rest.reduce((a, b) => a + b, 0)), editable: false, history: null });
        }
        const accountRow = r;
        writeRow({
          entity, section: s.title, account, accountName: m.name, level: "Account", line: ic ? `${m.name} (intercompany)` : m.name,
          type: m.ownNumber ? "Own number" : "", method: m.zeroMonths?.length ? `$0 in ${m.zeroMonths.map((x) => MONTH_ABBRS[x - 1]).join(", ")}` : "",
          prior: prior ?? new Array(12).fill(0), budget: items.length ? null : m.months, budgetFormulaRange: items.length ? [accountRow + 1, accountRow + items.length] : null, bold: true,
        });
        accountRows.push({ row: accountRow });
        for (const it of items) {
          writeRow({ entity, section: s.title, account, accountName: m.name, level: "Detail", line: it.label, type: KIND_LABEL[it.kind] ?? it.kind, method: it.methodText ?? it.source ?? "", budget: it.months });
        }
        if (!ic) {
          const key = `${s.title}|${account}|${m.name}`;
          if (!consolidated.has(key)) consolidated.set(key, { section: s.title, account, name: m.name });
        }
      }
    }
    // Section totals for the group
    for (const title of model.sections.map((s) => s.title)) {
      writeRow({
        entity, section: title, account: "", accountName: "", level: "Total", line: `Total ${title}`,
        sumifs: { criteria: `$${L(cEntity)}$${HEADER_ROW + 1}:$${L(cEntity)}$${MAX_ROW},"${esc(entity)}",$${L(cSection)}$${HEADER_ROW + 1}:$${L(cSection)}$${MAX_ROW},"${esc(title)}"` }, bold: true,
      });
    }
    r++; // spacer
  }

  // Consolidated block: SUMIFS over every group's account rows
  const CONS = "Consolidated";
  for (const title of sectionOrder) {
    for (const c of consolidated.values()) {
      if (c.section !== title) continue;
      writeRow({
        entity: CONS, section: title, account: c.account, accountName: c.name, level: "Account", line: c.name,
        sumifs: { criteria: `$${L(cEntity)}$${HEADER_ROW + 1}:$${L(cEntity)}$${MAX_ROW},"<>${CONS}",$${L(cSection)}$${HEADER_ROW + 1}:$${L(cSection)}$${MAX_ROW},"${esc(title)}",$${L(cAccount)}$${HEADER_ROW + 1}:$${L(cAccount)}$${MAX_ROW},"${esc(c.account)}",$${L(col("Account Name"))}$${HEADER_ROW + 1}:$${L(col("Account Name"))}$${MAX_ROW},"${esc(c.name)}"` },
        bold: true,
      });
    }
    writeRow({
      entity: CONS, section: title, account: "", accountName: "", level: "Total", line: `Total ${title}`,
      sumifs: { criteria: `$${L(cEntity)}$${HEADER_ROW + 1}:$${L(cEntity)}$${MAX_ROW},"${CONS}",$${L(cSection)}$${HEADER_ROW + 1}:$${L(cSection)}$${MAX_ROW},"${esc(title)}"` }, bold: true,
    });
  }
  r++;
  const note = ws.getRow(r + 1).getCell(C0);
  note.value = `${py} = Financial Model actuals, ${MONTH_ABBRS[0]}-${MONTH_ABBRS[through - 1]} (closed months). ${fiscalYear} = ${models.map((x) => `${x.name}: ${x.versionName}`).join("; ")}. Account rows sum the Detail rows beneath them; Total and Consolidated rows are SUMIFS over Account rows, so edits flow through. Intercompany accounts are left out of Consolidated. Exported ${opts.exportedOn}.`;
  note.font = { name: "Calibri", size: 11, italic: true, color: { argb: "FF595959" } };
  note.alignment = { wrapText: false };
  ws.autoFilter = { from: { row: HEADER_ROW, column: C0 }, to: { row: HEADER_ROW, column: cChgPct } };

  return wb;
}

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Text inside a formula string: double the quotes; wildcards are escaped for SUMIFS */
function esc(s: string): string {
  return s.replace(/"/g, '""').replace(/([*?~])/g, "~$1");
}

function columnLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
