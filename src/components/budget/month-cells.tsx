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

/** Row of twelve month cells plus total, prior and change */
export function MonthCells({ months, prior, showPrior, className, bold, invert }: { months: number[]; prior?: number[]; showPrior: boolean; className?: string; bold?: boolean; invert?: boolean }) {
  const total = sum(months);
  const priorTotal = prior ? sum(prior) : 0;
  const pct = prior ? changePct(total, priorTotal) : "";
  const up = total > priorTotal;
  // For costs, up is red; for revenue (invert), up is green
  const tone = !prior || !pct || pct === "new" ? "" : up === !invert ? "text-red-700" : "text-emerald-700";
  return (
    <>
      {months.map((v, i) => (
        <TableCell key={i} className={cn("whitespace-nowrap text-right tabular-nums", className, bold && "font-medium")}>{v ? fmtUsd(v) : ""}</TableCell>
      ))}
      <TableCell className={cn("whitespace-nowrap text-right tabular-nums", className, "font-medium")}>{fmtUsd(total)}</TableCell>
      {showPrior && (
        <>
          <TableCell className={cn("whitespace-nowrap text-right tabular-nums text-muted-foreground", className)}>{prior ? fmtUsd(priorTotal) : ""}</TableCell>
          <TableCell className={cn("whitespace-nowrap text-right tabular-nums text-xs", className, tone)}>{pct}</TableCell>
        </>
      )}
    </>
  );
}
