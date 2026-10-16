"use client";

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { current, fmtMoney, fmtPctChange, fmtSigned, fmtTable, prior, unitName, type Line } from "@/lib/budget/dashboard";
import { BarPair, changeClass, curLabel, FN_COLOR, priorLabel, ShareBar, Swatch, type ViewProps } from "./shared";
import type { Drill } from "./pnl-view";

const linkCls = "underline decoration-dotted underline-offset-4 hover:decoration-solid text-left";
const splitText = (s: Array<{ key: string; pct: number }>, empty: string) => (s.length === 0 ? empty : s.length === 1 ? s[0].key : s.map((x) => `${x.key} ${Math.round(x.pct)}%`).join(" / "));

/** No location, or only an Unassigned share */
const noLocation = (l: Array<{ key: string }>) => l.length === 0 || l.every((x) => x.key === "Unassigned");

interface Props extends ViewProps {
  lines: Line[];
  onDrill: (d: Drill) => void;
}

/** Rent: each lease pod (net of its subleases), rent split and adjustment item, with its function split and location. */
export function RentView({ lines, onDrill, units, mode, booked, fiscalYear }: Props) {
  const rent = lines.find((l) => l.accountNumber === "6000" || /^rent$/i.test(l.name));
  const rows = useMemo(() => (rent ? rent.items.map((it) => ({ it, cur: current(it.months, mode, booked) })).filter((r) => Math.abs(r.cur) >= 0.5).sort((a, b) => b.cur - a.cur) : []), [rent, mode, booked]);
  if (!rent) return <Card><CardContent className="pt-6 text-sm text-muted-foreground">No rent line in this budget.</CardContent></Card>;
  const cur = current(rent.months, mode, booked);
  const pr = prior(rent.prior, mode, booked);
  const byFn = Object.entries(rent.byFunction).map(([key, m]) => ({ key, value: current(m, mode, booked) })).filter((x) => Math.abs(x.value) >= 0.5).sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...rows.map((r) => r.cur));
  const unlocated = rows.filter((r) => noLocation(r.it.locations)).length;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm text-muted-foreground">{curLabel(mode, fiscalYear, booked)} rent</div>
          <div className="text-2xl font-semibold tabular-nums">{fmtMoney(cur, units)}</div>
          <div className={cn("text-xs font-medium tabular-nums", changeClass(cur - pr, false))}>{fmtSigned(cur - pr, units)}{fmtPctChange(cur - pr, pr)} vs {priorLabel(mode, fiscalYear, booked)}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm text-muted-foreground">Leases and adjustments</div>
          <div className="text-2xl font-semibold tabular-nums">{rows.length}</div>
          <div className="text-xs text-muted-foreground">{unlocated ? `${unlocated} still need a location` : "All have a location"}</div>
        </div>
        <div className="space-y-2 rounded-lg border bg-card p-4">
          <div className="text-sm text-muted-foreground">Rent by function</div>
          <ShareBar parts={byFn} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{byFn.map((f) => <span key={f.key}><Swatch fn={f.key} />{f.key} <b className="tabular-nums">{fmtMoney(f.value, units)}</b></span>)}</div>
        </div>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Each lease</CardTitle>
          <CardDescription>A lease is shown net of its subleases. Splits between companies are their own lines. Set the function split with Tags on each budget&apos;s Model tab. Amounts in {unitName(units)}.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Lease or item</TableHead><TableHead>Company</TableHead><TableHead>Function split</TableHead><TableHead>Location</TableHead><TableHead className="text-right">{curLabel(mode, fiscalYear, booked)}</TableHead><TableHead className="w-40">Size</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map(({ it, cur: c }) => {
                const top = it.functions[0]?.key ?? "Unassigned";
                return (
                  <TableRow key={`${it.group}:${it.id}`}>
                    <TableCell><button type="button" className={linkCls} onClick={() => onDrill({ fn: null, lineId: rent.id, itemKey: `${it.group}:${it.id}` })}>{it.label}</button></TableCell>
                    <TableCell className="text-muted-foreground">{it.groupName}</TableCell>
                    <TableCell className="whitespace-nowrap">{splitText(it.functions, "No function")}</TableCell>
                    <TableCell className={cn(noLocation(it.locations) && "text-amber-700 dark:text-amber-400")}>{noLocation(it.locations) ? "Not set" : splitText(it.locations, "Not set")}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTable(c, units)}</TableCell>
                    <TableCell><BarPair value={c} max={max} color={FN_COLOR[top] ?? FN_COLOR.Unassigned} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
