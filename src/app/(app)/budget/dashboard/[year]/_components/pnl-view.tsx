"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { StatementHeader } from "@/components/financial-statements/statement-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  current, fmtMoney, fmtSigned, fmtTable, FUNCTIONS, itemInFunction, lineFunctions, peopleOn, pnl, prior, priorFunctions, sum, UNASSIGNED, unitName,
  type Line, type PnlRow, type Units,
} from "@/lib/budget/dashboard";
import { BarPair, changeClass, curLabel, FN_COLOR, MONTHS, MonthChart, priorLabel, type ViewProps } from "./shared";

export interface Drill { fn: string | null; lineId: string | null; itemKey: string | null }
interface Props extends ViewProps {
  lines: Line[];
  drill: Drill;
  onDrill: (d: Drill) => void;
  /** Company (or organization) name for the statement heading */
  companyName: string;
  entityIsAll: boolean;
}

/** Change as a signed percent of last year; "–" when there is nothing to compare against. */
const signedPct = (change: number, base: number) =>
  Math.abs(change) < 0.5 || Math.abs(base) < 0.5 ? "–" : `${change > 0 ? "+" : "−"}${Math.round((Math.abs(change) / Math.abs(base)) * 100)}%`;
const TOTAL_BORDER = "border-l-2 border-border";
const EM_DASH = "\u2014";
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pctText = (x: number) => (x < 0 ? `(${Math.abs(x * 100).toFixed(1)}%)` : `${(x * 100).toFixed(1)}%`);
/** The Financial Model's figure style in the chosen unit: $ on a section's first line and totals, (negatives), em dash for zero. */
function stmtAmount(v: number, units: Units, dollar: boolean): string {
  const t = fmtTable(v, units);
  if (t === "\u2013") return dollar ? `$${EM_DASH}` : EM_DASH;
  return dollar ? `$${t}` : t;
}
const linkCls = "underline decoration-dotted underline-offset-4 hover:decoration-solid text-left";
const splitText = (s: Array<{ key: string; pct: number }>) => (s.length === 0 ? "No function" : s.length === 1 ? s[0].key : s.map((x) => `${x.key} ${Math.round(x.pct)}%`).join(" / "));

export function PnlView(p: Props) {
  const { lines, drill, onDrill } = p;
  const line = drill.lineId ? lines.find((l) => l.id === drill.lineId) ?? null : null;
  const item = line && drill.itemKey ? line.items.find((it) => `${it.group}:${it.id}` === drill.itemKey) ?? null : null;
  const crumbs: Array<[string, Drill | null]> = [["Master P&L", { fn: null, lineId: null, itemKey: null }]];
  if (drill.fn) crumbs.push([drill.fn, { fn: drill.fn, lineId: null, itemKey: null }]);
  if (line) crumbs.push([`${line.accountNumber ?? ""} ${line.name}`.trim(), { fn: drill.fn, lineId: line.id, itemKey: null }]);
  if (item) crumbs.push([item.label, null]);
  return (
    <div className="space-y-4">
      <nav aria-label="Drill path" className="flex flex-wrap items-center gap-1.5 text-sm">
        {crumbs.map(([label, d], i) => (
          <Fragment key={i}>
            {i > 0 && <span className="text-muted-foreground" aria-hidden>›</span>}
            {i < crumbs.length - 1 && d ? <button type="button" className={linkCls} onClick={() => onDrill(d)}>{label}</button> : <span className="font-semibold">{label}</span>}
          </Fragment>
        ))}
      </nav>
      {item && line ? <ItemView {...p} line={line} itemKey={drill.itemKey!} /> : line ? <LineView {...p} line={line} /> : drill.fn ? <FunctionView {...p} fn={drill.fn} /> : <Master {...p} />}
    </div>
  );
}

function Master({ lines, units, mode, booked, fiscalYear, onDrill, companyName, entityIsAll }: Props) {
  const { rows } = useMemo(() => pnl(lines, mode, booked), [lines, mode, booked]);
  const [q, setQ] = useState("");
  const hasUnassigned = rows.some((r) => Math.abs(r.byFn[UNASSIGNED] ?? 0) >= 0.5 && r.kind === "account");
  const cols = ["Revenue", ...FUNCTIONS, ...(hasUnassigned ? [UNASSIGNED] : [])];
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return lines.flatMap((l) => l.items.filter((it) => `${it.label} ${l.name} ${l.accountNumber} ${it.functions.map((f) => f.key).join(" ")}`.toLowerCase().includes(s)).map((it) => ({ l, it }))).slice(0, 40);
  }, [q, lines]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  // Rows grouped the way the Financial Model lays them out: a section header, its lines,
  // its total, then the subtotals that follow it (gross margin, EBITDA, margins, net income)
  const sections = useMemo(() => {
    const out: Array<{ key: string; head: PnlRow | null; rows: PnlRow[]; foot: PnlRow | null; after: PnlRow[] }> = [];
    for (const r of rows) {
      if (r.kind === "head") out.push({ key: r.key, head: r, rows: [], foot: null, after: [] });
      else if (r.kind === "account" && out.length) out[out.length - 1].rows.push(r);
      else if (r.kind === "total" && out.length && !out[out.length - 1].foot) out[out.length - 1].foot = r;
      else if (out.length) out[out.length - 1].after.push(r);
    }
    return out;
  }, [rows]);
  const amt = (v: number, dollar: boolean) => stmtAmount(v, units, dollar);
  const renderRow = (r: PnlRow, dollar: boolean, striped: boolean) => {
    const change = r.cur - r.prior;
    const goodCls = Math.abs(change) < 0.5 ? "" : change > 0 === r.upIsGood ? "text-green-600" : "text-red-600";
    if (r.kind === "pct") {
      const pts = change * 100;
      return (
        <tr key={r.key} className="stmt-margin-row">
          <td style={{ paddingLeft: "2rem" }}>{r.label}</td>
          {cols.map((c) => <td key={c}></td>)}
          <td className={TOTAL_BORDER}>{pctText(r.cur)}</td>
          <td>{pctText(r.prior)}</td>
          <td>{Math.abs(pts) < 0.05 ? EM_DASH : <span className={pts > 0 ? "text-green-600" : "text-red-600"}>{pts > 0 ? "+" : ""}{pts.toFixed(1)}pp</span>}</td>
          <td></td>
        </tr>
      );
    }
    const cls = r.key === "ni" ? "stmt-grand-total" : r.kind === "account" ? cn("stmt-line-item", striped && "stmt-row-striped") : "stmt-subtotal";
    return (
      <tr key={r.key} className={cls}>
        <td>
          {r.kind === "account" ? (
            <button type="button" className="text-left hover:text-primary hover:underline" onClick={() => onDrill({ fn: null, lineId: r.lineId!, itemKey: null })}>
              {r.label.replace(/^\d+\s+/, "")}
            </button>
          ) : (
            r.label
          )}
        </td>
        {cols.map((c) => {
          const v = r.byFn[c] ?? 0;
          const clickable = r.kind === "account" && Math.abs(v) >= 0.5;
          return (
            <td key={c} className={clickable ? "cursor-pointer transition-colors hover:bg-accent/50" : undefined}
              onClick={clickable ? () => onDrill({ fn: c, lineId: r.lineId!, itemKey: null }) : undefined}
              title={clickable ? `${c} in ${r.label}` : undefined}>
              {amt(v, dollar)}
            </td>
          );
        })}
        <td className={TOTAL_BORDER}>{amt(r.cur, dollar)}</td>
        <td>{amt(r.prior, dollar)}</td>
        {/* .stmt-table td sets its own color, so the good/bad color goes on a span, as the Financial Model does */}
        <td>{Math.abs(change) < 0.5 ? EM_DASH : <span className={goodCls}>{amt(change, dollar)}</span>}</td>
        <td>{Math.abs(change) < 0.5 || Math.abs(r.prior) < 0.5 ? EM_DASH : <span className={goodCls}>{signedPct(change, r.prior)}</span>}</td>
      </tr>
    );
  };
  return (
    <>
      <Input id="budget-line-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a budget item, e.g. fuel, Saticoy, insurance" aria-label="Find a budget item" className="max-w-md" />
      {q.trim().length >= 2 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{hits.length ? `Items matching "${q.trim()}"` : `Nothing matches "${q.trim()}"`}</CardTitle></CardHeader>
          {hits.length > 0 && (
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>GL account</TableHead><TableHead>Company</TableHead><TableHead>Function</TableHead><TableHead className="text-right">{curLabel(mode, fiscalYear, booked)}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {hits.map(({ l, it }) => (
                    <TableRow key={`${it.group}:${it.id}`}>
                      <TableCell><button type="button" className={linkCls} onClick={() => onDrill({ fn: null, lineId: l.id, itemKey: `${it.group}:${it.id}` })}>{it.label}</button></TableCell>
                      <TableCell className="text-muted-foreground">{l.accountNumber} {l.name}</TableCell>
                      <TableCell className="text-muted-foreground">{it.groupName}</TableCell>
                      <TableCell>{splitText(it.functions)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtTable(current(it.months, mode, booked), units)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>
      )}
      <Card>
        <CardContent className="pt-2">
          <StatementHeader
            companyName={companyName}
            statementTitle={`${entityIsAll ? "Consolidated " : ""}Budget Income Statement by Function`}
            startYear={fiscalYear} startMonth={1} endYear={fiscalYear} endMonth={12} granularity="yearly"
            periodDescription={mode === "pace"
              ? `Budget for the Year Ending December 31, ${fiscalYear} · ${unitName(units)}`
              : `Budget for January to ${MONTH_FULL[Math.max(0, booked - 1)]} ${fiscalYear} · ${unitName(units)}`}
          />
          <p className="stmt-no-print pb-2 text-center text-xs text-muted-foreground">Click a function, a line or any number to see what makes it up.</p>
          <div className="overflow-x-auto">
            <table className="stmt-table min-w-[1060px]">
              <thead>
                <tr>
                  <th className="min-w-[240px]"></th>
                  {cols.map((c) => (
                    <th key={c} className="min-w-[96px]">
                      <button type="button" className="hover:text-primary hover:underline" onClick={() => onDrill({ fn: c, lineId: null, itemKey: null })}>{c}</button>
                    </th>
                  ))}
                  <th className={cn("min-w-[110px] font-bold", TOTAL_BORDER)}>{mode === "pace" ? `FY ${fiscalYear}` : "Budget"}</th>
                  <th className="min-w-[110px]">{priorLabel(mode, fiscalYear, booked)}</th>
                  <th className="min-w-[110px]">Change</th>
                  <th className="min-w-[80px]">Change %</th>
                </tr>
              </thead>
              {sections.map((sec) => {
                const isCollapsed = collapsed.has(sec.key);
                const colCount = cols.length + 5;
                return (
                  <tbody key={sec.key}>
                    {sec.head && (
                      <>
                        <tr className="stmt-section-header">
                          <td colSpan={colCount}>
                            <button type="button" onClick={() => toggle(sec.key)} className="flex w-full items-center gap-1 text-left font-bold transition-colors hover:text-primary" aria-expanded={!isCollapsed}>
                              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                              {sec.head.label}
                            </button>
                          </td>
                        </tr>
                        <tr className="stmt-separator"><td colSpan={colCount}></td></tr>
                      </>
                    )}
                    {!isCollapsed && sec.rows.map((r, i) => renderRow(r, i === 0, i % 2 === 0))}
                    {sec.foot && renderRow(sec.foot, true, false)}
                    {sec.after.map((r) => renderRow(r, true, false))}
                    <tr className="stmt-separator"><td colSpan={colCount}></td></tr>
                  </tbody>
                );
              })}
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

function FunctionView({ lines, units, mode, booked, fiscalYear, onDrill, fn }: Props & { fn: string }) {
  const rows = useMemo(() => lines
    .map((l) => {
      const m = lineFunctions(l)[fn];
      const pm = priorFunctions(l)[fn];
      return m || pm ? { l, cur: m ? current(m, mode, booked) : 0, prior: pm ? prior(pm, mode, booked) : 0 } : null;
    })
    .filter((x): x is { l: Line; cur: number; prior: number } => !!x && (Math.abs(x.cur) >= 0.5 || Math.abs(x.prior) >= 0.5)), [lines, fn, mode, booked]);
  const op = rows.filter((r) => r.l.section !== "other_expense");
  const total = op.reduce((t, r) => t + r.cur, 0);
  const max = Math.max(1, ...op.map((r) => Math.max(r.cur, r.prior)));
  const up = fn === "Revenue";
  const block = (title: string, rs: typeof rows) => rs.length > 0 && (
    <>
      <TableRow className="bg-muted/40"><TableCell colSpan={5} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</TableCell></TableRow>
      {rs.map((r) => (
        <TableRow key={r.l.id}>
          <TableCell><button type="button" className={linkCls} onClick={() => onDrill({ fn, lineId: r.l.id, itemKey: null })}>{r.l.accountNumber} {r.l.name}</button></TableCell>
          <TableCell className="text-right tabular-nums">{fmtTable(r.cur, units)}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">{fmtTable(r.prior, units)}</TableCell>
          <TableCell className={cn("text-right tabular-nums", changeClass(r.cur - r.prior, up))}>{fmtSigned(r.cur - r.prior, units)}</TableCell>
          <TableCell className="w-[28%] min-w-32">{r.l.section !== "other_expense" && <BarPair value={r.cur} max={max} color={FN_COLOR[fn] ?? FN_COLOR.Unassigned} />}</TableCell>
        </TableRow>
      ))}
    </>
  );
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{fn} by GL account</CardTitle>
        <CardDescription>{fmtMoney(total, units)} of operating {up ? "revenue" : "cost"}. Click an account to see the items in it. {fiscalYear - 1} is split in each account&apos;s budget mix, since actuals carry no function. Amounts in {unitName(units)}.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>GL account</TableHead><TableHead className="text-right">{curLabel(mode, fiscalYear, booked)}</TableHead><TableHead className="text-right">{priorLabel(mode, fiscalYear, booked)}</TableHead><TableHead className="text-right">Change</TableHead><TableHead>Share</TableHead></TableRow></TableHeader>
          <TableBody>
            {block(up ? "Revenue" : "Operating costs", op)}
            {block("Below operating profit", rows.filter((r) => r.l.section === "other_expense"))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function LineView({ units, mode, booked, fiscalYear, onDrill, drill, line }: Props & { line: Line }) {
  const fn = drill.fn;
  const items = line.items
    .map((it) => ({ it, cur: current(itemInFunction(it, fn), mode, booked) }))
    .filter((x) => Math.abs(x.cur) >= 0.5)
    .sort((a, b) => Math.abs(b.cur) - Math.abs(a.cur));
  const lineCur = fn ? current(lineFunctions(line)[fn] ?? new Array(12).fill(0), mode, booked) : current(line.months, mode, booked);
  const linePrior = fn ? prior(priorFunctions(line)[fn] ?? new Array(12).fill(0), mode, booked) : prior(line.prior, mode, booked);
  const up = line.section === "revenue" || line.section === "other_income";
  return (
    <div className="space-y-4">
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{line.accountNumber} {line.name}{fn ? ` · ${fn}` : ""}</CardTitle>
        <CardDescription>
          {curLabel(mode, fiscalYear, booked)} {fmtMoney(lineCur, units)} against {priorLabel(mode, fiscalYear, booked)} {fmtMoney(linePrior, units)}{" "}
          (<span className={changeClass(lineCur - linePrior, up)}>{fmtSigned(lineCur - linePrior, units)}</span>). {items.length} item{items.length === 1 ? "" : "s"}; click one for its month-by-month detail. Amounts in {unitName(units)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Company</TableHead><TableHead>Function</TableHead><TableHead>Source</TableHead><TableHead className="text-right">{curLabel(mode, fiscalYear, booked)}</TableHead><TableHead className="text-right">Share</TableHead></TableRow></TableHeader>
          <TableBody>
            {items.map(({ it, cur }) => (
              <TableRow key={`${it.group}:${it.id}`}>
                <TableCell><button type="button" className={linkCls} onClick={() => onDrill({ fn, lineId: line.id, itemKey: `${it.group}:${it.id}` })}>{it.label}</button>{it.count != null && <span className="ml-2 text-xs text-muted-foreground">{it.count} {it.kind === "payroll" ? "people" : "rows"}</span>}</TableCell>
                <TableCell className="text-muted-foreground">{it.groupName}</TableCell>
                <TableCell className="whitespace-nowrap">{up ? "Revenue" : splitText(it.functions)}</TableCell>
                <TableCell className="text-muted-foreground">{it.source}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtTable(cur, units)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">{lineCur ? `${Math.round((cur / lineCur) * 100)}%` : ""}</TableCell>
              </TableRow>
            ))}
            {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No items on this line{fn ? ` for ${fn}` : ""}.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    <PeopleCard items={items.map((x) => x.it)} fn={fn} units={units} mode={mode} booked={booked} fiscalYear={fiscalYear} title={`People on ${line.name}${fn ? ` · ${fn}` : ""}`} />
    </div>
  );
}

function ItemView({ units, mode, booked, fiscalYear, line, itemKey, drill }: Props & { line: Line; itemKey: string }) {
  const it = line.items.find((x) => `${x.group}:${x.id}` === itemKey)!;
  const fn = drill.fn;
  const months = itemInFunction(it, fn);
  const priorMonths = it.history?.priorYearMonths ?? null;
  const cur = current(months, mode, booked);
  const up = line.section === "revenue" || line.section === "other_income";
  const facts: Array<[string, React.ReactNode]> = [
    ["Company", it.groupName],
    ["GL account", `${line.accountNumber ?? ""} ${line.name}`],
    ["Function", up ? "Revenue" : splitText(it.functions)],
    ["Location", it.locations.length && !it.locations.every((l) => l.key === "Unassigned") ? splitText(it.locations) : "Not set"],
    ["Class", it.classNames.length ? it.classNames.join(", ") : "None"],
    ["How it is budgeted", it.methodText ?? it.source],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4"><div className="text-sm text-muted-foreground">{curLabel(mode, fiscalYear, booked)}{fn ? ` · ${fn}` : ""}</div><div className="text-2xl font-semibold tabular-nums">{fmtMoney(cur, units)}</div><div className="text-xs text-muted-foreground">about {fmtMoney(sum(months) / 12, units)} a month</div></div>
        <div className="rounded-lg border bg-card p-4"><div className="text-sm text-muted-foreground">{fiscalYear - 1} for this item</div><div className="text-2xl font-semibold tabular-nums">{priorMonths ? fmtMoney(prior(priorMonths, mode, booked), units) : "–"}</div><div className="text-xs text-muted-foreground">{priorMonths ? priorLabel(mode, fiscalYear, booked) : `Not tracked per item; see the ${line.name} line for ${fiscalYear - 1}`}</div></div>
        <div className="rounded-lg border bg-card p-4"><div className="text-sm text-muted-foreground">Where to change it</div><Link href={`/budget/${it.versionId}/lines`} className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4">Budget model <ExternalLink className="h-3 w-3" /></Link>{it.sourceHref && <Link href={it.sourceHref} className="mt-1 inline-flex items-center gap-1 text-sm underline underline-offset-4">{it.source} <ExternalLink className="h-3 w-3" /></Link>}</div>
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Month by month</CardTitle><CardDescription>Amounts in {unitName(units)}.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <MonthChart units={units} height={200} priorName={`${fiscalYear - 1} actual`} budgetName={`${fiscalYear} budget`} data={MONTHS.map((m, i) => ({ label: m, budget: months[i], prior: priorMonths && i < booked ? priorMonths[i] : null })).filter((_, i) => mode === "pace" || i < booked)} />
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader><TableRow><TableHead />{MONTHS.map((m) => <TableHead key={m} className="text-right">{m}</TableHead>)}<TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {priorMonths && <TableRow className="text-muted-foreground"><TableCell>{fiscalYear - 1} actual</TableCell>{priorMonths.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{i < booked ? fmtTable(v, units) : ""}</TableCell>)}<TableCell className="text-right tabular-nums">{fmtTable(sum(priorMonths, booked), units)}</TableCell></TableRow>}
                <TableRow className="font-medium"><TableCell>{fiscalYear} budget</TableCell>{months.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{fmtTable(v, units)}</TableCell>)}<TableCell className="text-right tabular-nums">{fmtTable(sum(months), units)}</TableCell></TableRow>
                {(it.parts ?? []).map((pt, i) => <TableRow key={i} className="text-xs text-muted-foreground"><TableCell className="pl-6">{pt.label}{pt.note ? ` (${pt.note.toLowerCase()})` : ""}</TableCell>{pt.months.map((v, j) => <TableCell key={j} className="text-right tabular-nums">{fmtTable(v, units)}</TableCell>)}<TableCell className="text-right tabular-nums">{fmtTable(pt.total, units)}</TableCell></TableRow>)}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <PeopleCard items={[it]} fn={fn} units={units} mode={mode} booked={booked} fiscalYear={fiscalYear} title={`People in ${it.label}`} />
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">About this item</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([k, v]) => <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt><dd className="mt-0.5 text-sm">{v}</dd></div>)}
          </dl>
          {it.note && <p className="mt-4 text-sm italic text-muted-foreground">{it.note}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/** The employees behind a line's payroll items, each expandable to their months and components. */
function PeopleCard({ items, fn, units, mode, booked, fiscalYear, title }: { items: Line["items"]; fn: string | null; units: Units; mode: ViewProps["mode"]; booked: number; fiscalYear: number; title: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const people = useMemo(() => peopleOn(items, fn), [items, fn]);
  if (!people.length) return null;
  const totalCur = people.reduce((a, x) => a + current(x.months, mode, booked), 0);
  const multiCo = new Set(people.map((x) => x.group)).size > 1;
  const cols = multiCo ? 7 : 6;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          {people.length} {people.length === 1 ? "person" : "people"}{fn ? ` (their ${fn} share)` : ""}, {fmtMoney(totalCur, units)} {curLabel(mode, fiscalYear, booked)}. Click a person for their month by month cost. Amounts in {unitName(units)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead><TableHead>Title</TableHead>{multiCo && <TableHead>Company</TableHead>}<TableHead>Function</TableHead><TableHead>Location</TableHead>
              <TableHead className="text-right">{curLabel(mode, fiscalYear, booked)}</TableHead><TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((x) => {
              const cur = current(x.months, mode, booked);
              const isOpen = open === x.key;
              return (
                <Fragment key={x.key}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(isOpen ? null : x.key)}>
                    <TableCell className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 font-medium">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{x.name}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{x.title ?? ""}</TableCell>
                    {multiCo && <TableCell className="text-muted-foreground">{x.groupName}</TableCell>}
                    <TableCell className="whitespace-nowrap">{splitText(x.functions)}</TableCell>
                    <TableCell className="whitespace-nowrap">{x.locations.length && !x.locations.every((l) => l.key === UNASSIGNED) ? splitText(x.locations) : <span className="text-amber-600">Not set</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTable(cur, units)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{totalCur ? `${Math.round((cur / totalCur) * 100)}%` : ""}</TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={cols} className="bg-muted/30 p-3">
                        <div className="overflow-x-auto">
                          <Table className="min-w-[900px]">
                            <TableHeader><TableRow><TableHead />{MONTHS.map((m) => <TableHead key={m} className="text-right">{m}</TableHead>)}<TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                            <TableBody>
                              <TableRow className="font-medium"><TableCell>{fiscalYear} budget</TableCell>{x.months.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{fmtTable(v, units)}</TableCell>)}<TableCell className="text-right tabular-nums">{fmtTable(sum(x.months), units)}</TableCell></TableRow>
                              {x.parts.length > 1 && x.parts.map((pt, i) => <TableRow key={i} className="text-xs text-muted-foreground"><TableCell className="pl-6">{pt.label}</TableCell>{pt.months.map((v, j) => <TableCell key={j} className="text-right tabular-nums">{fmtTable(v, units)}</TableCell>)}<TableCell className="text-right tabular-nums">{fmtTable(sum(pt.months), units)}</TableCell></TableRow>)}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
