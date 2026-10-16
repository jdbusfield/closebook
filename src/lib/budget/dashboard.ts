/**
 * The budget dashboard's numbers (docs/budget-dashboard-plan.md, step 4). Pure: the page gets
 * every reporting group's lines from GET /api/budget/dashboard and works everything out here,
 * so the company, comparison and units switches never refetch.
 *
 * Comparison: "pace" sets the full-year budget against last year's booked months annualized
 * (booked x 12 / months booked); "ytd" sets the same months of both years side by side.
 * Last year by function: actuals are not tagged, so each line's actuals are split in the
 * same mix as that line's budget (stated on the page).
 */

export const FUNCTIONS = ["Sales", "Fleet", "Operations", "Overhead"] as const;
export const UNASSIGNED = "Unassigned";
/** Management view: the business down to EBITDA. Interest, depreciation, amortization, taxes and other income/expense are left out. */
export const SECTIONS = ["revenue", "direct_operating_costs", "other_operating_costs"] as const;
export type SectionId = (typeof SECTIONS)[number];
export type Mode = "pace" | "ytd";
export type Units = "M" | "K" | "D";

export interface Split { key: string; pct: number }
export interface DashItem {
  id: string;
  label: string;
  kind: string;
  source: string;
  sourceHref: string | null;
  methodText: string | null;
  note: string | null;
  count: number | null;
  months: number[];
  total: number;
  parts?: Array<{ label: string; months: number[]; total: number; note: string | null }>;
  history: { priorYear: number; trailing12: number; priorYearMonths?: number[] } | null;
  functions: Split[];
  locations: Split[];
  classNames: string[];
  functionOrigin: string;
  byFunction: Record<string, number[]>;
  byLocation: Record<string, number[]>;
  /** Payroll items: the people behind them */
  people?: DashPerson[];
}
export interface DashPerson {
  id: string;
  name: string;
  title: string | null;
  months: number[];
  total: number;
  functions: Split[];
  locations: Split[];
  byFunction: Record<string, number[]>;
}
export interface DashMaster {
  id: string;
  accountNumber: string | null;
  name: string;
  section: string;
  intercompany: boolean;
  months: number[];
  prior: number[];
  byFunction: Record<string, number[]>;
  items: DashItem[];
}
export interface DashGroup {
  reportingEntityId: string;
  code: string;
  name: string;
  version: { id: string; name: string; status: string; isActive: boolean };
  priorYearMonths: number;
  priorYearSource: "financial_model" | "gl";
  masters: DashMaster[];
}
export interface DashboardPayload { fiscalYear: number; asOf: string; organizationName?: string; groups: DashGroup[] }

/** One line for the chosen company (or all companies), with items carrying their group. */
export interface Line {
  id: string;
  accountNumber: string | null;
  name: string;
  section: SectionId;
  months: number[];
  prior: number[];
  byFunction: Record<string, number[]>;
  items: Array<DashItem & { group: string; groupName: string; versionId: string }>;
}

const zeros = () => new Array(12).fill(0) as number[];
const add = (t: number[], s: number[] | undefined) => {
  if (s) for (let i = 0; i < 12; i++) t[i] += s[i] ?? 0;
};
export const sum = (a: number[], n = 12) => a.slice(0, n).reduce((t, v) => t + v, 0);

/**
 * "All" combines every group and drops intercompany lines; a group code keeps them, unless
 * dropIntercompany asks for a company's share of the consolidated total.
 */
export function combine(p: DashboardPayload, entity: string, opts?: { dropIntercompany?: boolean }): { lines: Line[]; booked: number } {
  const groups = entity === "All" ? p.groups : p.groups.filter((g) => g.code === entity);
  const dropIc = entity === "All" || !!opts?.dropIntercompany;
  const byId = new Map<string, Line>();
  for (const g of groups) {
    for (const m of g.masters) {
      if (dropIc && m.intercompany) continue;
      if (!(SECTIONS as readonly string[]).includes(m.section)) continue;
      const l = byId.get(m.id) ?? { id: m.id, accountNumber: m.accountNumber, name: m.name, section: m.section as SectionId, months: zeros(), prior: zeros(), byFunction: {}, items: [] };
      add(l.months, m.months);
      add(l.prior, m.prior);
      for (const [k, v] of Object.entries(m.byFunction ?? {})) {
        const t = l.byFunction[k] ?? zeros();
        add(t, v);
        l.byFunction[k] = t;
      }
      for (const it of m.items) l.items.push({ ...it, group: g.code, groupName: g.name, versionId: g.version.id });
      byId.set(m.id, l);
    }
  }
  const booked = groups.length ? Math.min(...groups.map((g) => g.priorYearMonths || 0)) : 0;
  const lines = [...byId.values()].sort((a, b) => (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "", undefined, { numeric: true }));
  return { lines, booked };
}

/** The budget figure being compared: the full year, or the months last year has booked. */
export function current(months: number[], mode: Mode, booked: number): number {
  return mode === "pace" ? sum(months) : sum(months, booked);
}
/** Last year's figure: booked months annualized (pace) or the same months (ytd). */
export function prior(months: number[], mode: Mode, booked: number): number {
  if (booked <= 0) return 0;
  const s = sum(months, booked);
  return mode === "pace" ? (s * 12) / booked : s;
}

/** A line's months by function. Revenue is its own column; costs use the item tags. */
export function lineFunctions(l: Line): Record<string, number[]> {
  if (l.section === "revenue") return { Revenue: l.months.slice() };
  const out: Record<string, number[]> = {};
  const tagged = Object.values(l.byFunction).reduce((t, m) => t + Math.abs(sum(m)), 0);
  for (const [k, m] of Object.entries(l.byFunction)) out[k] = m.slice();
  // Amounts on the line with no items behind them (typed into cells) are untagged
  const rest = l.months.map((v, i) => v - Object.values(l.byFunction).reduce((t, m) => t + (m[i] ?? 0), 0));
  if (rest.some((v) => Math.abs(v) >= 0.5) || tagged === 0) {
    const u = out[UNASSIGNED] ?? zeros();
    add(u, rest);
    out[UNASSIGNED] = u;
  }
  return out;
}

/** Last year's actuals split in the line's budget mix (actuals carry no tags). */
export function priorFunctions(l: Line): Record<string, number[]> {
  const fn = lineFunctions(l);
  const totals = Object.entries(fn).map(([k, m]) => [k, Math.abs(sum(m))] as const);
  const all = totals.reduce((t, [, v]) => t + v, 0);
  if (all < 0.005) return { [l.section === "revenue" ? "Revenue" : UNASSIGNED]: l.prior.slice() };
  const out: Record<string, number[]> = {};
  for (const [k, v] of totals) if (v > 0) out[k] = l.prior.map((x) => (x * v) / all);
  return out;
}

export type RowKind = "head" | "account" | "total" | "derived" | "pct";
export interface PnlRow {
  key: string;
  kind: RowKind;
  label: string;
  section?: SectionId;
  lineId?: string;
  /** Revenue is good when up; costs when down */
  upIsGood: boolean;
  cur: number;
  prior: number;
  /** Budget by column: Revenue, the four functions, Unassigned */
  byFn: Record<string, number>;
  /** Monthly budget (12) and last year (12), for the charts */
  months: number[];
  priorMonths: number[];
}

const SECTION_TITLE: Record<SectionId, [string, string]> = {
  revenue: ["Revenue", "Total revenue"],
  direct_operating_costs: ["Direct operating costs", "Total direct operating costs"],
  other_operating_costs: ["Other operating costs", "Total other operating costs"],
};

/** The income statement the Summary tab shows, with a column per function. */
export function pnl(lines: Line[], mode: Mode, booked: number): { rows: PnlRow[]; totals: Record<string, PnlRow> } {
  const rows: PnlRow[] = [];
  const totals: Record<string, PnlRow> = {};
  const mk = (key: string, kind: RowKind, label: string, upIsGood: boolean, months: number[], priorMonths: number[], byFnMonths: Record<string, number[]>, extra?: Partial<PnlRow>): PnlRow => ({
    key, kind, label, upIsGood, months, priorMonths,
    cur: current(months, mode, booked),
    prior: prior(priorMonths, mode, booked),
    byFn: Object.fromEntries(Object.entries(byFnMonths).map(([k, m]) => [k, current(m, mode, booked)])),
    ...extra,
  });
  const combineRows = (a: PnlRow, b: PnlRow, sign: number, key: string, label: string): PnlRow => {
    const months = a.months.map((v, i) => v + sign * b.months[i]);
    const priorMonths = a.priorMonths.map((v, i) => v + sign * b.priorMonths[i]);
    const keys = new Set([...Object.keys(a.byFn), ...Object.keys(b.byFn)]);
    const r = mk(key, "derived", label, true, months, priorMonths, {});
    r.byFn = Object.fromEntries([...keys].map((k) => [k, (a.byFn[k] ?? 0) + sign * (b.byFn[k] ?? 0)]));
    return r;
  };
  const section = (s: SectionId) => {
    // Every line counts in the totals; a row is shown when any figure on it is not zero
    const ls = lines.filter((l) => l.section === s);
    const shows = (l: Line) => Math.abs(current(l.months, mode, booked)) >= 0.5 || Math.abs(sum(l.months)) >= 0.5 || Math.abs(sum(l.prior, booked)) >= 0.5;
    const up = s === "revenue";
    rows.push(mk(`h:${s}`, "head", SECTION_TITLE[s][0], up, zeros(), zeros(), {}, { section: s }));
    const tm = zeros();
    const tp = zeros();
    const tf: Record<string, number[]> = {};
    for (const l of ls) {
      const fn = lineFunctions(l);
      if (shows(l)) rows.push(mk(`a:${l.id}`, "account", `${l.accountNumber ?? ""} ${l.name}`.trim(), up, l.months, l.prior, fn, { section: s, lineId: l.id }));
      add(tm, l.months);
      add(tp, l.prior);
      for (const [k, m] of Object.entries(fn)) add((tf[k] ??= zeros()), m);
    }
    const t = mk(`t:${s}`, "total", SECTION_TITLE[s][1], up, tm, tp, tf, { section: s });
    rows.push(t);
    totals[s] = t;
  };
  const pctRow = (key: string, label: string, num: PnlRow, den: PnlRow) => {
    const r = mk(key, "pct", label, true, zeros(), zeros(), {});
    r.cur = den.cur ? num.cur / den.cur : 0;
    r.prior = den.prior ? num.prior / den.prior : 0;
    rows.push(r);
  };
  section("revenue");
  section("direct_operating_costs");
  const gm = combineRows(totals.revenue, totals.direct_operating_costs, -1, "gm", "Gross margin");
  rows.push(gm);
  pctRow("gm_pct", "Gross margin %", gm, totals.revenue);
  section("other_operating_costs");
  const eb = combineRows(gm, totals.other_operating_costs, -1, "ebitda", "EBITDA (operating profit)");
  rows.push(eb);
  pctRow("ebitda_pct", "EBITDA margin %", eb, totals.revenue);
  const opex = combineRows(totals.direct_operating_costs, totals.other_operating_costs, 1, "opex", "Operating costs");
  opex.upIsGood = false;
  Object.assign(totals, { gm, ebitda: eb, opex });
  return { rows, totals };
}

/** Function totals for operating costs (direct + other operating). */
export function functionTotals(lines: Line[], mode: Mode, booked: number) {
  const keys = [...FUNCTIONS, UNASSIGNED];
  const out = Object.fromEntries(keys.map((k) => [k, { cur: 0, prior: 0, months: zeros() }])) as Record<string, { cur: number; prior: number; months: number[] }>;
  for (const l of lines) {
    if (l.section === "revenue") continue;
    const fn = lineFunctions(l);
    const pf = priorFunctions(l);
    for (const k of keys) {
      const m = fn[k];
      if (m) {
        out[k].cur += current(m, mode, booked);
        add(out[k].months, m);
      }
      if (pf[k]) out[k].prior += prior(pf[k], mode, booked);
    }
  }
  return out;
}

/** Revenue, operating costs and EBITDA by month: budget, and last year for booked months. */
export function monthly(lines: Line[], booked: number) {
  const rev = zeros(), op = zeros(), prev = zeros(), pop = zeros();
  for (const l of lines) {
    if (l.section === "revenue") { add(rev, l.months); add(prev, l.prior); }
    if (l.section === "direct_operating_costs" || l.section === "other_operating_costs") { add(op, l.months); add(pop, l.prior); }
  }
  return Array.from({ length: 12 }, (_, i) => ({
    month: i,
    revenue: rev[i],
    ebitda: rev[i] - op[i],
    priorRevenue: i < booked ? prev[i] : null,
    priorEbitda: i < booked ? prev[i] - pop[i] : null,
  }));
}

/** One person's cost on a line: every payroll component (wages, taxes, benefits) added up. */
export interface PersonOnLine {
  key: string;
  name: string;
  title: string | null;
  group: string;
  groupName: string;
  months: number[];
  functions: Split[];
  locations: Split[];
  /** The components that make up the person's cost */
  parts: Array<{ label: string; months: number[] }>;
}

/** The people behind a line's payroll items (or one item), in one function when a function is picked. */
export function peopleOn(items: Line["items"], fn: string | null): PersonOnLine[] {
  const byKey = new Map<string, PersonOnLine>();
  for (const it of items) {
    for (const p of it.people ?? []) {
      const m = !fn || fn === "Revenue" ? p.months : p.byFunction[fn];
      if (!m || m.every((v) => Math.abs(v) < 0.005)) continue;
      const key = `${it.group}:${p.id}`;
      const cur = byKey.get(key) ?? { key, name: p.name, title: p.title, group: it.group, groupName: it.groupName, months: zeros(), functions: p.functions, locations: p.locations, parts: [] };
      add(cur.months, m);
      cur.parts.push({ label: it.label, months: m.slice() });
      byKey.set(key, cur);
    }
  }
  return [...byKey.values()].sort((a, b) => sum(b.months) - sum(a.months));
}

/** An item's amount in one function (its whole amount when no function is picked). */
export function itemInFunction(it: DashItem, fn: string | null): number[] {
  if (!fn) return it.months;
  if (fn === "Revenue") return it.months;
  return it.byFunction[fn] ?? zeros();
}

const UNIT = { M: { div: 1e6, dec: 2, suf: "M", name: "$ millions" }, K: { div: 1e3, dec: 0, suf: "K", name: "$ thousands" }, D: { div: 1, dec: 0, suf: "", name: "dollars" } } as const;
export const unitName = (u: Units) => UNIT[u].name;
const n = (v: number, dec: number) => Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** Table figure in the chosen unit, negatives in parentheses, "–" for nothing. */
export function fmtTable(v: number, u: Units): string {
  const { div, dec } = UNIT[u];
  const x = v / div;
  if (Math.abs(x) < (dec ? 0.005 : 0.5)) return "–";
  return v < 0 ? `(${n(x, dec)})` : n(x, dec);
}
/** Money with its unit: $8.42M, $8,420K, $8,420,000. */
export function fmtMoney(v: number, u: Units): string {
  const { div, dec, suf } = UNIT[u];
  return `${v < 0 ? "−" : ""}$${n(v / div, dec)}${suf}`;
}
export function fmtSigned(v: number, u: Units): string {
  if (Math.abs(v) < 0.5) return "–";
  return `${v > 0 ? "+" : "−"}${fmtMoney(Math.abs(v), u)}`;
}
export function fmtPctChange(change: number, base: number): string {
  if (Math.abs(base) < 0.5) return "";
  return ` (${Math.round((Math.abs(change) / Math.abs(base)) * 100)}%)`;
}
