"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCurrentPeriod } from "@/lib/utils/dates";
import { StatementCard } from "@/components/financial-statements/statement-card";
import { ConfigToolbar } from "@/components/financial-statements/config-toolbar";
import { useFinancialStatements } from "@/components/financial-statements/use-financial-statements";
import { useDrillDown } from "@/components/financial-statements/use-drill-down";
import { DrillDownDialog } from "@/components/financial-statements/drill-down-dialog";
import { filterForEbitdaOnly } from "@/components/financial-statements/format-utils";
import { usePrintFitToPage } from "@/components/financial-statements/use-print-fit-to-page";
import { ProFormaTab } from "@/components/financial-statements/pro-forma-tab";
import { ProFormaDetailSchedule } from "@/components/financial-statements/pro-forma-detail-schedule";
import { AllocationTab } from "@/components/financial-statements/allocation-tab";
import { EntityBreakdownTab } from "@/components/financial-statements/entity-breakdown-tab";
import { ReportingEntityBreakdownTab } from "@/components/financial-statements/reporting-entity-breakdown-tab";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
} from "lucide-react";
import type {
  Granularity,
  Scope,
  StatementTab,
  FinancialModelConfig,
  LineItem,
  VarianceDisplayMode,
} from "@/components/financial-statements/types";

interface Entity {
  id: string;
  name: string;
  code: string;
}

interface ReportingEntityOption {
  id: string;
  name: string;
  code: string;
}

export default function FinancialModelPage() {
  const supabase = createClient();
  const currentPeriod = getCurrentPeriod();

  // Organization / entity state
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [reportingEntities, setReportingEntities] = useState<
    ReportingEntityOption[]
  >([]);
  const [scope, setScope] = useState<Scope>("organization");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedReportingEntityId, setSelectedReportingEntityId] = useState<
    string | null
  >(null);

  // Config state
  const [startYear, setStartYear] = useState(currentPeriod.year);
  const [startMonth, setStartMonth] = useState(1);
  const [endYear, setEndYear] = useState(currentPeriod.year);
  const [endMonth, setEndMonth] = useState(currentPeriod.month);
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [includeBudget, setIncludeBudget] = useState(false);
  const [includeYoY, setIncludeYoY] = useState(false);
  const [includeProForma, setIncludeProForma] = useState(false);
  const [showProFormaDetails, setShowProFormaDetails] = useState(false);
  const [includeAllocations, setIncludeAllocations] = useState(false);
  const [includeTotal, setIncludeTotal] = useState(false);
  const [ebitdaOnly, setEbitdaOnly] = useState(false);
  const [varianceDisplay, setVarianceDisplay] = useState<VarianceDisplayMode>("dollars");
  const [activeTab, setActiveTab] = useState<StatementTab>("all");
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Prevents the financial-data hook from firing until loadOrg has finished
  // setting organizationId.  Without this gate the hook could fire before
  // the org/entity lookups complete, producing an intermediate fetch with
  // incomplete config.
  const [configReady, setConfigReady] = useState(false);

  // Load organization
  const loadOrg = useCallback(async () => {
    setConfigReady(false);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (membership) {
      setOrganizationId(membership.organization_id);

      const { data: ents } = await supabase
        .from("entities")
        .select("id, name, code")
        .eq("organization_id", membership.organization_id)
        .eq("is_active", true)
        .order("name");

      setEntities(ents ?? []);

      // Load reporting entities
      const reRes = await fetch(
        `/api/reporting-entities?organizationId=${membership.organization_id}`
      );
      if (reRes.ok) {
        const reData = await reRes.json();
        setReportingEntities(
          (reData.reportingEntities ?? []).map(
            (re: { id: string; name: string; code: string }) => ({
              id: re.id,
              name: re.name,
              code: re.code,
            })
          )
        );
      }

      // Pro forma and allocations toggles intentionally default to unchecked.
      // The user opts in explicitly via the toolbar; the API only includes
      // these adjustments when the corresponding query flag is true, so the
      // on-screen model matches the toggle state.
    }

    setConfigReady(true);
  }, [supabase]);

  useEffect(() => {
    loadOrg();
  }, [loadOrg]);

  const config: FinancialModelConfig = {
    scope,
    entityId: scope === "entity" ? (selectedEntityId ?? undefined) : undefined,
    organizationId:
      scope !== "entity" ? (organizationId ?? undefined) : undefined,
    reportingEntityId:
      scope === "reporting_entity"
        ? (selectedReportingEntityId ?? undefined)
        : undefined,
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity,
    includeBudget,
    includeYoY,
    includeProForma,
    includeAllocations,
    includeTotal,
  };

  // Only fetch when loadOrg is done and we have the IDs we need
  const canFetch =
    configReady &&
    ((scope === "organization" && organizationId) ||
      (scope === "entity" && selectedEntityId) ||
      (scope === "reporting_entity" && selectedReportingEntityId));

  const { data, loading, error, stale, generate } = useFinancialStatements(config, !!canFetch, true);
  const drillDown = useDrillDown(config);
  usePrintFitToPage();

  function handleCellClick(statementId: string) {
    return (
      line: LineItem,
      periodKey: string,
      periodLabel: string,
      columnType: "actual" | "budget",
      amount: number
    ) => {
      drillDown.openDrillDown(line, periodKey, periodLabel, columnType, amount, statementId);
    };
  }

  function buildExportUrl(statements: StatementTab) {
    const exportParams = new URLSearchParams({
      scope,
      startYear: String(startYear),
      startMonth: String(startMonth),
      endYear: String(endYear),
      endMonth: String(endMonth),
      granularity,
      includeBudget: String(includeBudget),
      includeYoY: String(includeYoY),
      includeProForma: String(includeProForma),
      includeAllocations: String(includeAllocations),
      includeTotal: String(includeTotal),
      varianceDisplay,
      statements,
    });
    if (scope === "entity" && selectedEntityId) {
      exportParams.set("entityId", selectedEntityId);
    }
    if (scope !== "entity" && organizationId) {
      exportParams.set("organizationId", organizationId);
    }
    if (scope === "reporting_entity" && selectedReportingEntityId) {
      exportParams.set("reportingEntityId", selectedReportingEntityId);
    }
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

  // Header company name reflects the active view. The API always sets
  // organizationName on every scope, so we cannot rely on a generic fallback
  // chain — we must key off `scope`. Local selections are preferred so the
  // header updates immediately when the user changes scope, before the next
  // fetch completes.
  const companyName =
    scope === "reporting_entity"
      ? (reportingEntities.find((r) => r.id === selectedReportingEntityId)
          ?.name ??
          data?.metadata.reportingEntityName ??
          "")
      : scope === "entity"
        ? (entities.find((e) => e.id === selectedEntityId)?.name ??
            data?.metadata.entityName ??
            "")
        : (data?.metadata.organizationName ?? "");

  // Only the consolidated view still gets a "Consolidated" qualifier on the
  // statement title. For reporting-entity and entity scopes, the name is
  // already shown on the company-name line of the header, so prepending it
  // again to the title would duplicate it.
  const titlePrefix = scope === "organization" ? "Consolidated " : "";

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
    varianceDisplay,
  };

  const sharedScheduleProps = {
    companyName,
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity,
  };

  const proFormaDetails = data?.proFormaAdjustments ?? [];

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="stmt-no-print">
        <h1 className="text-2xl font-semibold tracking-tight">
          Financial Model
        </h1>
        <p className="text-muted-foreground text-sm">
          Consolidated three-statement financial model
        </p>
      </div>

      {/* Scope selector */}
      <div className="stmt-no-print flex items-end gap-3 pb-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Scope</Label>
          <Select
            value={scope}
            onValueChange={(v) => setScope(v as Scope)}
          >
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organization">Consolidated</SelectItem>
              <SelectItem value="entity">Single Entity</SelectItem>
              {reportingEntities.length > 0 && (
                <SelectItem value="reporting_entity">
                  Reporting Entity
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {scope === "entity" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Entity</Label>
            <Select
              value={selectedEntityId ?? ""}
              onValueChange={setSelectedEntityId}
            >
              <SelectTrigger className="w-[220px] h-8 text-xs">
                <SelectValue placeholder="Select entity..." />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.code} — {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {scope === "reporting_entity" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Reporting Entity
            </Label>
            <Select
              value={selectedReportingEntityId ?? ""}
              onValueChange={setSelectedReportingEntityId}
            >
              <SelectTrigger className="w-[220px] h-8 text-xs">
                <SelectValue placeholder="Select reporting entity..." />
              </SelectTrigger>
              <SelectContent>
                {reportingEntities.map((re) => (
                  <SelectItem key={re.id} value={re.id}>
                    {re.code} — {re.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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
        includeProForma={includeProForma}
        showProFormaDetails={showProFormaDetails}
        includeAllocations={includeAllocations}
        ebitdaOnly={ebitdaOnly}
        includeTotal={includeTotal}
        onStartYearChange={setStartYear}
        onStartMonthChange={setStartMonth}
        onEndYearChange={setEndYear}
        onEndMonthChange={setEndMonth}
        onGranularityChange={setGranularity}
        onIncludeBudgetChange={setIncludeBudget}
        onIncludeYoYChange={setIncludeYoY}
        onIncludeProFormaChange={(val) => {
          setIncludeProForma(val);
          if (!val) setShowProFormaDetails(false);
        }}
        onShowProFormaDetailsChange={setShowProFormaDetails}
        onIncludeAllocationsChange={setIncludeAllocations}
        onEbitdaOnlyChange={setEbitdaOnly}
        onIncludeTotalChange={setIncludeTotal}
        varianceDisplay={varianceDisplay}
        onVarianceDisplayChange={setVarianceDisplay}
        onGenerate={generate}
        onExport={handleExport}
        onExportAll={handleExportAll}
        onPrint={handlePrint}
        loading={loading}
        hasData={!!data}
        activeTab={activeTab}
      />

      {(!data || stale) && !loading && !error && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {scope === "entity" && !selectedEntityId
                ? "Select an entity, then click Generate."
                : scope === "reporting_entity" && !selectedReportingEntityId
                  ? "Select a reporting entity, then click Generate."
                  : stale
                    ? "Configuration changed — click Generate to update."
                    : "Configure your report options above, then click Generate."}
            </p>
          </CardContent>
        </Card>
      )}

      {loading && canFetch && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              Loading financial statements...
            </p>
          </CardContent>
        </Card>
      )}

      {error && !loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Data Diagnostics Panel */}
      {!loading && !error && !stale && data && data.diagnostics && canFetch && (
        <div className="stmt-no-print">
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDiagnostics ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Database className="h-3 w-3" />
            <span>Data Diagnostics</span>
            {data.diagnostics.paginationErrors ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-[10px] font-medium">
                <AlertTriangle className="h-3 w-3" />
                Pagination Errors
              </span>
            ) : Object.values(data.diagnostics.bsCheck).some(
                (v) => Math.abs(v) > 0.01
              ) ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 text-[10px] font-medium">
                <AlertTriangle className="h-3 w-3" />
                BS Imbalance Detected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-medium">
                <CheckCircle2 className="h-3 w-3" />
                All Checks Passed
              </span>
            )}
          </button>

          {showDiagnostics && (
            <div className="mt-2 rounded-lg border bg-muted/30 p-4 text-xs space-y-3">
              {/* Row count summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {scope !== "entity" && (
                  <div>
                    <p className="text-muted-foreground">Master Accounts</p>
                    <p className="text-sm font-medium">
                      {data.diagnostics.masterAccountsLoaded.toLocaleString()}
                    </p>
                  </div>
                )}
                {scope !== "entity" && (
                  <div>
                    <p className="text-muted-foreground">Account Mappings</p>
                    <p className="text-sm font-medium">
                      {data.diagnostics.mappingsLoaded.toLocaleString()}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground">GL Rows Fetched</p>
                  <p className="text-sm font-medium">
                    {data.diagnostics.glRowsFetchedRaw.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">GL Rows (Filtered)</p>
                  <p className="text-sm font-medium">
                    {data.diagnostics.glRowsAfterFilter.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Accounts w/ Data</p>
                  <p className="text-sm font-medium">
                    {data.diagnostics.uniqueAccountsWithData.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Entities</p>
                  <p className="text-sm font-medium">
                    {data.diagnostics.entityCount.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Pagination status */}
              {data.diagnostics.paginationErrors && (
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="font-medium">
                    Warning: Some pages failed to load. Data may be incomplete.
                    Try refreshing.
                  </span>
                </div>
              )}

              {/* Balance sheet check */}
              {Object.keys(data.diagnostics.bsCheck).length > 0 && (
                <div>
                  <p className="text-muted-foreground mb-1">
                    Balance Sheet Check (Assets − Liabilities − Equity):
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(data.diagnostics.bsCheck).map(
                      ([period, diff]) => (
                        <span
                          key={period}
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono ${
                            Math.abs(diff) > 0.01
                              ? "bg-destructive/10 text-destructive"
                              : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                          }`}
                        >
                          {period}:{" "}
                          {Math.abs(diff) > 0.01
                            ? `$${diff.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}`
                            : "$0.00"}
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && !error && !stale && data && data.periods.length > 0 && canFetch && (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as StatementTab)}
        >
          <TabsList className="stmt-no-print">
            <TabsTrigger value="all">All Statements</TabsTrigger>
            <TabsTrigger value="income-statement">Income Statement</TabsTrigger>
            <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
            <TabsTrigger value="cash-flow">Cash Flow</TabsTrigger>
            <TabsTrigger value="pro-forma">Pro Forma Adjustments</TabsTrigger>
            <TabsTrigger value="allocations">Allocations</TabsTrigger>
            <TabsTrigger value="entity-breakdown">Entity Breakdown</TabsTrigger>
            {scope === "organization" && reportingEntities.length > 0 && (
              <TabsTrigger value="re-breakdown">RE Breakdown</TabsTrigger>
            )}
          </TabsList>

          {/* All Statements */}
          <TabsContent value="all" className="space-y-4">
            <StatementCard
              {...sharedCardProps}
              statementTitle={`${titlePrefix}Income Statement`}
              statementData={incomeStatementData!}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
              onCellClick={handleCellClick("income_statement")}
            />
            {!ebitdaOnly && (
              <>
                <StatementCard
                  {...sharedCardProps}
                  statementTitle={`${titlePrefix}Balance Sheet`}
                  statementData={data.balanceSheet}
                  periods={data.periods}
                  showBudget={includeBudget}
                  showYoY={includeYoY}
                  pageBreak
                  onCellClick={handleCellClick("balance_sheet")}
                />
                <StatementCard
                  {...sharedCardProps}
                  statementTitle={`${titlePrefix}Statement of Cash Flows`}
                  statementData={data.cashFlowStatement}
                  periods={data.periods}
                  showBudget={false}
                  showYoY={includeYoY}
                  pageBreak
                  onCellClick={handleCellClick("cash_flow")}
                />
              </>
            )}
            {/* On-screen pro forma detail (hidden in print — print version below) */}
            {showProFormaDetails && proFormaDetails.length > 0 && (
              <div className="stmt-no-print">
                <ProFormaDetailSchedule
                  {...sharedScheduleProps}
                  adjustments={proFormaDetails}
                />
              </div>
            )}
            {/* Print-only pro forma detail listing (separate page) */}
            {includeProForma && proFormaDetails.length > 0 && (
              <div className="hidden print:block stmt-page-break">
                <ProFormaDetailSchedule
                  {...sharedScheduleProps}
                  adjustments={proFormaDetails}
                  printMode
                />
              </div>
            )}
          </TabsContent>

          {/* Income Statement */}
          <TabsContent value="income-statement" className="space-y-4">
            <StatementCard
              {...sharedCardProps}
              statementTitle={`${titlePrefix}Income Statement`}
              statementData={incomeStatementData!}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
              onCellClick={handleCellClick("income_statement")}
            />
            {showProFormaDetails && proFormaDetails.length > 0 && (
              <div className="stmt-no-print">
                <ProFormaDetailSchedule
                  {...sharedScheduleProps}
                  adjustments={proFormaDetails}
                />
              </div>
            )}
            {includeProForma && proFormaDetails.length > 0 && (
              <div className="hidden print:block stmt-page-break">
                <ProFormaDetailSchedule
                  {...sharedScheduleProps}
                  adjustments={proFormaDetails}
                  printMode
                />
              </div>
            )}
          </TabsContent>

          {/* Balance Sheet */}
          <TabsContent value="balance-sheet" className="space-y-4">
            <StatementCard
              {...sharedCardProps}
              statementTitle={`${titlePrefix}Balance Sheet`}
              statementData={data.balanceSheet}
              periods={data.periods}
              showBudget={includeBudget}
              showYoY={includeYoY}
              onCellClick={handleCellClick("balance_sheet")}
            />
            {showProFormaDetails && proFormaDetails.length > 0 && (
              <div className="stmt-no-print">
                <ProFormaDetailSchedule
                  {...sharedScheduleProps}
                  adjustments={proFormaDetails}
                />
              </div>
            )}
            {includeProForma && proFormaDetails.length > 0 && (
              <div className="hidden print:block stmt-page-break">
                <ProFormaDetailSchedule
                  {...sharedScheduleProps}
                  adjustments={proFormaDetails}
                  printMode
                />
              </div>
            )}
          </TabsContent>

          {/* Cash Flow */}
          <TabsContent value="cash-flow" className="space-y-4">
            <StatementCard
              {...sharedCardProps}
              statementTitle={`${titlePrefix}Statement of Cash Flows`}
              statementData={data.cashFlowStatement}
              periods={data.periods}
              showBudget={false}
              showYoY={includeYoY}
              onCellClick={handleCellClick("cash_flow")}
            />
            {showProFormaDetails && proFormaDetails.length > 0 && (
              <div className="stmt-no-print">
                <ProFormaDetailSchedule
                  {...sharedScheduleProps}
                  adjustments={proFormaDetails}
                />
              </div>
            )}
            {includeProForma && proFormaDetails.length > 0 && (
              <div className="hidden print:block stmt-page-break">
                <ProFormaDetailSchedule
                  {...sharedScheduleProps}
                  adjustments={proFormaDetails}
                  printMode
                />
              </div>
            )}
          </TabsContent>

          {/* Pro Forma Adjustments */}
          <TabsContent value="pro-forma">
            <ProFormaTab
              organizationId={organizationId}
              entities={entities}
              scope={scope}
              selectedEntityId={selectedEntityId}
              startYear={startYear}
              startMonth={startMonth}
              endYear={endYear}
              endMonth={endMonth}
              onAdjustmentActivated={() => setIncludeProForma(true)}
            />
          </TabsContent>

          {/* Allocation Adjustments */}
          <TabsContent value="allocations">
            <AllocationTab
              organizationId={organizationId}
              entities={entities}
              scope={scope}
              selectedEntityId={selectedEntityId}
              startYear={startYear}
              startMonth={startMonth}
              endYear={endYear}
              endMonth={endMonth}
              onAllocationActivated={() => setIncludeAllocations(true)}
            />
          </TabsContent>

          {/* Entity Breakdown */}
          <TabsContent value="entity-breakdown">
            <EntityBreakdownTab
              organizationId={organizationId}
              reportingEntityId={
                scope === "reporting_entity"
                  ? selectedReportingEntityId
                  : undefined
              }
              startYear={startYear}
              startMonth={startMonth}
              endYear={endYear}
              endMonth={endMonth}
              granularity={granularity}
              includeProForma={includeProForma}
              includeAllocations={includeAllocations}
              ebitdaOnly={ebitdaOnly}
            />
          </TabsContent>

          {/* Reporting Entity Breakdown */}
          {scope === "organization" && reportingEntities.length > 0 && (
            <TabsContent value="re-breakdown">
              <ReportingEntityBreakdownTab
                organizationId={organizationId}
                startYear={startYear}
                startMonth={startMonth}
                endYear={endYear}
                endMonth={endMonth}
                granularity={granularity}
                includeProForma={includeProForma}
                includeAllocations={includeAllocations}
                ebitdaOnly={ebitdaOnly}
              />
            </TabsContent>
          )}
        </Tabs>
      )}

      {/* Drill-down dialog */}
      <DrillDownDialog
        open={drillDown.isOpen}
        onOpenChange={(open) => {
          if (!open) drillDown.closeDrillDown();
        }}
        loading={drillDown.loading}
        data={drillDown.data}
        error={drillDown.error}
        cellInfo={drillDown.cellInfo}
      />
    </div>
  );
}
