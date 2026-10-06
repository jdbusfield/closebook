"use client";

import { TableCell } from "@/components/ui/table";
import { fmtPct, fmtUsd } from "@/lib/budget/format";
import { cn } from "@/lib/utils";

const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);

export function changePct(now: number, prior: number): string {
  if (!prior) return now ? "new" : "";
  const p = ((now - prior) / Math.abs(prior)) * 100;
  return `${p > 0 ? "+" : ""}${fmtPct(p)}`;
}

/**
 * Row of twelve month cells plus total, prior and change.
 * With priorMonths (the months of last year that are booked) it adds last year's
 * average month and compares averages, so a year still closing reads fairly.
 * priorTotal stands in for prior when only last year's total is known (an item).
 */
export function MonthCells({ months, prior, priorTotal: priorTotalIn, priorMonths, showPrior, className, bold, invert }: { months: number[]; prior?: number[]; priorTotal?: number | null; priorMonths?: number; showPrior: boolean; className?: string; bold?: boolean; invert?: boolean }) {
  const total = sum(months);
  const hasPrior = !!prior || priorTotalIn != null;
  const priorTotal = prior ? sum(prior) : (priorTotalIn ?? 0);
  const withAvg = priorMonths != null;
  const priorAvg = withAvg && priorMonths ? priorTotal / priorMonths : 0;
  const pct = !hasPrior ? "" : withAvg ? (priorMonths ? changePct(total / 12, priorAvg) : "") : changePct(total, priorTotal);
  const up = withAvg ? total / 12 > priorAvg : total > priorTotal;
  // For costs, up is red; for revenue (invert), up is green
  const tone = !hasPrior || !pct || pct === "new" ? "" : up === !invert ? "text-red-700" : "text-emerald-700";
  return (
    <>
      {months.map((v, i) => (
        <TableCell key={i} className={cn("whitespace-nowrap text-right tabular-nums", className, bold && "font-medium")}>{v ? fmtUsd(v) : ""}</TableCell>
      ))}
      <TableCell className={cn("whitespace-nowrap text-right tabular-nums", className, "font-medium")}>{fmtUsd(total)}</TableCell>
      {showPrior && (
        <>
          <TableCell className={cn("whitespace-nowrap text-right tabular-nums text-muted-foreground", className)}>{hasPrior ? fmtUsd(priorTotal) : ""}</TableCell>
          {withAvg && <TableCell className={cn("whitespace-nowrap text-right tabular-nums text-muted-foreground", className)}>{hasPrior && priorMonths ? fmtUsd(priorAvg) : ""}</TableCell>}
          <TableCell className={cn("whitespace-nowrap text-right tabular-nums text-xs", className, tone)}>{pct}</TableCell>
        </>
      )}
    </>
  );
}
