"use client";

/**
 * Roll-forward table grouped Entity → Debt Type → Instrument.
 *
 * Layout decisions for readability:
 *   - Tight vertical rhythm (py-2 on rows) so more fits on screen
 *   - First column sticky at the left during horizontal scroll
 *   - Compact currency format ($1.2M) on the numeric columns with a
 *     hover tooltip showing the full value
 *   - Subtotal rows are visually distinct (slate fill, bold); grand
 *     total sits at the bottom with a primary-accented bar
 *   - Paydown columns shown as negative numbers (no parens) so trends
 *     read as signed quantities scan top-down
 */

import { useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/dates";
import type {
  GroupedRollForward,
  RollForwardTotals,
} from "@/lib/utils/debt-rollforward";

interface Props {
  rollForward: GroupedRollForward | null;
  filterType?: string | null;
  filterEntityId?: string | null;
}

export function RollForwardTable({ rollForward, filterType, filterEntityId }: Props) {
  const [collapsedEntities, setCollapsedEntities] = useState<Set<string>>(new Set());
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  const [compact, setCompact] = useState(true);

  function toggleEntity(id: string) {
    setCollapsedEntities((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleType(k: string) {
    setCollapsedTypes((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  if (!rollForward || rollForward.entities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Roll-Forward</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            No debt activity to roll forward for the selected scope and period.
          </p>
        </CardContent>
      </Card>
    );
  }

  const fmt = (v: number) => (compact ? compactDollars(v) : formatCurrency(v));
  const signFmt = (v: number) =>
    v === 0 ? "—" : (v < 0 ? "−" : "") + fmt(Math.abs(v));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base">Roll-Forward</CardTitle>
          <p className="text-xs text-muted-foreground">
            Entity · Debt Type · Instrument — click a row to open detail
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border bg-muted/30 p-0.5">
          <Button
            size="sm"
            variant={compact ? "default" : "ghost"}
            onClick={() => setCompact(true)}
            className="h-7 px-3 text-xs"
          >
            Compact
          </Button>
          <Button
            size="sm"
            variant={!compact ? "default" : "ghost"}
            onClick={() => setCompact(false)}
            className="h-7 px-3 text-xs"
          >
            Full
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="text-sm">
            <TableHeader>
              <TableRow className="border-b-2 border-border/60">
                <TableHead className="sticky left-0 z-10 bg-background w-[22rem] py-2">
                  Instrument
                </TableHead>
                <TableHead className="text-right py-2">Beginning</TableHead>
                <TableHead className="text-right py-2">Draws</TableHead>
                <TableHead className="text-right py-2">Principal</TableHead>
                <TableHead className="text-right py-2">Veh. Payoff</TableHead>
                <TableHead className="text-right py-2">Payoff</TableHead>
                <TableHead className="text-right py-2">Adj</TableHead>
                <TableHead className="text-right py-2 bg-muted/40">Ending</TableHead>
                <TableHead className="text-right py-2">Interest</TableHead>
                <TableHead className="text-right py-2">Fees</TableHead>
                <TableHead className="text-right py-2">Net Δ</TableHead>
                <TableHead className="text-right py-2">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rollForward.entities
                .filter((eg) => !filterEntityId || eg.entity.id === filterEntityId)
                .map((eg) => {
                  const entityCollapsed = collapsedEntities.has(eg.entity.id);
                  const typesShown = eg.debtTypes.filter(
                    (tg) => !filterType || tg.debtType === filterType
                  );
                  if (typesShown.length === 0) return null;
                  return (
                    <FragmentRows key={eg.entity.id}>
                      {/* Entity subtotal header */}
                      <TableRow
                        className="cursor-pointer bg-slate-50/80 hover:bg-slate-100 dark:bg-slate-900/40 dark:hover:bg-slate-900/60"
                        onClick={() => toggleEntity(eg.entity.id)}
                      >
                        <TableCell className="sticky left-0 z-10 bg-slate-50/80 dark:bg-slate-900/40 py-2 font-semibold">
                          <div className="flex items-center gap-2">
                            {entityCollapsed ? (
                              <ChevronRight className="size-4 shrink-0" />
                            ) : (
                              <ChevronDown className="size-4 shrink-0" />
                            )}
                            <span className="truncate">{eg.entity.name}</span>
                            <Badge variant="outline" className="ml-1 font-normal text-[10px]">
                              {eg.totals.instrumentCount}
                            </Badge>
                          </div>
                        </TableCell>
                        <TotalCells totals={eg.totals} fmt={fmt} signFmt={signFmt} />
                      </TableRow>

                      {!entityCollapsed &&
                        typesShown.map((tg) => {
                          const typeKey = `${eg.entity.id}::${tg.debtType}`;
                          const typeCollapsed = collapsedTypes.has(typeKey);
                          return (
                            <FragmentRows key={typeKey}>
                              <TableRow
                                className="cursor-pointer bg-muted/25 hover:bg-muted/50"
                                onClick={() => toggleType(typeKey)}
                              >
                                <TableCell className="sticky left-0 z-10 bg-muted/25 py-2 pl-8 font-medium">
                                  <div className="flex items-center gap-2">
                                    {typeCollapsed ? (
                                      <ChevronRight className="size-3.5 shrink-0" />
                                    ) : (
                                      <ChevronDown className="size-3.5 shrink-0" />
                                    )}
                                    <span className="truncate">{tg.debtTypeLabel}</span>
                                    <Badge variant="outline" className="ml-1 font-normal text-[10px]">
                                      {tg.instruments.length}
                                    </Badge>
                                  </div>
                                </TableCell>
                                <TotalCells totals={tg.totals} fmt={fmt} signFmt={signFmt} />
                              </TableRow>

                              {!typeCollapsed &&
                                tg.instruments.map((row) => (
                                  <TableRow
                                    key={row.instrument.id}
                                    className="group hover:bg-muted/30"
                                  >
                                    <TableCell className="sticky left-0 z-10 bg-background group-hover:bg-muted/30 py-2 pl-14">
                                      <Link
                                        href={`/${row.entity.id}/debt/${row.instrument.id}`}
                                        className="block"
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="truncate text-sm font-medium group-hover:underline">
                                            {row.instrument.instrument_name}
                                          </span>
                                          <ReconciliationBadge
                                            reconciled={row.reconciled}
                                            variance={row.variance}
                                          />
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                          <span className="truncate">
                                            {row.instrument.lender_name ?? "—"}
                                          </span>
                                          {row.instrument.status === "paid_off" && (
                                            <Badge className="h-4 bg-emerald-500/15 text-emerald-700 text-[10px] font-normal hover:bg-emerald-500/20 dark:text-emerald-400">
                                              Paid Off
                                            </Badge>
                                          )}
                                        </div>
                                      </Link>
                                    </TableCell>
                                    <Num value={row.beginningBalance} fmt={fmt} />
                                    <Num value={row.draws} fmt={fmt} tone="negative" />
                                    <Num value={-row.principalPayments} fmt={fmt} tone="positive" />
                                    <Num value={-row.vehiclePayoffs} fmt={fmt} tone="positive" />
                                    <Num value={-row.payoffs} fmt={fmt} tone="positive" />
                                    <Num
                                      value={row.adjustments + row.reversals + row.noteRenewals}
                                      fmt={fmt}
                                    />
                                    <Num
                                      value={row.endingBalance}
                                      fmt={fmt}
                                      bold
                                      className="bg-muted/40"
                                    />
                                    <Num value={row.interestPayments} fmt={fmt} tone="amber" />
                                    <Num value={row.fees} fmt={fmt} tone="amber" />
                                    <Num
                                      value={row.endingBalance - row.beginningBalance}
                                      fmt={fmt}
                                      tone={
                                        row.endingBalance - row.beginningBalance < 0
                                          ? "positive"
                                          : row.endingBalance - row.beginningBalance > 0
                                            ? "negative"
                                            : "neutral"
                                      }
                                    />
                                    <TableCell className="py-2 text-right tabular-nums text-xs text-muted-foreground">
                                      {(row.instrument.interest_rate * 100).toFixed(2)}%
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </FragmentRows>
                          );
                        })}
                    </FragmentRows>
                  );
                })}

              {/* Grand total */}
              <TableRow className="border-t-2 border-primary/50 bg-primary/5 font-semibold">
                <TableCell className="sticky left-0 z-10 bg-primary/5 py-3">
                  Grand Total
                </TableCell>
                <TotalCells totals={rollForward.totals} fmt={fmt} signFmt={signFmt} emphasized />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ─── Cells ─────────────────────────────────────────────────────────────────

interface NumProps {
  value: number;
  fmt: (v: number) => string;
  bold?: boolean;
  tone?: "positive" | "negative" | "amber" | "neutral";
  className?: string;
}
function Num({ value, fmt, bold, tone, className }: NumProps) {
  const isZero = Math.abs(value) < 0.005;
  return (
    <TableCell
      className={cn(
        "py-2 text-right tabular-nums text-xs",
        bold && "font-semibold text-sm",
        tone === "positive" && "text-emerald-700 dark:text-emerald-400",
        tone === "negative" && "text-rose-700 dark:text-rose-400",
        tone === "amber" && "text-amber-700 dark:text-amber-400",
        isZero && "text-muted-foreground",
        className
      )}
      title={formatCurrency(value)}
    >
      {isZero ? "—" : (value < 0 ? "−" : "") + fmt(Math.abs(value))}
    </TableCell>
  );
}

interface TotalCellsProps {
  totals: RollForwardTotals;
  fmt: (v: number) => string;
  signFmt: (v: number) => string;
  emphasized?: boolean;
}
function TotalCells({ totals, fmt, emphasized }: TotalCellsProps) {
  const netDelta = totals.endingBalance - totals.beginningBalance;
  const rowCls = "py-2 text-right tabular-nums text-xs font-semibold";
  return (
    <>
      <TotalNum value={totals.beginningBalance} fmt={fmt} />
      <TotalNum value={totals.draws} fmt={fmt} tone="negative" />
      <TotalNum value={-totals.principalPayments} fmt={fmt} tone="positive" />
      <TotalNum value={-totals.vehiclePayoffs} fmt={fmt} tone="positive" />
      <TotalNum value={-totals.payoffs} fmt={fmt} tone="positive" />
      <TotalNum
        value={totals.adjustments + totals.reversals + totals.noteRenewals}
        fmt={fmt}
      />
      <TotalNum
        value={totals.endingBalance}
        fmt={fmt}
        className={emphasized ? "bg-primary/10" : "bg-muted/40"}
        bold
      />
      <TotalNum value={totals.interestPayments} fmt={fmt} tone="amber" />
      <TotalNum value={totals.fees} fmt={fmt} tone="amber" />
      <TotalNum
        value={netDelta}
        fmt={fmt}
        tone={netDelta < 0 ? "positive" : netDelta > 0 ? "negative" : "neutral"}
      />
      <TableCell className={cn(rowCls, "text-muted-foreground")}>
        {totals.instrumentCount > 0
          ? `${(totals.weightedAvgRate * 100).toFixed(2)}%`
          : "—"}
      </TableCell>
    </>
  );
}

interface TotalNumProps {
  value: number;
  fmt: (v: number) => string;
  tone?: "positive" | "negative" | "amber" | "neutral";
  bold?: boolean;
  className?: string;
}
function TotalNum({ value, fmt, tone, bold, className }: TotalNumProps) {
  const isZero = Math.abs(value) < 0.005;
  return (
    <TableCell
      className={cn(
        "py-2 text-right tabular-nums font-semibold",
        bold ? "text-sm" : "text-xs",
        tone === "positive" && "text-emerald-700 dark:text-emerald-400",
        tone === "negative" && "text-rose-700 dark:text-rose-400",
        tone === "amber" && "text-amber-700 dark:text-amber-400",
        isZero && "text-muted-foreground",
        className
      )}
      title={formatCurrency(value)}
    >
      {isZero ? "—" : (value < 0 ? "−" : "") + fmt(Math.abs(value))}
    </TableCell>
  );
}

// ─── Reconciliation badge ──────────────────────────────────────────────────

function ReconciliationBadge({
  reconciled,
  variance,
}: {
  reconciled: boolean | null;
  variance: number | null;
}) {
  if (reconciled === null) return null;
  if (reconciled) {
    return (
      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
    );
  }
  const hasVariance = variance != null && Math.abs(variance) > 0.005;
  return (
    <Badge
      variant="outline"
      className="h-4 border-amber-500/40 bg-amber-500/10 text-[10px] font-normal text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle className="mr-0.5 size-2.5" />
      {hasVariance ? formatCurrency(variance ?? 0) : "Unrec"}
    </Badge>
  );
}

// ─── Formatters ────────────────────────────────────────────────────────────

function compactDollars(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (abs < 0.005) return "$0";
  return `$${n.toFixed(0)}`;
}
