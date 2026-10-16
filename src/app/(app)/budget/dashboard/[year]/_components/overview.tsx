"use client";

import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { combine, current, fmtMoney, fmtPctChange, fmtSigned, fmtTable, FUNCTIONS, functionTotals, monthly, pnl, prior, UNASSIGNED, unitName, type DashboardPayload, type Line } from "@/lib/budget/dashboard";
import { BarPair, changeClass, curLabel, FN_COLOR, Kpi, MONTHS, MonthChart, priorLabel, Swatch, type ViewProps } from "./shared";

interface Props extends ViewProps {
  payload: DashboardPayload;
  entity: string;
  lines: Line[];
  onEntity: (code: string) => void;
  onOpenFunction: (fn: string) => void;
  onOpenLine: (lineId: string) => void;
}

const PLAIN = {
  revenue: "Money we expect to bring in: rentals, services, parking, supplies and damage reimbursements.",
  opex: "Day-to-day spending: people, rent, fleet upkeep, supplies and services.",
  ebitda: "Operating profit: revenue minus operating costs.",
  ni: "The bottom line, after interest, depreciation, goodwill and taxes.",
};

export function Overview({ payload, entity, lines, mode, units, booked, fiscalYear, onEntity, onOpenFunction, onOpenLine }: Props) {
  const { totals } = useMemo(() => pnl(lines, mode, booked), [lines, mode, booked]);
  const fn = useMemo(() => functionTotals(lines, mode, booked), [lines, mode, booked]);
  const months = useMemo(() => monthly(lines, booked), [lines, booked]);
  const pl = priorLabel(mode, fiscalYear, booked);
  const cl = curLabel(mode, fiscalYear, booked);
  const shown = months.filter((m) => mode === "pace" || m.month < booked);

  const movers = useMemo(
    () =>
      lines
        .filter((l) => l.section === "direct_operating_costs" || l.section === "other_operating_costs")
        .map((l) => ({ l, cur: current(l.months, mode, booked), prior: prior(l.prior, mode, booked) }))
        .sort((a, b) => Math.abs(b.cur - b.prior) - Math.abs(a.cur - a.prior))
        .slice(0, 6),
    [lines, mode, booked],
  );
  const companies = useMemo(
    () =>
      payload.groups.map((g) => {
        const c = combine(payload, g.code, { dropIntercompany: entity === "All" });
        // Same booked months as the headline, so the rows add up to it
        const t = pnl(c.lines, mode, entity === "All" ? booked : c.booked).totals;
        return { code: g.code, name: g.name, rev: t.revenue.cur, eb: t.ebitda.cur, ebPrior: t.ebitda.prior };
      }),
    [payload, mode, entity, booked],
  );
  const fnKeys = [...FUNCTIONS, ...(Math.abs(fn[UNASSIGNED].cur) >= 0.5 ? [UNASSIGNED] : [])];
  const fnMax = Math.max(1, ...fnKeys.map((k) => Math.max(fn[k].cur, fn[k].prior)));
  const opTotal = fnKeys.reduce((t, k) => t + fn[k].cur, 0);
  const k = (key: "revenue" | "opex" | "ebitda" | "ni", label: string) => {
    const r = totals[key];
    return <Kpi key={key} label={label} value={r.cur} change={r.cur - r.prior} base={r.prior} upIsGood={r.upIsGood} priorText={pl} plain={PLAIN[key]} units={units} />;
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {k("revenue", "Revenue")}
        {k("opex", "Operating costs")}
        {k("ebitda", "EBITDA")}
        {k("ni", "Net income")}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Revenue by month</CardTitle>
          <CardDescription>Point at a month to compare it with {fiscalYear - 1}. Months {fiscalYear - 1} has not closed show the budget only.</CardDescription>
        </CardHeader>
        <CardContent>
          <MonthChart units={units} priorName={`${fiscalYear - 1} actual`} budgetName={`${fiscalYear} budget`} data={shown.map((m) => ({ label: MONTHS[m.month], budget: m.revenue, prior: m.priorRevenue }))} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Operating profit (EBITDA) by month</CardTitle>
            <CardDescription>Bars below zero are months expected to lose money before interest and depreciation.</CardDescription>
          </CardHeader>
          <CardContent>
            <MonthChart units={units} height={220} priorName={`${fiscalYear - 1} actual`} budgetName={`${fiscalYear} budget`} data={shown.map((m) => ({ label: MONTHS[m.month], budget: m.ebitda, prior: m.priorEbitda }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Where the money goes</CardTitle>
            <CardDescription>Operating costs by function. Thin gray bar = {pl}. Click a function to see what is in it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {fnKeys.map((f) => {
              const r = fn[f];
              return (
                <div key={f} className="space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <button type="button" onClick={() => onOpenFunction(f)} className="font-medium underline decoration-dotted underline-offset-4 hover:decoration-solid">
                      <Swatch fn={f} />{f}
                    </button>
                    <span className="tabular-nums">
                      <b>{fmtMoney(r.cur, units)}</b>
                      <span className="text-muted-foreground"> · {opTotal ? Math.round((r.cur / opTotal) * 100) : 0}% · </span>
                      <span className={changeClass(r.cur - r.prior, false)}>{fmtSigned(r.cur - r.prior, units)}</span>
                    </span>
                  </div>
                  <BarPair value={r.cur} prior={r.prior} max={fnMax} color={FN_COLOR[f]} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Biggest changes from {fiscalYear - 1}</CardTitle>
            <CardDescription>The operating cost lines that move the most. Click one to see its items. Amounts in {unitName(units)}.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GL account</TableHead>
                  <TableHead className="text-right">{pl}</TableHead>
                  <TableHead className="text-right">{cl}</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movers.map(({ l, cur, prior: p }) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <button type="button" className="text-left underline decoration-dotted underline-offset-4 hover:decoration-solid" onClick={() => onOpenLine(l.id)}>
                        {l.accountNumber} {l.name}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{fmtTable(p, units)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTable(cur, units)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums font-medium", changeClass(cur - p, false))}>{fmtSigned(cur - p, units)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By company</CardTitle>
            <CardDescription>Choose View to see one company on every tab. {entity === "All" ? "Shown without intercompany lines, so the companies add up to the total above. " : ""}Amounts in {unitName(units)}.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">EBITDA</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">EBITDA vs {fiscalYear - 1}</TableHead>
                  <TableHead><span className="sr-only">Open</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => (
                  <TableRow key={c.code} className={cn(entity === c.code && "bg-muted/40")}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTable(c.rev, units)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtTable(c.eb, units)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.rev ? `${Math.round((c.eb / c.rev) * 100)}%` : "–"}</TableCell>
                    <TableCell className={cn("text-right tabular-nums font-medium", changeClass(c.eb - c.ebPrior, true))}>{fmtSigned(c.eb - c.ebPrior, units)}{fmtPctChange(c.eb - c.ebPrior, c.ebPrior)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-7" onClick={() => onEntity(c.code)}>View</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">EBITDA is what is left from revenue after day-to-day operating costs. Net income also takes off interest, depreciation, goodwill and taxes.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
