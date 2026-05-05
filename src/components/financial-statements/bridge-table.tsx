"use client";

import { Fragment, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatStatementAmount } from "./format-utils";
import { BridgeTier3Drilldown } from "./bridge-tier3-drilldown";
import type {
  BridgeRow,
  BridgeResponse,
  BridgeTier2Row,
} from "@/lib/financial-statements/bridge-types";

interface BridgeTableProps {
  data: BridgeResponse;
  organizationId: string;
}

/**
 * Bridge schedule table. Renders rows in render order, one per linked /
 * unmatched line pair, with a final "Total" row that ties.
 *
 * Columns: Line | From $ | Δ Pro Forma | Δ Alloc | Δ YE | Δ IC | Δ NI |
 *           Δ Mapping | To $
 *
 * For multi-period reports the table shows a sub-header per period and
 * each row repeats the column block per period. We default to a
 * "Total over range" view where each row sums all periods to one column
 * block — matches how an auditor reads a workpaper bridge.
 */
export function BridgeTable({ data, organizationId }: BridgeTableProps) {
  const [period, setPeriod] = useState<string | "ALL">(
    data.periods.length === 1 ? data.periods[0].key : "ALL",
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedT2, setExpandedT2] = useState<Set<string>>(new Set());

  const visiblePeriods =
    period === "ALL" ? data.periods : data.periods.filter((p) => p.key === period);

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleT2(id: string) {
    setExpandedT2((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Group rows by their major group (Assets / Liab / Equity / Revenue / Exp)
  const groups = new Map<string, BridgeRow[]>();
  for (const r of data.rows) {
    if (!groups.has(r.group)) groups.set(r.group, []);
    groups.get(r.group)!.push(r);
  }

  const groupOrder = [
    "Assets",
    "Liabilities",
    "Equity",
    "Revenue",
    "Expense",
  ];

  function renderAmount(n: number): React.ReactNode {
    if (Math.abs(n) < 0.5) {
      return <span className="text-muted-foreground">—</span>;
    }
    return formatStatementAmount(n, false);
  }

  const periodKeys = visiblePeriods.map((p) => p.key);

  function sumOver(amounts: Record<string, number>, keys: string[]): number {
    let s = 0;
    for (const k of keys) s += amounts[k] ?? 0;
    return s;
  }

  function renderTier2Row(parent: BridgeRow, t2: BridgeTier2Row) {
    const proForma = sumOver(t2.deltas.proForma, periodKeys);
    const allocation = sumOver(t2.deltas.allocation, periodKeys);
    const yearEnd = sumOver(t2.deltas.yearEnd, periodKeys);
    const icElim = sumOver(t2.deltas.icElim, periodKeys);
    const niPres = sumOver(t2.deltas.niPresentation, periodKeys);
    const mapping = sumOver(t2.deltas.mapping, periodKeys);
    const isOpen = expandedT2.has(t2.id);

    return (
      <Fragment key={`${parent.id}_${t2.id}`}>
        <tr className="bg-muted/10 text-[11px]">
          <td className="py-0.5 pr-2 pl-6">
            <button
              onClick={() => toggleT2(t2.id)}
              className="inline-flex items-center gap-1 hover:text-foreground text-muted-foreground"
              title="Show GL accounts behind this master"
            >
              {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <span>{t2.label}</span>
              <span
                className={[
                  "rounded px-1 text-[9px] uppercase tracking-wider",
                  t2.side === "both"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : t2.side === "from"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                      : "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
                ].join(" ")}
              >
                {t2.side}
              </span>
            </button>
          </td>
          <td />
          <td className="py-0.5 px-2 text-right tabular-nums">{renderAmount(proForma)}</td>
          <td className="py-0.5 px-2 text-right tabular-nums">{renderAmount(allocation)}</td>
          <td className="py-0.5 px-2 text-right tabular-nums">{renderAmount(yearEnd)}</td>
          <td className="py-0.5 px-2 text-right tabular-nums">{renderAmount(icElim)}</td>
          <td className="py-0.5 px-2 text-right tabular-nums">{renderAmount(niPres)}</td>
          <td className="py-0.5 px-2 text-right tabular-nums">{renderAmount(mapping)}</td>
          <td />
          <td />
        </tr>
        {isOpen && (
          <tr>
            <td colSpan={10} className="py-1 px-2 pl-12 bg-muted/5">
              <BridgeTier3Drilldown
                organizationId={organizationId}
                masterAccountId={t2.masterId}
                statement={data.statement}
                periods={data.periods}
                visiblePeriodKeys={periodKeys}
              />
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  function renderRow(row: BridgeRow) {
    const fromVal = sumOver(row.fromAmounts, periodKeys);
    const toVal = sumOver(row.toAmounts, periodKeys);
    const proForma = sumOver(row.deltas.proForma, periodKeys);
    const allocation = sumOver(row.deltas.allocation, periodKeys);
    const yearEnd = sumOver(row.deltas.yearEnd, periodKeys);
    const icElim = sumOver(row.deltas.icElim, periodKeys);
    const niPres = sumOver(row.deltas.niPresentation, periodKeys);
    const mapping = sumOver(row.deltas.mapping, periodKeys);

    const explained = proForma + allocation + yearEnd + icElim + niPres + mapping;
    const total = toVal - fromVal;
    const tieDelta = total - explained;

    const unmatched = !row.fromLine || !row.toLine;
    const isSubtotal = row.fromLine?.isTotal || row.toLine?.isTotal;
    const isGrand = row.fromLine?.isGrandTotal || row.toLine?.isGrandTotal;
    const hasTier2 = (row.tier2?.length ?? 0) > 0 && !isSubtotal && !isGrand;
    const isOpen = expanded.has(row.id);

    return (
      <Fragment key={row.id}>
        <tr
          className={[
            isGrand ? "border-t-2 border-double font-semibold" : "",
            isSubtotal ? "border-t font-medium" : "",
            unmatched ? "bg-amber-50/40 dark:bg-amber-900/10" : "",
          ].join(" ")}
        >
          <td className="py-1 pr-2">
            {hasTier2 ? (
              <button
                onClick={() => toggleRow(row.id)}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span className={unmatched ? "italic" : ""}>{row.label}</span>
              </button>
            ) : (
              <span className={unmatched ? "italic" : ""}>{row.label}</span>
            )}
            {unmatched && (
              <span className="ml-2 rounded bg-amber-200 dark:bg-amber-700 text-amber-900 dark:text-amber-100 px-1 text-[10px] uppercase tracking-wider">
                {row.fromLine ? "Unmatched (from)" : "Unmatched (to)"}
              </span>
            )}
          </td>
          <td className="py-1 px-2 text-right tabular-nums">{renderAmount(fromVal)}</td>
          <td className="py-1 px-2 text-right tabular-nums">{renderAmount(proForma)}</td>
          <td className="py-1 px-2 text-right tabular-nums">{renderAmount(allocation)}</td>
          <td className="py-1 px-2 text-right tabular-nums">{renderAmount(yearEnd)}</td>
          <td className="py-1 px-2 text-right tabular-nums">{renderAmount(icElim)}</td>
          <td className="py-1 px-2 text-right tabular-nums">{renderAmount(niPres)}</td>
          <td className="py-1 px-2 text-right tabular-nums">{renderAmount(mapping)}</td>
          <td className="py-1 px-2 text-right tabular-nums">{renderAmount(toVal)}</td>
          <td
            className="py-1 pl-2 text-right tabular-nums"
            title="Tie check: should be near zero. Non-zero = unattributed difference."
          >
            {Math.abs(tieDelta) >= 0.5 ? (
              <span className="text-destructive">{formatStatementAmount(tieDelta)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </td>
        </tr>
        {isOpen && hasTier2 && row.tier2!.map((t2) => renderTier2Row(row, t2))}
      </Fragment>
    );
  }

  // Total row for the whole statement
  const tb = data.totalBridge;
  const totalFrom = sumOver(tb.fromAmounts, periodKeys);
  const totalTo = sumOver(tb.toAmounts, periodKeys);
  const totalProForma = sumOver(tb.deltas.proForma, periodKeys);
  const totalAlloc = sumOver(tb.deltas.allocation, periodKeys);
  const totalYE = sumOver(tb.deltas.yearEnd, periodKeys);
  const totalIC = sumOver(tb.deltas.icElim, periodKeys);
  const totalNI = sumOver(tb.deltas.niPresentation, periodKeys);
  const totalMap = sumOver(tb.deltas.mapping, periodKeys);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <CardTitle className="text-base">
              Bridge: {data.fromChartName} → {data.toChartName}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.statement === "BS" ? "Balance Sheet" : "Income Statement"} ·
              {data.metadata.startPeriod} to {data.metadata.endPeriod}
            </p>
          </div>
          {data.periods.length > 1 && (
            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="border rounded-md text-xs h-7 px-2 bg-background"
            >
              <option value="ALL">All periods</option>
              {data.periods.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          )}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto pt-0">
        <table className="text-xs w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2 pr-2 font-medium">Line</th>
              <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
                From ({data.fromChartName})
              </th>
              <th className="text-right px-2 py-2 font-medium" title="Pro forma adjustments overlay">Δ Pro Forma</th>
              <th className="text-right px-2 py-2 font-medium" title="Allocation adjustments overlay">Δ Alloc</th>
              <th className="text-right px-2 py-2 font-medium" title="Year-end adjustment differences">Δ YE</th>
              <th className="text-right px-2 py-2 font-medium" title="Intercompany elimination differences">Δ IC</th>
              <th className="text-right px-2 py-2 font-medium" title="Net Income presentation difference (per-entity equity vs standalone)">Δ NI</th>
              <th className="text-right px-2 py-2 font-medium" title="Mapping / categorization residual">Δ Mapping</th>
              <th className="text-right px-2 py-2 font-medium whitespace-nowrap">
                To ({data.toChartName})
              </th>
              <th className="text-right pl-2 py-2 font-medium" title="Should be zero — non-zero indicates unattributed difference">Tie</th>
            </tr>
          </thead>
          <tbody>
            {groupOrder.map((g) => {
              const rows = groups.get(g);
              if (!rows || rows.length === 0) return null;
              return (
                <Fragment key={`grp_${g}`}>
                  <tr className="bg-muted/40">
                    <td className="py-1 pr-2 font-semibold tracking-wider text-[11px] uppercase" colSpan={10}>
                      {g}
                    </td>
                  </tr>
                  {rows.map((r) => renderRow(r))}
                </Fragment>
              );
            })}
            {/* Lines that didn't fall into a known group (rare) */}
            {Array.from(groups.entries())
              .filter(([g]) => !groupOrder.includes(g))
              .map(([g, rows]) => (
                <Fragment key={`grp_other_${g}`}>
                  <tr className="bg-muted/40">
                    <td className="py-1 pr-2 font-semibold tracking-wider text-[11px] uppercase" colSpan={10}>
                      {g}
                    </td>
                  </tr>
                  {rows.map((r) => renderRow(r))}
                </Fragment>
              ))}

            {/* Statement-total bridge row */}
            <tr className="border-t-2 border-double font-semibold bg-muted/30">
              <td className="py-2 pr-2">Bridge Total</td>
              <td className="py-2 px-2 text-right tabular-nums">{renderAmount(totalFrom)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{renderAmount(totalProForma)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{renderAmount(totalAlloc)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{renderAmount(totalYE)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{renderAmount(totalIC)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{renderAmount(totalNI)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{renderAmount(totalMap)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{renderAmount(totalTo)}</td>
              <td className="py-2 pl-2 text-right tabular-nums">
                {(() => {
                  const tie =
                    totalTo - totalFrom -
                    (totalProForma + totalAlloc + totalYE + totalIC + totalNI + totalMap);
                  return Math.abs(tie) >= 0.5 ? (
                    <span className="text-destructive">{formatStatementAmount(tie)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  );
                })()}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-muted-foreground">
          <span className="font-medium">How to read:</span> Each row walks the
          accountant&apos;s line value across to the management line value via
          named adjustment categories. The <em>Mapping</em> column is the
          residual — what&apos;s left after every named bridge category is
          subtracted, capturing line-categorization, aggregation, and rounding
          differences. The <em>Tie</em> column should be zero on every row; a
          non-zero value indicates an unattributed difference and should be
          investigated.
        </p>
      </CardContent>
    </Card>
  );
}
