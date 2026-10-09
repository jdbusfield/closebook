/**
 * The budget model workbook (Export master list). Three tabs:
 *
 * - Summary: an income statement for the consolidated organization and for
 *   each reporting group (revenue, direct costs, gross margin, operating
 *   costs, EBITDA, other expense / income, net income). Every account cell is
 *   a SUMIFS into Detail, so the statements roll up from the detail.
 * - Detail: per group, every account line with its items grouped beneath it
 *   (collapsible). Each item shows its driver. Where the item's method can be
 *   written as a formula (flat, annual even, one time, % of another line) the
 *   months are live formulas off the Driver cell, so changing a driver flows
 *   through to the account, the statements and the consolidated view. Other
 *   items keep CloseBook's amounts as inputs. A formula is only used when it
 *   reproduces CloseBook's amounts at export time.
 * - Assumptions: each group's stored budget assumptions.
 *
 * Last year's columns are the closed months (Jan through `through`) from the
 * Financial Model, at account level. Intercompany accounts stay in each
 * group's statement and are left out of the consolidated one.
 *
 * Formatting follows the usual model conventions: blue = typed inputs, black =
 * formulas, green = links to another tab. House format: Calibri 11, rows 15,
 * no wrap, column A and row 1 blank.
 */
import ExcelJS from "exceljs";
import type { ModelItem } from "@/lib/budget/model";
import type { LineMethod } from "@/lib/budget/line-methods";
import { MONTH_ABBRS } from "@/lib/budget/format";

export interface MasterModel {
  priorYear: Record<string, number[]>;
  sections: Array<{
    id: string;
    title: string;
    masters: Array<{ id: string; accountNumber: string | null; name: string; months: number[]; items: ModelItem[]; ownNumber?: boolean; zeroMonths?: number[] }>;
  }>;
}

export interface MasterAssumption {
  label: string;
  key: string;
  scope: string;
  value: number | null;
  unit: string | null;
  text: string | null;
  note: string | null;
}

export interface MasterGroup {
  name: string;
  versionName: string;
  model: MasterModel;
  assumptions?: MasterAssumption[];
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

const FONT = "Calibri";
const BLUE = "FF0000FF";
const GREEN = "FF008000";
const GREY = "FF595959";
const BAND = "FFDCE6F1";
const SUBBAND = "FFF2F2F2";
const MONEY = '#,##0_);(#,##0);"-"_)';
const PCT = '0.0%_);(0.0%);"-"_)';
const DRIVER_MONEY = '$#,##0_);($#,##0);"-"_)';
const DRIVER_PCT = '0.00%_);(0.00%);"-"_)';
const DRIVER_NUM = '#,##0_);(#,##0);"-"_)';
// SUMIFS ranges run to a fixed bottom row so rows added in Excel are still counted
const MAX_ROW = 6000;
const HEADER_ROW = 3;

type Cell = ExcelJS.Cell;

export function buildMasterWorkbook(opts: { fiscalYear: number; kind: "budget" | "forecast"; through: number; groups: MasterGroup[]; intercompany: Set<string>; exportedOn: string }): ExcelJS.Workbook {
  const { fiscalYear, kind, through, groups, intercompany } = opts;
  const py = fiscalYear - 1;
  const label = kind === "budget" ? "Budget" : "Forecast";
  const wb = new ExcelJS.Workbook();
  wb.creator = "Closebook";
  wb.calcProperties.fullCalcOnLoad = true;

  const summary = wb.addWorksheet("Summary");
  const detail = wb.addWorksheet("Detail");
  const assumptions = wb.addWorksheet("Assumptions");

  // ---------------------------------------------------------------- Detail
  // B Entity, C Section, D Account, E Account Name, F Level, G Line, H Type, I Driver, J Driver Unit, K Method, then numbers
  const D = { entity: 2, section: 3, account: 4, accountName: 5, level: 6, line: 7, type: 8, driver: 9, unit: 10, method: 11 };
  const dPyFirst = 12;
  const dPyLast = dPyFirst + through - 1;
  const dPyTotal = dPyLast + 1;
  const dPyAvg = dPyLast + 2;
  const dBFirst = dPyAvg + 1;
  const dBLast = dBFirst + 11;
  const dBTotal = dBLast + 1;
  const dBAvg = dBLast + 2;
  const dLastCol = dBAvg;

  const pyRangeLabel = through === 12 ? `FY ${py}` : `${py} ${MONTH_ABBRS[0]}-${MONTH_ABBRS[through - 1]}`;
  const numberHeaders = [...MONTH_ABBRS.slice(0, through).map((m) => `${m}-${String(py).slice(2)}A`), pyRangeLabel, `${py} Avg / Mo`, ...MONTH_ABBRS.map((m) => `${m}-${String(fiscalYear).slice(2)}B`), `FY ${fiscalYear}`, `${fiscalYear} Avg / Mo`];

  setupSheet(detail, [2, 16, 24, 9, 30, 9, 42, 15, 12, 18, 46, ...numberHeaders.map(() => 12)]);
  bandRow(detail, 2, [
    [dPyFirst, dPyAvg, `${py} Actual (Financial Model, closed months)`],
    [dBFirst, dBAvg, `FY ${fiscalYear} ${label}`],
  ]);
  headerRow(detail, HEADER_ROW, ["Entity", "Section", "Account", "Account Name", "Level", "Line", "Type", "Driver", "Driver Unit", "Method", ...numberHeaders], 2, dPyFirst);
  detail.views = [{ state: "frozen", xSplit: D.line, ySplit: HEADER_ROW }];
  detail.properties.outlineProperties = { summaryBelow: false, summaryRight: true };
  detail.autoFilter = { from: { row: HEADER_ROW, column: 2 }, to: { row: HEADER_ROW, column: dLastCol } };
  outlineColumns(detail, dPyFirst, dPyLast);
  outlineColumns(detail, dBFirst, dBLast);

  // First pass: plan the rows, so % of line items can point at their source account row
  type Planned =
    | { type: "entity"; entity: string }
    | { type: "section"; entity: string; section: string }
    | { type: "account"; entity: string; section: string; m: MasterModel["sections"][number]["masters"][number]; prior: number[]; items: ModelItem[]; ic: boolean }
    | { type: "item"; entity: string; section: string; m: MasterModel["sections"][number]["masters"][number]; it: ModelItem; accountRow: number; firstItem: number; lastItem: number }
    | { type: "blank" };
  const plan: Planned[] = [];
  const accountRowOf = new Map<string, number>(); // `${entity}|${masterId}` -> row
  const accountsBySection = new Map<string, Map<string, { account: string; name: string; ic: boolean; entities: Set<string> }>>();
  const sectionOrder: Array<{ id: string; title: string }> = [];

  let row = HEADER_ROW + 1;
  for (const g of groups) {
    plan.push({ type: "entity", entity: g.name });
    row++;
    for (const s of g.model.sections) {
      if (!sectionOrder.some((x) => x.id === s.id)) sectionOrder.push({ id: s.id, title: s.title });
      const masters = s.masters.filter((m) => m.months.some((v) => v !== 0) || m.items.length > 0 || (g.model.priorYear[m.id] ?? []).some((v) => v !== 0));
      if (!masters.length) continue;
      plan.push({ type: "section", entity: g.name, section: s.title });
      row++;
      for (const m of masters) {
        const items = itemsFor(m);
        const accountRow = row;
        accountRowOf.set(`${g.name}|${m.id}`, accountRow);
        const ic = intercompany.has(m.id);
        plan.push({ type: "account", entity: g.name, section: s.title, m, prior: g.model.priorYear[m.id] ?? new Array(12).fill(0), items, ic });
        row++;
        items.forEach((it) => {
          plan.push({ type: "item", entity: g.name, section: s.title, m, it, accountRow, firstItem: accountRow + 1, lastItem: accountRow + items.length });
          row++;
        });
        const bySec = accountsBySection.get(s.id) ?? new Map();
        const key = `${m.accountNumber ?? ""}|${m.name}`;
        const a = bySec.get(key) ?? { account: m.accountNumber ?? "", name: m.name, ic, entities: new Set<string>() };
        a.entities.add(g.name);
        a.ic = a.ic || ic;
        bySec.set(key, a);
        accountsBySection.set(s.id, bySec);
      }
    }
    plan.push({ type: "blank" });
    row++;
  }

  // Second pass: write
  row = HEADER_ROW + 1;
  for (const p of plan) {
    const r = detail.getRow(row);
    r.height = 15;
    if (p.type === "blank") {
      row++;
      continue;
    }
    if (p.type === "entity") {
      r.getCell(D.entity).value = p.entity;
      r.getCell(D.line).value = `${p.entity}: ${groups.find((g) => g.name === p.entity)?.versionName ?? ""}`;
      styleRow(r, 2, dLastCol, { bold: true, fill: BAND });
    } else if (p.type === "section") {
      r.getCell(D.entity).value = p.entity;
      r.getCell(D.section).value = p.section;
      r.getCell(D.line).value = p.section;
      styleRow(r, 2, dLastCol, { bold: true, fill: SUBBAND });
    } else if (p.type === "account") {
      const { m } = p;
      put(r, D.entity, p.entity);
      put(r, D.section, p.section);
      put(r, D.account, m.accountNumber ?? "");
      put(r, D.accountName, m.name);
      put(r, D.level, "Account");
      put(r, D.line, p.ic ? `${m.name} (intercompany)` : m.name);
      put(r, D.type, m.ownNumber ? "Own number" : "");
      put(r, D.method, m.zeroMonths?.length ? `$0 in ${m.zeroMonths.map((x) => MONTH_ABBRS[x - 1]).join(", ")}` : "");
      for (let i = 0; i < through; i++) input(r.getCell(dPyFirst + i), round2(p.prior[i] ?? 0));
      for (let i = 0; i < 12; i++) {
        const c = r.getCell(dBFirst + i);
        if (p.items.length) formula(c, `SUM(${L(dBFirst + i)}${row + 1}:${L(dBFirst + i)}${row + p.items.length})`);
        else input(c, round2(m.months[i] ?? 0));
      }
      rowTotals(r, row, true);
      styleRow(r, 2, D.method, { bold: true });
      boldNumbers(r);
    } else {
      const { it, m } = p;
      r.outlineLevel = 1;
      put(r, D.entity, p.entity);
      put(r, D.section, p.section);
      put(r, D.account, m.accountNumber ?? "");
      put(r, D.accountName, m.name);
      put(r, D.level, "Detail");
      put(r, D.line, `  ${it.label}`);
      put(r, D.type, KIND_LABEL[it.kind] ?? it.kind);
      put(r, D.method, it.methodText ?? (it.count != null ? `${it.count} ${it.kind === "payroll" ? "people" : "rows"} (${it.source})` : it.source ?? ""));
      writeItemMonths(r, row, p);
      rowTotals(r, row, false);
      styleRow(r, 2, D.method, { color: GREY });
    }
    row++;
  }
  const note = detail.getRow(row + 1).getCell(2);
  note.value = `Blue = typed inputs (CloseBook amounts), black = formulas. Account rows sum the items beneath them. Items with a Driver formula recalculate when you change the Driver. ${py} columns are Financial Model actuals for the closed months, at account level. Exported ${opts.exportedOn}.`;
  note.font = { name: FONT, size: 11, italic: true, color: { argb: GREY } };

  function itemsFor(m: MasterModel["sections"][number]["masters"][number]): ModelItem[] {
    const items = m.items.filter((it) => it.months.some((v) => v !== 0) || it.kind !== "zeroed");
    // Anything on the line that no item explains (typed cells next to builds) gets its own row, so the account ties to the budget page
    if (items.length) {
      const rest = m.months.map((v, i) => round2(v - items.reduce((t, it) => t + (it.months[i] ?? 0), 0)));
      if (rest.some((v) => Math.abs(v) >= 0.01)) items.push({ id: `rest-${m.id}`, kind: "entered", label: "Other amounts on the line", source: "Line", sourceHref: null, methodText: "Typed into the line, not in an item", method: null, note: null, count: null, months: rest, total: round2(rest.reduce((a, b) => a + b, 0)), editable: false, history: null });
    }
    // The zeroed row goes last so its formula can net the rows above it
    return [...items.filter((it) => it.kind !== "zeroed"), ...items.filter((it) => it.kind === "zeroed")];
  }

  function writeItemMonths(r: ExcelJS.Row, rowNo: number, p: Extract<Planned, { type: "item" }>) {
    const { it } = p;
    const drv = `$${L(D.driver)}${rowNo}`;
    const inRange = (meth: LineMethod, i: number) => i + 1 >= Math.max(1, meth.start_month ?? 1) && i + 1 <= Math.min(12, meth.end_month ?? 12);

    if (it.kind === "zeroed") {
      const zero = new Set((p.m.zeroMonths ?? []).map((x) => x - 1));
      put(r, D.unit, "Held at $0");
      for (let i = 0; i < 12; i++) {
        const c = r.getCell(dBFirst + i);
        if (zero.has(i) && rowNo > p.firstItem) formula(c, `-SUM(${L(dBFirst + i)}${p.firstItem}:${L(dBFirst + i)}${rowNo - 1})`);
        else input(c, round2(it.months[i] ?? 0));
      }
      return;
    }

    const meth = it.method;
    let formulas: Array<string | null> | null = null;
    if (meth) {
      const amount = Number(meth.amount ?? 0);
      const pct = Number(meth.pct ?? 0) / 100;
      const reproduces = (vals: number[]) => vals.every((v, i) => Math.abs(v - (it.months[i] ?? 0)) < 0.005);
      if (meth.kind === "flat") {
        if (reproduces(it.months.map((_, i) => (inRange(meth, i) ? amount : 0)))) {
          driver(r, amount, "$ / month", DRIVER_MONEY);
          formulas = it.months.map((_, i) => (inRange(meth, i) ? `${drv}` : null));
        }
      } else if (meth.kind === "annual" && meth.spread !== "shape") {
        const n = Array.from({ length: 12 }, (_, i) => inRange(meth, i)).filter(Boolean).length || 1;
        if (reproduces(it.months.map((_, i) => (inRange(meth, i) ? amount / n : 0)))) {
          driver(r, amount, n === 12 ? "$ / year" : `$ over ${n} months`, DRIVER_MONEY);
          formulas = it.months.map((_, i) => (inRange(meth, i) ? `${drv}/${n}` : null));
        }
      } else if (meth.kind === "one_time") {
        const mi = Math.min(12, Math.max(1, Math.round(meth.month ?? 1))) - 1;
        if (reproduces(it.months.map((_, i) => (i === mi ? amount : 0)))) {
          driver(r, amount, `$ in ${MONTH_ABBRS[mi]}`, DRIVER_MONEY);
          formulas = it.months.map((_, i) => (i === mi ? `${drv}` : null));
        }
      } else if (meth.kind === "pct_of_line" && meth.source_master_id) {
        const srcRow = accountRowOf.get(`${p.entity}|${meth.source_master_id}`);
        const srcMaster = groups.find((g) => g.name === p.entity)?.model.sections.flatMap((s) => s.masters).find((x) => x.id === meth.source_master_id);
        if (srcRow && srcMaster && reproduces(srcMaster.months.map((v, i) => (inRange(meth, i) ? v * pct : 0)))) {
          driver(r, pct, `% of ${srcMaster.accountNumber ?? srcMaster.name}`, DRIVER_PCT);
          formulas = it.months.map((_, i) => (inRange(meth, i) ? `${drv}*${L(dBFirst + i)}$${srcRow}` : null));
        }
      }
      if (!formulas) {
        // Driver shown for reference; months stay CloseBook's amounts
        if (meth.kind === "prior_year") driver(r, pct, `change vs ${py}`, DRIVER_PCT, true);
        else if (meth.kind === "run_rate") driver(r, pct, "change vs run rate", DRIVER_PCT, true);
        else if (meth.kind === "pct_of_line") driver(r, pct, "% of another line", DRIVER_PCT, true);
        else if (meth.kind === "flat" || meth.kind === "annual" || meth.kind === "one_time") driver(r, amount, meth.kind === "flat" ? "$ / month" : meth.kind === "annual" ? "$ / year" : "$", DRIVER_MONEY, true);
      }
    } else if (it.count != null) {
      driver(r, it.count, it.kind === "payroll" ? "people" : it.kind === "schedule" ? "rows" : "count", DRIVER_NUM, true);
    }
    for (let i = 0; i < 12; i++) {
      const c = r.getCell(dBFirst + i);
      const f = formulas?.[i];
      if (formulas) {
        if (f) formula(c, f);
        else input(c, 0);
      } else input(c, round2(it.months[i] ?? 0));
    }
  }

  /** Driver value: blue when it feeds the months, grey when it is for reference only */
  function driver(r: ExcelJS.Row, value: number, unit: string, numFmt: string, referenceOnly = false) {
    const c = r.getCell(D.driver);
    c.value = value;
    c.numFmt = numFmt;
    c.font = { name: FONT, size: 11, color: { argb: referenceOnly ? GREY : BLUE } };
    put(r, D.unit, referenceOnly ? `${unit} (reference)` : unit);
  }

  function rowTotals(r: ExcelJS.Row, rowNo: number, withPrior: boolean) {
    if (withPrior) {
      formula(r.getCell(dPyTotal), `SUM(${L(dPyFirst)}${rowNo}:${L(dPyLast)}${rowNo})`);
      formula(r.getCell(dPyAvg), `${L(dPyTotal)}${rowNo}/${through}`);
    }
    formula(r.getCell(dBTotal), `SUM(${L(dBFirst)}${rowNo}:${L(dBLast)}${rowNo})`);
    formula(r.getCell(dBAvg), `${L(dBTotal)}${rowNo}/12`);
  }

  function boldNumbers(r: ExcelJS.Row) {
    for (let c = dPyFirst; c <= dLastCol; c++) {
      const cell = r.getCell(c);
      cell.font = { ...(cell.font ?? {}), name: FONT, size: 11, bold: true };
    }
  }

  // ---------------------------------------------------------------- Summary
  // B line label, then the same number columns as Detail plus the change in the monthly average
  const S = { label: 2 };
  const sPyFirst = 3;
  const sPyLast = sPyFirst + through - 1;
  const sPyTotal = sPyLast + 1;
  const sPyAvg = sPyLast + 2;
  const sBFirst = sPyAvg + 1;
  const sBLast = sBFirst + 11;
  const sBTotal = sBLast + 1;
  const sBAvg = sBLast + 2;
  const sChg = sBLast + 3;
  const sChgPct = sBLast + 4;
  const toDetailCol = (sc: number) => (sc <= sPyAvg ? dPyFirst + (sc - sPyFirst) : dBFirst + (sc - sBFirst));
  const numericCols = [...range(sPyFirst, sPyLast), ...range(sBFirst, sBLast)];

  setupSheet(summary, [2, 46, ...numberHeaders.map(() => 12), 12, 10]);
  bandRow(summary, 2, [
    [sPyFirst, sPyAvg, `${py} Actual (closed months)`],
    [sBFirst, sChgPct, `FY ${fiscalYear} ${label}`],
  ]);
  headerRow(summary, HEADER_ROW, ["Income Statement", ...numberHeaders, "Avg Change", "Avg Change %"], 2, sPyFirst);
  summary.views = [{ state: "frozen", xSplit: 2, ySplit: HEADER_ROW }];
  outlineColumns(summary, sPyFirst, sPyLast);
  outlineColumns(summary, sBFirst, sBLast);

  const dRange = (c: number) => `Detail!$${L(c)}$${HEADER_ROW + 1}:$${L(c)}$${MAX_ROW}`;
  let sr = HEADER_ROW + 1;
  const blocks: Array<{ name: string; entity: string | null }> = [{ name: "Consolidated", entity: null }, ...groups.map((g) => ({ name: g.name, entity: g.name }))];

  for (const b of blocks) {
    const titleRow = summary.getRow(sr);
    titleRow.getCell(S.label).value = b.entity ? `${b.name}: ${groups.find((g) => g.name === b.name)?.versionName ?? ""}` : `Consolidated (intercompany eliminated)`;
    styleRow(titleRow, 2, sChgPct, { bold: true, fill: BAND });
    titleRow.height = 15;
    sr++;
    const totals = new Map<string, number>(); // section id -> total row
    for (const sec of sectionOrder) {
      const accounts = [...(accountsBySection.get(sec.id)?.values() ?? [])].filter((a) => (b.entity ? a.entities.has(b.entity) : !a.ic)).sort((x, y) => x.account.localeCompare(y.account) || x.name.localeCompare(y.name));
      const head = summary.getRow(sr);
      head.getCell(S.label).value = sec.title;
      styleRow(head, 2, 2, { bold: true });
      head.height = 15;
      sr++;
      const first = sr;
      for (const a of accounts) {
        const r = summary.getRow(sr);
        r.height = 15;
        const lbl = r.getCell(S.label);
        lbl.value = `${a.account ? `${a.account} ` : ""}${a.name}${b.entity && a.ic ? " (intercompany)" : ""}`;
        lbl.font = { name: FONT, size: 11 };
        lbl.alignment = { indent: 1 };
        const crit = [`${dRange(D.level)},"Account"`, `${dRange(D.account)},"${esc(a.account)}"`, `${dRange(D.accountName)},"${esc(a.name)}"`];
        if (b.entity) crit.push(`${dRange(D.entity)},"${esc(b.entity)}"`);
        for (const c of numericCols) link(r.getCell(c), `SUMIFS(${dRange(toDetailCol(c))},${crit.join(",")})`);
        summaryRowTotals(r, sr);
        sr++;
      }
      const t = summary.getRow(sr);
      t.height = 15;
      t.getCell(S.label).value = `Total ${sec.title}`;
      for (const c of numericCols) formula(t.getCell(c), accounts.length ? `SUM(${L(c)}${first}:${L(c)}${sr - 1})` : "0");
      summaryRowTotals(t, sr);
      totalStyle(t, "thin");
      totals.set(sec.id, sr);
      sr++;

      const rev = totals.get("revenue");
      if (sec.id === "direct_operating_costs" && rev) {
        sr = derived(sr, "Gross Margin", (c) => `${L(c)}${rev}-${L(c)}${totals.get("direct_operating_costs")}`, rev, "Gross Margin %");
      }
      if (sec.id === "other_operating_costs" && rev) {
        const dc = totals.get("direct_operating_costs");
        sr = derived(sr, "EBITDA", (c) => `${L(c)}${rev}${dc ? `-${L(c)}${dc}` : ""}-${L(c)}${totals.get("other_operating_costs")}`, rev, "EBITDA %");
        totals.set("ebitda", sr - 2);
      }
      sr++;
    }
    const ebitda = totals.get("ebitda");
    if (ebitda) {
      const oe = totals.get("other_expense");
      const oi = totals.get("other_income");
      const r = summary.getRow(sr);
      r.height = 15;
      r.getCell(S.label).value = "Net Income";
      for (const c of numericCols) formula(r.getCell(c), `${L(c)}${ebitda}${oe ? `-${L(c)}${oe}` : ""}${oi ? `+${L(c)}${oi}` : ""}`);
      summaryRowTotals(r, sr);
      totalStyle(r, "double");
      sr++;
    }
    sr += 2;
  }
  const sNote = summary.getRow(sr).getCell(2);
  sNote.value = `Green = links to Detail; black = formulas. Each account is a SUMIFS of its Detail account row, and each Detail account row sums its items. Consolidated leaves out intercompany accounts. ${py} = Financial Model actuals, ${MONTH_ABBRS[0]}-${MONTH_ABBRS[through - 1]}. Exported ${opts.exportedOn}.`;
  sNote.font = { name: FONT, size: 11, italic: true, color: { argb: GREY } };

  function summaryRowTotals(r: ExcelJS.Row, rowNo: number) {
    formula(r.getCell(sPyTotal), `SUM(${L(sPyFirst)}${rowNo}:${L(sPyLast)}${rowNo})`);
    formula(r.getCell(sPyAvg), `${L(sPyTotal)}${rowNo}/${through}`);
    formula(r.getCell(sBTotal), `SUM(${L(sBFirst)}${rowNo}:${L(sBLast)}${rowNo})`);
    formula(r.getCell(sBAvg), `${L(sBTotal)}${rowNo}/12`);
    formula(r.getCell(sChg), `${L(sBAvg)}${rowNo}-${L(sPyAvg)}${rowNo}`);
    formula(r.getCell(sChgPct), `IF(${L(sPyAvg)}${rowNo}=0,0,${L(sChg)}${rowNo}/ABS(${L(sPyAvg)}${rowNo}))`);
    r.getCell(sChgPct).numFmt = PCT;
  }

  /** A margin row and its % of revenue row; returns the next free row */
  function derived(at: number, name: string, f: (c: number) => string, revRow: number, pctName: string): number {
    const r = summary.getRow(at);
    r.height = 15;
    r.getCell(S.label).value = name;
    for (const c of numericCols) formula(r.getCell(c), f(c));
    summaryRowTotals(r, at);
    totalStyle(r, "thin");
    const p = summary.getRow(at + 1);
    p.height = 15;
    const pl = p.getCell(S.label);
    pl.value = pctName;
    pl.font = { name: FONT, size: 11, italic: true };
    pl.alignment = { indent: 1 };
    for (const c of [...numericCols, sPyTotal, sPyAvg, sBTotal, sBAvg]) {
      const cell = p.getCell(c);
      formula(cell, `IF(${L(c)}${revRow}=0,0,${L(c)}${at}/${L(c)}${revRow})`);
      cell.numFmt = PCT;
      cell.font = { name: FONT, size: 11, italic: true };
    }
    return at + 2;
  }

  function totalStyle(r: ExcelJS.Row, bottom: "thin" | "double") {
    for (let c = 2; c <= sChgPct; c++) {
      const cell = r.getCell(c);
      cell.font = { name: FONT, size: 11, bold: true, color: cell.font?.color };
      cell.border = { top: { style: "thin" }, ...(bottom === "double" ? { bottom: { style: "double" } } : {}) };
    }
  }

  // ---------------------------------------------------------------- Assumptions
  setupSheet(assumptions, [2, 16, 40, 26, 12, 14, 12, 30, 60]);
  headerRow(assumptions, HEADER_ROW, ["Entity", "Assumption", "Key", "Scope", "Value", "Unit", "Text", "Note"], 2, 6);
  assumptions.views = [{ state: "frozen", xSplit: 0, ySplit: HEADER_ROW }];
  let ar = HEADER_ROW + 1;
  for (const g of groups) {
    const list = g.assumptions ?? [];
    const b = assumptions.getRow(ar);
    b.getCell(2).value = `${g.name}: ${g.versionName}`;
    styleRow(b, 2, 9, { bold: true, fill: BAND });
    b.height = 15;
    ar++;
    if (!list.length) {
      assumptions.getRow(ar).getCell(3).value = "No stored assumptions (CloseBook defaults apply)";
      assumptions.getRow(ar).getCell(3).font = { name: FONT, size: 11, italic: true, color: { argb: GREY } };
      ar += 2;
      continue;
    }
    for (const a of list) {
      const r = assumptions.getRow(ar);
      r.height = 15;
      put(r, 2, g.name);
      put(r, 3, a.label);
      put(r, 4, a.key);
      put(r, 5, a.scope);
      if (a.value != null) {
        const c = r.getCell(6);
        c.value = a.value;
        c.numFmt = '#,##0.00_);(#,##0.00);"-"_)';
        c.font = { name: FONT, size: 11, color: { argb: BLUE } };
      }
      put(r, 7, a.unit ?? "");
      put(r, 8, a.text ?? "");
      put(r, 9, a.note ?? "");
      ar++;
    }
    ar++;
  }

  return wb;
}

// ---------------------------------------------------------------- helpers

function setupSheet(ws: ExcelJS.Worksheet, widths: number[]) {
  ws.properties.defaultRowHeight = 15;
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

function bandRow(ws: ExcelJS.Worksheet, rowNo: number, spans: Array<[number, number, string]>) {
  const r = ws.getRow(rowNo);
  r.height = 15;
  for (const [a, b, text] of spans) {
    ws.mergeCells(rowNo, a, rowNo, b);
    const c = r.getCell(a);
    c.value = text;
    c.font = { name: FONT, size: 11, bold: true };
    c.alignment = { horizontal: "center" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
  }
}

function headerRow(ws: ExcelJS.Worksheet, rowNo: number, headers: string[], firstCol: number, firstNumberCol: number) {
  const r = ws.getRow(rowNo);
  r.height = 15;
  headers.forEach((h, i) => {
    const c = r.getCell(firstCol + i);
    c.value = h;
    c.font = { name: FONT, size: 11, bold: true };
    c.border = { bottom: { style: "thin" } };
    c.alignment = { horizontal: firstCol + i >= firstNumberCol ? "right" : "left", wrapText: false };
  });
}

/** Month columns collapse to the totals with Excel's column outline */
function outlineColumns(ws: ExcelJS.Worksheet, from: number, to: number) {
  for (let c = from; c <= to; c++) ws.getColumn(c).outlineLevel = 1;
}

function styleRow(r: ExcelJS.Row, from: number, to: number, s: { bold?: boolean; fill?: string; color?: string }) {
  for (let c = from; c <= to; c++) {
    const cell = r.getCell(c);
    cell.font = { name: FONT, size: 11, bold: !!s.bold, ...(s.color ? { color: { argb: s.color } } : {}) };
    cell.alignment = { ...(cell.alignment ?? {}), wrapText: false };
    if (s.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: s.fill } };
  }
}

function put(r: ExcelJS.Row, col: number, v: string) {
  const c = r.getCell(col);
  c.value = v;
  c.font = { name: FONT, size: 11 };
}

function input(c: Cell, v: number) {
  c.value = v;
  c.numFmt = MONEY;
  c.font = { name: FONT, size: 11, color: { argb: BLUE } };
}

function formula(c: Cell, f: string) {
  c.value = { formula: f };
  c.numFmt = MONEY;
  c.font = { name: FONT, size: 11 };
}

function link(c: Cell, f: string) {
  c.value = { formula: f };
  c.numFmt = MONEY;
  c.font = { name: FONT, size: 11, color: { argb: GREEN } };
}

function range(a: number, b: number): number[] {
  return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Text inside a formula string: double the quotes; wildcards are escaped for SUMIFS */
function esc(s: string): string {
  return s.replace(/"/g, '""').replace(/([*?~])/g, "~$1");
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
