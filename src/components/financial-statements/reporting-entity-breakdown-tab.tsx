"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { StatementHeader } from "./statement-header";
import { EntityBreakdownTable } from "./entity-breakdown-table";
import { useReportingEntityBreakdown } from "./use-reporting-entity-breakdown";
import { filterForEbitdaOnly } from "./format-utils";
import type { Granularity } from "./types";

interface ReportingEntityBreakdownTabProps {
  organizationId: string | null;
  chartId?: string | null;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  includeProForma: boolean;
  includeAllocations?: boolean;
  ebitdaOnly?: boolean;
}

export function ReportingEntityBreakdownTab({
  organizationId,
  chartId,
  startYear,
  startMonth,
  endYear,
  endMonth,
  granularity,
  includeProForma,
  includeAllocations = false,
  ebitdaOnly = false,
}: ReportingEntityBreakdownTabProps) {
  const [activeStatement, setActiveStatement] = useState<
    "income-statement" | "balance-sheet"
  >("income-statement");
  const [showPctOfTotal, setShowPctOfTotal] = useState(false);

  const { data, loading, error } = useReportingEntityBreakdown(
    {
      organizationId: organizationId ?? undefined,
      chartId: chartId ?? undefined,
      startYear,
      startMonth,
      endYear,
      endMonth,
      granularity,
      includeProForma,
      includeAllocations,
    },
    !!organizationId
  );

  if (!organizationId) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Loading organization data...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Loading reporting entity breakdown...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.columns.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No reporting entities found. Set up reporting entities in Settings to
            see the breakdown.
          </p>
        </CardContent>
      </Card>
    );
  }

  const companyName = data.metadata.organizationName ?? "";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between stmt-no-print">
        <Tabs
          value={activeStatement}
          onValueChange={(v) =>
            setActiveStatement(v as "income-statement" | "balance-sheet")
          }
        >
          <TabsList>
            <TabsTrigger value="income-statement">
              Income Statement
            </TabsTrigger>
            <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
          </TabsList>
        </Tabs>

        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <Checkbox
            checked={showPctOfTotal}
            onCheckedChange={(checked) => setShowPctOfTotal(checked === true)}
          />
          % of Total
        </label>
      </div>

      <Card>
        <CardContent className="pt-2 pb-6 px-4">
          <StatementHeader
            companyName={companyName}
            statementTitle={
              activeStatement === "income-statement"
                ? "Income Statement — Reporting Entity Breakdown"
                : "Balance Sheet — Reporting Entity Breakdown"
            }
            startYear={startYear}
            startMonth={startMonth}
            endYear={endYear}
            endMonth={endMonth}
            granularity={granularity}
          />
          <EntityBreakdownTable
            data={
              activeStatement === "income-statement"
                ? ebitdaOnly
                  ? filterForEbitdaOnly(data.incomeStatement)
                  : data.incomeStatement
                : data.balanceSheet
            }
            columns={data.columns}
            showPctOfTotal={showPctOfTotal}
          />
        </CardContent>
      </Card>
    </div>
  );
}
