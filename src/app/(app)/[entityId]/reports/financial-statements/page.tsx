"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCurrentPeriod } from "@/lib/utils/dates";
import { StatementCard } from "@/components/financial-statements/statement-card";
import { ConfigToolbar } from "@/components/financial-statements/config-toolbar";
import { useFinancialStatements } from "@/components/financial-statements/use-financial-statements";
import { filterForEbitdaOnly } from "@/components/financial-statements/format-utils";
import { usePrintFitToPage } from "@/components/financial-statements/use-print-fit-to-page";
import type {
  Granularity,
  StatementTab,
  FinancialModelConfig,
} from "@/components/financial-statements/types";

export default function FinancialStatementsPage() {
  const params = useParams();
  const entityId = params.entityId as string;

  const currentPeriod = getCurrentPeriod();

  // Config state
  const [startYear, setStartYear] = useState(currentPeriod.year);
  const [startMonth, setStartMonth] = useState(1);
  const [endYear, setEndYear] = useState(currentPeriod.year);
  const [endMonth, setEndMonth] = useState(currentPeriod.month);
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [includeBudget, setIncludeBudget] = useState(false);
  const [includeYoY, setIncludeYoY] = useState(false);
  const [includeTotal, setIncludeTotal] = useState(false);
  const [compareTotalOnly, setCompareTotalOnly] = useState(false);
  const [ebitdaOnly, setEbitdaOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<StatementTab>("all");

  const config: FinancialModelConfig = {
    scope: "entity",
    entityId,
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity,
    includeBudget,
    includeYoY,
    includeProForma: false,
    includeAllocations: false,
    includeTotal,
  };

  const { data, loading, error } = useFinancialStatements(config);
  usePrintFitToPage();

  function buildExportUrl(statements: StatementTab) {
    const exportParams = new URLSearchParams({
      scope: "entity",
      entityId,
      startYear: String(startYear),
      startMonth: String(startMonth),
      endYear: String(endYear),
      endMonth: String(endMonth),
      granularity,
      includeBudget: String(includeBudget),
      includeYoY: String(includeYoY),
      includeTotal: String(includeTotal),
      compareTotalOnly: String(compareTotalOnly),
      statements,
    });
    return `/api/financial-statements/export?${exportParams.toString()}`;
  }

  function handleExport() {
    window.location.href = buildExportUrl(activeTab);
  }

  function handleExportAll() {
    window.location.href = buildExportUrl("all");
  }

  function handlePrint() {
    window.print();
  }

  const companyName =
    data?.metadata.entityName ?? data?.metadata.organizationName ?? "";

  const incomeStatementData = data
    ? ebitdaOnly
      ? filterForEbitdaOnly(data.incomeStatement)
      : data.incomeStatement
    : undefined;

  const sharedCardProps = {
    companyName,
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity,
    compareTotalOnly,
  };

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="stmt-no-print">
        <h1 className="text-2xl font-semibold tracking-tight">
          Financial Statements
        </h1>
        <p className="text-muted-foreground text-sm">
          Three-statement financial model
        </p>
      </div>

      {/* Config toolbar */}
      <ConfigToolbar
        startYear={startYear}
        startMonth={startMonth}
        endYear={endYear}
        endMonth={endMonth}
        granularity={granularity}
        includeBudget={includeBudget}
        includeYoY={includeYoY}
        ebitdaOnly={ebitdaOnly}
        includeTotal={includeTotal}
        compareTotalOnly={compareTotalOnly}
        onStartYearChange={setStartYear}
        onStartMonthChange={setStartMonth}
        onEndYearChange={setEndYear}
        onEndMonthChange={setEndMonth}
        onGranularityChange={setGranularity}
        onIncludeBudgetChange={setIncludeBudget}
        onIncludeYoYChange={setIncludeYoY}
        onEbitdaOnlyChange={setEbitdaOnly}
        onIncludeTotalChange={setIncludeTotal}
        onCompareTotalOnlyChange={setCompareTotalOnly}
        onExport={handleExport}
        onExportAll={handleExportAll}
        onPrint={handlePrint}
        loading={loading}
        activeTab={activeTab}
      />

      {/* Loading state */}
      {loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Loading financial statements...
            </p>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {error && !loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* No data state */}
      {!loading && !error && data && data.periods.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No balance data for this period range. Sync QuickBooks to
              populate.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Statements with tabs */}
      {!loading && data && data.periods.length > 0 && (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as StatementTab)}
        >
          <TabsList className="stmt-no-print">
            <TabsTrigger value="all">All Statements</TabsTrigger>
            <TabsTrigger value="income-statement">Income Statement</TabsTrigger>
            <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
            <TabsTrigger value="cash-flow">Cash Flow</TabsTrigger>
          </TabsList>

          {/* All Statements */}
          <TabsContent value="all" className="space-y-4">
            <StatementCard
              {...sharedCardProps}
              statementTitle="Income Statement"
              statementData={incomeStatementData!}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
            />
            <StatementCard
              {...sharedCardProps}
              statementTitle="Balance Sheet"
              statementData={data.balanceSheet}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
              pageBreak
            />
            <StatementCard
              {...sharedCardProps}
              statementTitle="Statement of Cash Flows"
              statementData={data.cashFlowStatement}
              periods={data.periods}
              showBudget={false}
              showYoY={includeYoY}
              pageBreak
            />
          </TabsContent>

          {/* Income Statement */}
          <TabsContent value="income-statement">
            <StatementCard
              {...sharedCardProps}
              statementTitle="Income Statement"
              statementData={incomeStatementData!}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
            />
          </TabsContent>

          {/* Balance Sheet */}
          <TabsContent value="balance-sheet">
            <StatementCard
              {...sharedCardProps}
              statementTitle="Balance Sheet"
              statementData={data.balanceSheet}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
            />
          </TabsContent>

          {/* Cash Flow */}
          <TabsContent value="cash-flow">
            <StatementCard
              {...sharedCardProps}
              statementTitle="Statement of Cash Flows"
              statementData={data.cashFlowStatement}
              periods={data.periods}
              showBudget={false}
              showYoY={includeYoY}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
