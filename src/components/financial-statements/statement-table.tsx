"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatStatementAmount } from "./format-utils";
import type { StatementData, Period, LineItem, VarianceDisplayMode } from "./types";

interface StatementTableProps {
  data: StatementData;
  periods: Period[];
  showBudget?: boolean;
  showYoY?: boolean;
  varianceDisplay?: VarianceDisplayMode;
  compactLabels?: boolean;
  onCellClick?: (
    line: LineItem,
    periodKey: string,
    periodLabel: string,
    columnType: "actual" | "budget",
    amount: number
  ) => void;
}

export function StatementTable({
  data,
  periods,
  showBudget = false,
  showYoY = false,
  varianceDisplay = "dollars",
  compactLabels = false,
  onCellClick,
}: StatementTableProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set()
  );

  function toggleSection(sectionId: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }

  function renderAmount(line: LineItem, periodKey: string) {
    const amount = line.amounts[periodKey];
    if (amount === undefined || amount === null) return null;

    // Check if this is a margin % row
    const isMargin = line.id.endsWith("_pct");
    if (isMargin) {
      const pct = amount * 100;
      return (
        <span className="italic text-muted-foreground">
          {pct < 0 ? `(${Math.abs(pct).toFixed(1)}%)` : `${pct.toFixed(1)}%`}
        </span>
      );
    }

    return formatStatementAmount(amount, line.showDollarSign);
  }

  function renderBudgetAmount(line: LineItem, periodKey: string) {
    const budget = line.budgetAmounts?.[periodKey];
    if (budget === undefined || budget === null) return null;

    const isMargin = line.id.endsWith("_pct");
    if (isMargin) {
      const pct = budget * 100;
      return (
        <span className="italic text-muted-foreground">
          {pct < 0 ? `(${Math.abs(pct).toFixed(1)}%)` : `${pct.toFixed(1)}%`}
        </span>
      );
    }

    return formatStatementAmount(budget, false);
  }

  function renderVariance(line: LineItem, periodKey: string) {
    const actual = line.amounts[periodKey];
    const budget = line.budgetAmounts?.[periodKey];
    if (
      actual === undefined ||
      actual === null ||
      budget === undefined ||
      budget === null
    )
      return null;

    const isMargin = line.id.endsWith("_pct");
    if (isMargin) {
      const changePts = (actual - budget) * 100;
      if (Math.abs(changePts) < 0.05) return "\u2014";
      return (
        <span className={changePts >= 0 ? "text-green-600 italic" : "text-red-600 italic"}>
          {changePts >= 0 ? "+" : ""}{changePts.toFixed(1)}pp
        </span>
      );
    }

    const variance = actual - budget;
    if (variance === 0) return "\u2014";

    if (varianceDisplay === "percentage") {
      if (budget === 0) return "\u2014";
      const pct = (variance / Math.abs(budget)) * 100;
      const favorable = line.varianceInvertColor ? pct <= 0 : pct >= 0;
      return (
        <span className={favorable ? "text-green-600" : "text-red-600"}>
          {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
        </span>
      );
    }

    const formatted = formatStatementAmount(variance, false);
    // For expense items, positive variance (over-budget) is unfavorable
    const favorable = line.varianceInvertColor
      ? variance <= 0
      : variance >= 0;
    return (
      <span className={favorable ? "text-green-600" : "text-red-600"}>
        {formatted}
      </span>
    );
  }

  // Last non-total period key for YoY comparison columns
  const lastNonTotalPeriod = [...periods].reverse().find((p) => !p.isTotal);
  const lastPeriodKey = lastNonTotalPeriod?.key ?? "";

  // CSS class for total column visual separation
  const totalBorderClass = "border-l-2 border-border";

  function renderYoYCells(line: LineItem) {
    const isMargin = line.id.endsWith("_pct");
    const pyAmount = line.priorYearAmounts?.[lastPeriodKey];
    const currentAmount = line.amounts[lastPeriodKey];

    // Prior Year column
    const pyCell =
      pyAmount !== undefined && pyAmount !== null ? (
        isMargin ? (
          <span className="italic text-muted-foreground">
            {(pyAmount * 100) < 0
              ? `(${Math.abs(pyAmount * 100).toFixed(1)}%)`
              : `${(pyAmount * 100).toFixed(1)}%`}
          </span>
        ) : (
          formatStatementAmount(pyAmount, line.showDollarSign)
        )
      ) : null;

    // YoY Change column
    let changeCell: React.ReactNode = null;
    if (
      !isMargin &&
      pyAmount !== undefined &&
      pyAmount !== null &&
      currentAmount !== undefined &&
      currentAmount !== null
    ) {
      const change = currentAmount - pyAmount;
      if (change === 0) {
        changeCell = "\u2014";
      } else if (varianceDisplay === "percentage") {
        if (pyAmount === 0) {
          changeCell = "\u2014";
        } else {
          const pct = (change / Math.abs(pyAmount)) * 100;
          const favorable = line.varianceInvertColor ? pct <= 0 : pct >= 0;
          changeCell = (
            <span className={favorable ? "text-green-600" : "text-red-600"}>
              {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
            </span>
          );
        }
      } else {
        const formatted = formatStatementAmount(change, false);
        // For expense items, cost increase YoY is unfavorable
        const favorable = line.varianceInvertColor
          ? change <= 0
          : change >= 0;
        changeCell = (
          <span className={favorable ? "text-green-600" : "text-red-600"}>
            {formatted}
          </span>
        );
      }
    } else if (isMargin && pyAmount !== undefined && pyAmount !== null && currentAmount !== undefined) {
      const changePts = (currentAmount - pyAmount) * 100;
      if (Math.abs(changePts) < 0.05) {
        changeCell = "\u2014";
      } else {
        changeCell = (
          <span className={changePts >= 0 ? "text-green-600 italic" : "text-red-600 italic"}>
            {changePts >= 0 ? "+" : ""}{changePts.toFixed(1)}pp
          </span>
        );
      }
    }

    return (
      <>
        <td>{pyCell}</td>
        <td>{changeCell}</td>
      </>
    );
  }

  // Total columns per period: 1 for actual, +1 for budget, +1 for variance
  const colsPerPeriod = 1 + (showBudget ? 2 : 0);
  const totalCols =
    1 + periods.length * colsPerPeriod + (showYoY ? 2 : 0);

  // Determine stripe index for alternating row colors
  let stripeIndex = 0;

  function isDrillable(line: LineItem): boolean {
    const meta = line.drillDownMeta;
    return !!meta && meta.type !== "percentage" && meta.type !== "none";
  }

  const drillableClass = onCellClick
    ? "cursor-pointer hover:bg-accent/50 transition-colors"
    : undefined;

  function renderPeriodCells(
    line: LineItem,
    renderFn: "amount" | "budget-row" | "subtotal" | "computed"
  ) {
    const canDrill = isDrillable(line) && !!onCellClick;

    return periods.map((period) => {
      const isTotalCol = period.isTotal;
      const borderCls = isTotalCol ? totalBorderClass : "";
      const drillCls = canDrill ? drillableClass : "";
      const actualCls = [borderCls, drillCls].filter(Boolean).join(" ") || undefined;

      return (
        <>
          <td
            key={period.key}
            className={actualCls}
            onClick={
              canDrill
                ? () =>
                    onCellClick!(
                      line,
                      period.key,
                      period.label,
                      "actual",
                      line.amounts[period.key] ?? 0
                    )
                : undefined
            }
          >
            {renderAmount(line, period.key)}
          </td>
          {showBudget && (
            <>
              <td
                key={`${period.key}-budget`}
                className={canDrill ? drillableClass : undefined}
                onClick={
                  canDrill
                    ? () =>
                        onCellClick!(
                          line,
                          period.key,
                          period.label,
                          "budget",
                          line.budgetAmounts?.[period.key] ?? 0
                        )
                    : undefined
                }
              >
                {renderBudgetAmount(line, period.key)}
              </td>
              <td key={`${period.key}-var`}>
                {renderVariance(line, period.key)}
              </td>
            </>
          )}
        </>
      );
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className={`stmt-table${compactLabels ? " stmt-compact-labels" : ""}`}>
        <thead>
          <tr>
            <th className={compactLabels ? "min-w-[180px]" : "min-w-[280px]"}></th>
            {periods.map((period) => (
              <>
                <th
                  key={period.key}
                  className={`min-w-[110px]${period.isTotal ? ` ${totalBorderClass} font-bold` : ""}`}
                >
                  {period.label}
                </th>
                {showBudget && (
                  <>
                    <th
                      key={`${period.key}-budget`}
                      className="min-w-[100px] text-muted-foreground"
                    >
                      Budget
                    </th>
                    <th
                      key={`${period.key}-var`}
                      className="min-w-[90px] text-muted-foreground"
                    >
                      {varianceDisplay === "percentage" ? "Var %" : "Var $"}
                    </th>
                  </>
                )}
              </>
            ))}
            {showYoY && (
              <>
                <th className="min-w-[120px]">Prior Year</th>
                <th className="min-w-[120px]">
                  {varianceDisplay === "percentage" ? "YoY %" : "YoY Change"}
                </th>
              </>
            )}
          </tr>
        </thead>
          {data.sections.map((section) => {
            const isCollapsed = collapsedSections.has(section.id);
            const hasLines = section.lines.length > 0;
            const hasTitle = section.title.length > 0;

            // If this is a pure computed-line section (no title, no lines, just subtotalLine)
            if (!hasTitle && !hasLines && section.subtotalLine) {
              const line = section.subtotalLine;
              const isMargin = line.id.endsWith("_pct");
              const rowClass = line.isGrandTotal
                ? "stmt-grand-total"
                : line.isTotal
                  ? "stmt-subtotal"
                  : isMargin
                    ? "stmt-margin-row"
                    : "";

              // Extra spacing after operating margin % to visually separate
              // operating results from non-operating items below the line
              const addExtraGap = section.id === "operating_margin_pct";

              return (
                <tbody key={section.id}>
                  <tr className={rowClass}>
                    <td
                      style={{
                        paddingLeft: isMargin ? "2rem" : undefined,
                      }}
                    >
                      {line.label}
                    </td>
                    {renderPeriodCells(line, "computed")}
                    {showYoY && renderYoYCells(line)}
                  </tr>
                  {addExtraGap && (
                    <tr className="stmt-separator-lg">
                      <td colSpan={totalCols}></td>
                    </tr>
                  )}
                </tbody>
              );
            }

            // Headerless section with lines (below-the-line items) — render lines only, no header or subtotal
            if (!hasTitle && hasLines) {
              return (
                <tbody key={section.id}>
                  {section.lines.map((line) => {
                    const isStriped = stripeIndex % 2 === 0;
                    stripeIndex++;
                    return (
                      <tr
                        key={line.id}
                        className={`stmt-line-item ${isStriped ? "stmt-row-striped" : ""}`}
                      >
                        <td style={{ paddingLeft: "2rem" }}>{line.label}</td>
                        {renderPeriodCells(line, "budget-row")}
                        {showYoY && renderYoYCells(line)}
                      </tr>
                    );
                  })}
                </tbody>
              );
            }

            // Section with title and lines
            return (
              <tbody key={section.id}>
                {/* Section header */}
                {hasTitle && (
                  <tr className="stmt-section-header">
                    <td colSpan={totalCols}>
                      {hasLines ? (
                        <button
                          onClick={() => toggleSection(section.id)}
                          className="flex items-center gap-1 hover:text-primary transition-colors w-full text-left font-bold"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                          )}
                          {section.title}
                        </button>
                      ) : (
                        section.title
                      )}
                    </td>
                  </tr>
                )}

                {/* Separator row */}
                {hasTitle && (
                  <tr className="stmt-separator">
                    <td colSpan={totalCols}></td>
                  </tr>
                )}

                {/* Line items (collapsible) */}
                {!isCollapsed &&
                  section.lines.map((line) => {
                    if (line.isHeader) {
                      return (
                        <tr key={line.id} className="stmt-section-header">
                          <td
                            colSpan={totalCols}
                            style={{
                              paddingLeft: "2rem",
                              fontSize: "0.8125rem",
                            }}
                          >
                            <em>{line.label}</em>
                          </td>
                        </tr>
                      );
                    }

                    if (line.isSeparator) {
                      return (
                        <tr key={line.id} className="stmt-separator">
                          <td colSpan={totalCols}></td>
                        </tr>
                      );
                    }

                    const isStriped = stripeIndex % 2 === 0;
                    stripeIndex++;

                    return (
                      <tr
                        key={line.id}
                        className={`stmt-line-item ${isStriped ? "stmt-row-striped" : ""}`}
                      >
                        <td>{line.label}</td>
                        {renderPeriodCells(line, "budget-row")}
                        {showYoY && renderYoYCells(line)}
                      </tr>
                    );
                  })}

                {/* Subtotal line */}
                {section.subtotalLine && (
                  <tr
                    className={
                      section.subtotalLine.isGrandTotal
                        ? "stmt-grand-total"
                        : "stmt-subtotal"
                    }
                  >
                    <td>{section.subtotalLine.label}</td>
                    {renderPeriodCells(section.subtotalLine, "subtotal")}
                    {showYoY && renderYoYCells(section.subtotalLine)}
                  </tr>
                )}

                {/* Add spacing after section */}
                <tr className="stmt-separator">
                  <td colSpan={totalCols}></td>
                </tr>
              </tbody>
            );
          })}
          {/* Cash flow reconciliation check: Beginning + Net Change should = Ending */}
          {data.id === "cash_flow" && (() => {
            const summarySection = data.sections.find((s) => s.id === "cf-summary");
            const netChangeLine = summarySection?.lines.find((l) => l.id === "cf-net-change");
            const beginningLine = summarySection?.subtotalLine; // hidden; carries beginning cash data
            const endingLine = summarySection?.lines.find((l) => l.id === "cf-cash-end");
            if (!netChangeLine || !beginningLine || !endingLine) return null;

            const hasImbalance = periods.some((p) => {
              const expected = (beginningLine.amounts[p.key] ?? 0) + (netChangeLine.amounts[p.key] ?? 0);
              const actual = endingLine.amounts[p.key] ?? 0;
              return Math.abs(expected - actual) >= 0.5;
            });

            return (
              <tbody>
                <tr className="stmt-separator"><td colSpan={totalCols}></td></tr>
                <tr className="text-xs">
                  <td className={`italic ${hasImbalance ? "text-red-600" : "text-muted-foreground"}`}>
                    Check: Beginning + Net Change − Ending
                  </td>
                  {periods.map((period) => {
                    const expected = (beginningLine.amounts[period.key] ?? 0) + (netChangeLine.amounts[period.key] ?? 0);
                    const actual = endingLine.amounts[period.key] ?? 0;
                    const diff = expected - actual;
                    const isOff = Math.abs(diff) >= 0.5;
                    const checkBorderCls = period.isTotal ? ` ${totalBorderClass}` : "";
                    return (
                      <>
                        <td key={period.key} className={`${isOff ? "text-red-600 font-medium" : "text-muted-foreground"}${checkBorderCls}`}>
                          {isOff ? formatStatementAmount(diff, true) : "$\u2014"}
                        </td>
                        {showBudget && (
                          <>
                            <td key={`${period.key}-budget`}></td>
                            <td key={`${period.key}-var`}></td>
                          </>
                        )}
                      </>
                    );
                  })}
                  {showYoY && (
                    <>
                      <td></td>
                      <td></td>
                    </>
                  )}
                </tr>
              </tbody>
            );
          })()}
          {/* Balance check row for balance sheets */}
          {data.id === "balance_sheet" && (() => {
            const totalAssets = data.sections.find((s) => s.id === "total_assets")?.subtotalLine;
            const totalLE = data.sections.find((s) => s.id === "total_liabilities_and_equity")?.subtotalLine;
            if (!totalAssets || !totalLE) return null;

            const hasImbalance = periods.some((p) => {
              const diff = (totalAssets.amounts[p.key] ?? 0) - (totalLE.amounts[p.key] ?? 0);
              return Math.abs(diff) >= 0.5;
            });

            return (
              <tbody>
                <tr className="stmt-separator"><td colSpan={totalCols}></td></tr>
                <tr className="text-xs">
                  <td className={`italic ${hasImbalance ? "text-red-600" : "text-muted-foreground"}`}>
                    Check: Assets − (Liabilities + Equity)
                  </td>
                  {periods.map((period) => {
                    const diff = (totalAssets.amounts[period.key] ?? 0) - (totalLE.amounts[period.key] ?? 0);
                    const isOff = Math.abs(diff) >= 0.5;
                    const checkBorderCls = period.isTotal ? ` ${totalBorderClass}` : "";
                    return (
                      <>
                        <td key={period.key} className={`${isOff ? "text-red-600 font-medium" : "text-muted-foreground"}${checkBorderCls}`}>
                          {isOff ? formatStatementAmount(diff, true) : "$\u2014"}
                        </td>
                        {showBudget && (
                          <>
                            <td key={`${period.key}-budget`}></td>
                            <td key={`${period.key}-var`}></td>
                          </>
                        )}
                      </>
                    );
                  })}
                  {showYoY && (
                    <>
                      <td></td>
                      <td></td>
                    </>
                  )}
                </tr>
              </tbody>
            );
          })()}
      </table>
    </div>
  );
}
