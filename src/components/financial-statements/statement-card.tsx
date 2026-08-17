"use client";

import { Card, CardContent } from "@/components/ui/card";
import { StatementHeader } from "./statement-header";
import { StatementTable } from "./statement-table";
import type { StatementData, Period, Granularity, LineItem, VarianceDisplayMode } from "./types";

interface StatementCardProps {
  companyName: string;
  statementTitle: string;
  statementData: StatementData;
  periods: Period[];
  showBudget: boolean;
  showYoY: boolean;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  varianceDisplay?: VarianceDisplayMode;
  /** Anchor budget + prior-year comparisons to the Total column only. */
  compareTotalOnly?: boolean;
  pageBreak?: boolean;
  compactLabels?: boolean;
  onCellClick?: (
    line: LineItem,
    periodKey: string,
    periodLabel: string,
    columnType: "actual" | "budget",
    amount: number
  ) => void;
}

export function StatementCard({
  companyName,
  statementTitle,
  statementData,
  periods,
  showBudget,
  showYoY,
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  varianceDisplay,
  compareTotalOnly = false,
  pageBreak = false,
  compactLabels = false,
  onCellClick,
}: StatementCardProps) {
  return (
    <div className={`stmt-single-page${pageBreak ? " stmt-page-break" : ""}`}>
      <Card>
        <CardContent className="pt-2 pb-6 px-4">
          <StatementHeader
            companyName={companyName}
            statementTitle={statementTitle}
            startYear={startYear}
            startMonth={startMonth}
            endYear={endYear}
            endMonth={endMonth}
            granularity={granularity}
          />
          <StatementTable
            data={statementData}
            periods={periods}
            showBudget={showBudget}
            showYoY={showYoY}
            varianceDisplay={varianceDisplay}
            compareTotalOnly={compareTotalOnly}
            compactLabels={compactLabels}
            onCellClick={onCellClick}
          />
        </CardContent>
      </Card>
    </div>
  );
}
