"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  current, fmtMoney, fmtPctChange, fmtSigned, fmtTable, FUNCTIONS, itemInFunction, lineFunctions, pnl, prior, priorFunctions, sum, UNASSIGNED, unitName,
  type Line, type PnlRow,
} from "@/lib/budget/dashboard";
import { BarPair, changeClass, curLabel, FN_COLOR, MONTHS, MonthChart, priorLabel, Swatch, type ViewProps } from "./shared";

export interface Drill { fn: string | null; lineId: string | null; itemKey: string | null }
interface Props extends ViewProps {
  lines: Line[];
  drill: Drill;
  onDrill: (d: Drill) => void;
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

function Master({ lines, units, mode, booked, fiscalYear, onDrill }: Props) {
  const { rows } = useMemo(() => pnl(lines, mode, booked), [lines, mode, booked]);
  const [q, setQ] = useState("");
  const hasUnassigned = rows.some((r) => Math.abs(r.byFn[UNASSIGNED] ?? 0) >= 0.5 && r.kind === "account");
  const cols = ["Revenue", ...FUNCTIONS, ...(hasUnassigned ? [UNASSIGNED] : [])];
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return lines.flatMap((l) => l.items.filter((it) => `${it.label} ${l.name} ${l.accountNumber} ${it.functions.map((f) => f.key).join(" ")}`.toLowerCase().includes(s)).map((it) => ({ l, it }))).slice(0, 40);
  }, [q, lines]);
  const rowCls = (r: PnlRow) => cn(r.kind === "head" && "bg-muted/40", (r.kind === "total" || r.kind === "derived") && "font-semibold", r.kind === "derived" && "bg-muted/30", r.kind === "pct" && "text-xs italic text-muted-foreground");
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
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Master P&L, {mode === "pace" ? `FY ${fiscalYear}` : curLabel(mode, fiscalYear, booked)}</CardTitle>
          <CardDescription>The same P&L as the Summary tab, split into functions. Click a function, an account, or any number to see what makes it up. Amounts in {unitName(units)}.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-card">Income statement</TableHead>
                {cols.map((c) => (
                  <TableHead key={c} className="whitespace-nowrap text-right">
                    <button type="button" className={linkCls} onClick={() => onDrill({ fn: c, lineId: null, itemKey: null })}><Swatch fn={c} />{c}</button>
                  </TableHead>
                ))}
                <TableHead className="border-l text-right">{mode === "pace" ? `FY ${fiscalYear}` : "Budget"}</TableHead>
                <TableHead className="whitespace-nowrap text-right">{priorLabel(mode, fiscalYear, booked)}</TableHead>
                <TableHead className="text-right">Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const change = r.cur - r.prior;
                if (r.kind === "head") return <TableRow key={r.key} className={rowCls(r)}><TableCell colSpan={cols.length + 4} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</TableCell></TableRow>;
                if (r.kind === "pct") return (
                  <TableRow key={r.key} className={rowCls(r)}>
                    <TableCell className="sticky left-0 bg-card">{r.label}</TableCell>
                    {cols.map((c) => <TableCell key={c} />)}
                    <TableCell className="border-l text-right tabular-nums">{Math.round(r.cur * 1000) / 10}%</TableCell>
                    <TableCell className="text-right tabular-nums">{Math.round(r.prior * 1000) / 10}%</TableCell>
                    <TableCell className="text-right tabular-nums">{Math.abs(change) < 0.0005 ? "–" : `${change > 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(1)} pts`}</TableCell>
                  </TableRow>
                );
                return (
                  <TableRow key={r.key} className={rowCls(r)}>
                    <TableCell className={cn("sticky left-0 whitespace-nowrap", r.kind === "derived" ? "bg-muted/30" : "bg-card", r.kind === "account" && "pl-6")}>
                      {r.kind === "account" ? <button type="button" className={linkCls} onClick={() => onDrill({ fn: null, lineId: r.lineId!, itemKey: null })}>{r.label}</button> : r.label}
                    </TableCell>
                    {cols.map((c) => {
                      const v = r.byFn[c] ?? 0;
                      const clickable = r.kind === "account" && Math.abs(v) >= 0.5;
                      return (
                        <TableCell key={c} className={cn("whitespace-nowrap text-right tabular-nums", Math.abs(v) < 0.5 && "text-muted-foreground/50")}>
                          {clickable ? <button type="button" className={linkCls} aria-label={`${c} in ${r.label}`} onClick={() => onDrill({ fn: c, lineId: r.lineId!, itemKey: null })}>{fmtTable(v, units)}</button> : fmtTable(v, units)}
                        </TableCell>
                      );
                    })}
                    <TableCell className="whitespace-nowrap border-l text-right font-medium tabular-nums">{fmtTable(r.cur, units)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">{fmtTable(r.prior, units)}</TableCell>
                    <TableCell className={cn("whitespace-nowrap text-right tabular-nums", changeClass(change, r.upIsGood))}>{fmtSigned(change, units)}{fmtPctChange(change, r.prior)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
