"use client";

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  combine, current, fmtMoney, fmtPctChange, fmtSigned, fmtTable, FUNCTIONS, functionTotals, itemInFunction, lineFunctions, prior, priorFunctions, UNASSIGNED, unitName,
  type DashboardPayload, type Line,
} from "@/lib/budget/dashboard";
import { BarPair, changeClass, curLabel, FN_COLOR, priorLabel, ShareBar, Swatch, type ViewProps } from "./shared";
import type { Drill } from "./pnl-view";

const ABOUT: Record<string, string> = {
  Sales: "Costs of winning and serving customers: the sales team, card-processing fees, equipment rented in to fill orders, customer entertainment and rental insurance sold with rentals.",
  Fleet: "Owning and keeping the vehicles on the road: mechanics and fleet staff, parts and tires, repairs, registration, vehicle insurance and fleet facilities.",
  Operations: "Running the yards and serving production jobs: yard and crew staff, rent for lots and warehouses, fuel, and the supplies and equipment provided to productions.",
  Overhead: "Running the company: leadership and admin staff, headquarters, software, accounting, legal, office costs and company-wide insurance.",
  Unassigned: "Budget amounts no item, rule or account default has tagged yet. Tag them on each budget's Model tab.",
};
const linkCls = "underline decoration-dotted underline-offset-4 hover:decoration-solid text-left";

interface Props extends ViewProps {
  payload: DashboardPayload;
  entity: string;
  lines: Line[];
  fn: string;
  onFn: (fn: string) => void;
  onDrill: (d: Drill) => void;
}

export function FunctionsView({ payload, entity, lines, fn, onFn, onDrill, units, mode, booked, fiscalYear }: Props) {
  const totals = useMemo(() => functionTotals(lines, mode, booked), [lines, mode, booked]);
  const keys = [...FUNCTIONS, ...(Math.abs(totals[UNASSIGNED].cur) >= 0.5 ? [UNASSIGNED] : [])];
  const me = totals[fn] ?? { cur: 0, prior: 0, below: 0, months: [] };
  const opAll = keys.reduce((t, k) => t + totals[k].cur, 0);
  const change = me.cur - me.prior;
  const pl = priorLabel(mode, fiscalYear, booked);

  const accounts = useMemo(() => lines
    .filter((l) => l.section === "direct_operating_costs" || l.section === "other_operating_costs")
    .map((l) => ({ l, cur: current(lineFunctions(l)[fn] ?? [], mode, booked), prior: prior(priorFunctions(l)[fn] ?? new Array(12).fill(0), mode, booked) }))
    .filter((r) => Math.abs(r.cur) >= 0.5 || Math.abs(r.prior) >= 0.5)
    .sort((a, b) => b.cur - a.cur), [lines, fn, mode, booked]);
  const below = useMemo(() => lines.filter((l) => l.section === "other_expense").map((l) => ({ l, cur: current(lineFunctions(l)[fn] ?? [], mode, booked) })).filter((r) => Math.abs(r.cur) >= 0.5), [lines, fn, mode, booked]);
  const companies = useMemo(() => (entity === "All" ? payload.groups : payload.groups.filter((g) => g.code === entity)).map((g) => {
    const c = combine(payload, g.code);
    const t = functionTotals(c.lines, mode, c.booked)[fn];
    return { name: g.name, cur: t.cur, prior: t.prior };
  }), [payload, entity, fn, mode]);
  const topItems = useMemo(() => lines
    .filter((l) => l.section === "direct_operating_costs" || l.section === "other_operating_costs")
    .flatMap((l) => l.items.map((it) => ({ l, it, cur: current(itemInFunction(it, fn), mode, booked) })))
    .filter((x) => Math.abs(x.cur) >= 0.5)
    .sort((a, b) => b.cur - a.cur)
    .slice(0, 12), [lines, fn, mode, booked]);
  const amax = Math.max(1, ...accounts.map((r) => Math.max(r.cur, r.prior)));
  const cmax = Math.max(1, ...companies.map((c) => Math.max(c.cur, c.prior)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Function">
        {keys.map((k) => (
          <button key={k} type="button" aria-pressed={k === fn} onClick={() => onFn(k)}
            className={cn("inline-flex min-h-10 items-center rounded-full border px-4 text-sm", k === fn ? "border-foreground bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
            <Swatch fn={k} />{k}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="grid gap-6 pt-6 md:grid-cols-3">
          <div>
            <div className="text-sm text-muted-foreground">{fn} · {curLabel(mode, fiscalYear, booked)} operating cost</div>
            <div className="text-3xl font-semibold tabular-nums">{fmtMoney(me.cur, units)}</div>
            <div className={cn("text-sm font-medium tabular-nums", changeClass(change, false))}>{fmtSigned(change, units)}{fmtPctChange(change, me.prior)} vs {pl}</div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Share of all operating costs</div>
            <div className="text-3xl font-semibold tabular-nums">{opAll ? Math.round((me.cur / opAll) * 100) : 0}%</div>
            <ShareBar parts={keys.map((k) => ({ key: k, value: totals[k].cur }))} />
            <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">{keys.map((k) => <span key={k} className={cn(k === fn && "font-medium text-foreground")}><Swatch fn={k} />{k} {opAll ? Math.round((totals[k].cur / opAll) * 100) : 0}%</span>)}</div>
          </div>
          <p className="rounded-md bg-muted/50 p-3 text-sm leading-relaxed"><b>What is in {fn}?</b> {ABOUT[fn]}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What it is made of</CardTitle>
            <CardDescription>By GL account. Thin gray bar = {pl}, split in each account&apos;s budget mix. Click one for its items.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {accounts.map((r) => (
              <div key={r.l.id} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <button type="button" className={linkCls} onClick={() => onDrill({ fn, lineId: r.l.id, itemKey: null })}>{r.l.accountNumber} {r.l.name}</button>
                  <span className="tabular-nums"><b>{fmtMoney(r.cur, units)}</b> <span className={changeClass(r.cur - r.prior, false)}>{fmtSigned(r.cur - r.prior, units)}</span></span>
                </div>
                <BarPair value={r.cur} prior={r.prior} max={amax} color={FN_COLOR[fn]} />
              </div>
            ))}
            {accounts.length === 0 && <p className="text-sm text-muted-foreground">No operating costs carry this function.</p>}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Which company carries it</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {companies.map((c) => (
                <div key={c.name} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                  <span className="font-medium">{c.name}</span>
                  <BarPair value={c.cur} prior={c.prior} max={cmax} color={FN_COLOR[fn]} />
                  <span className="tabular-nums"><b>{fmtMoney(c.cur, units)}</b> <span className={changeClass(c.cur - c.prior, false)}>{fmtSigned(c.cur - c.prior, units)}</span></span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Also charged to {fn}, below operating profit</CardTitle>
              <CardDescription>Not day-to-day spending, so not in the total above, but part of what {fn} really costs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {below.map((r) => (
                <div key={r.l.id} className="flex justify-between gap-3 border-t pt-2 first:border-t-0 first:pt-0">
                  <button type="button" className={linkCls} onClick={() => onDrill({ fn, lineId: r.l.id, itemKey: null })}>{r.l.accountNumber} {r.l.name}</button>
                  <b className="tabular-nums">{fmtMoney(r.cur, units)}</b>
                </div>
              ))}
              {below.length === 0 ? <p className="text-muted-foreground">Nothing for this function.</p> : (
                <div className="flex justify-between gap-3 border-t pt-2 font-semibold"><span>All-in cost of {fn}</span><span className="tabular-nums">{fmtMoney(me.cur + me.below, units)}</span></div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Largest budget items in {fn}</CardTitle>
          <CardDescription>Click an item for its month-by-month detail and where it comes from. Amounts in {unitName(units)}.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Company</TableHead><TableHead>GL account</TableHead><TableHead>Source</TableHead><TableHead className="text-right">{curLabel(mode, fiscalYear, booked)}</TableHead></TableRow></TableHeader>
            <TableBody>
              {topItems.map(({ l, it, cur }) => (
                <TableRow key={`${it.group}:${it.id}`}>
                  <TableCell><button type="button" className={linkCls} onClick={() => onDrill({ fn, lineId: l.id, itemKey: `${it.group}:${it.id}` })}>{it.label}</button></TableCell>
                  <TableCell className="text-muted-foreground">{it.groupName}</TableCell>
                  <TableCell className="text-muted-foreground">{l.accountNumber} {l.name}</TableCell>
                  <TableCell className="text-muted-foreground">{it.source}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtTable(cur, units)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
