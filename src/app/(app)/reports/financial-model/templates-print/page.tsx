"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { StatementCard } from "@/components/financial-statements/statement-card";
import { StatementHeader } from "@/components/financial-statements/statement-header";
import { EntityBreakdownTable } from "@/components/financial-statements/entity-breakdown-table";
import { ProFormaDetailSchedule } from "@/components/financial-statements/pro-forma-detail-schedule";
import { filterForEbitdaOnly } from "@/components/financial-statements/format-utils";
import { usePrintFitToPage } from "@/components/financial-statements/use-print-fit-to-page";
import {
  resolveTemplatePeriod,
  type DynamicPreset,
} from "@/lib/financial-model-templates/period-resolver";
import type { FinancialModelTemplate } from "@/components/financial-statements/templates-menu";
import type {
  FinancialStatementsResponse,
  EntityBreakdownResponse,
  Granularity,
} from "@/components/financial-statements/types";

// ---------------------------------------------------------------------------
// Top-level page: pulls templates from query, renders each in sequence, then
// triggers window.print() once every section reports ready. The browser's
// print dialog produces a PDF that matches the on-screen Print path on the
// Financial Model page exactly.
// ---------------------------------------------------------------------------

// An item in the export sequence — either a template to render or a
// user-defined separator/title page that lives between templates.
export type ExportSequenceItem =
  | { kind: "template"; id: string; key: string }
  | { kind: "separator"; key: string; title: string; subtitle?: string };

function decodeSeqParam(raw: string | null): ExportSequenceItem[] | null {
  if (!raw) return null;
  try {
    const json =
      typeof window !== "undefined" ? window.atob(raw) : Buffer.from(raw, "base64").toString();
    const parsed = JSON.parse(json) as ExportSequenceItem[];
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function TemplatesPrintPage() {
  const searchParams = useSearchParams();
  const organizationId = searchParams.get("organizationId");
  const idsParam = searchParams.get("ids") ?? "";
  const seqParam = searchParams.get("seq");

  const [allTemplates, setAllTemplates] = useState<
    FinancialModelTemplate[] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  usePrintFitToPage();

  // Load templates for the organization once; the sequence below picks
  // which ones to render (and in what order).
  useEffect(() => {
    if (!organizationId) {
      setLoadError("organizationId is required");
      return;
    }
    fetch(`/api/financial-model-templates?organizationId=${organizationId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((body: { templates: FinancialModelTemplate[] }) => {
        setAllTemplates(body.templates);
      })
      .catch(() => setLoadError("Failed to load templates"));
  }, [organizationId]);

  // Resolve the export sequence: prefer the encoded `seq` param; fall back
  // to the legacy `ids` param so older links keep working.
  const sequence: ExportSequenceItem[] | null =
    allTemplates === null
      ? null
      : (() => {
          const decoded = decodeSeqParam(seqParam);
          if (decoded && decoded.length > 0) {
            const known = new Set(allTemplates.map((t) => t.id));
            return decoded.filter(
              (item) => item.kind === "separator" || known.has(item.id)
            );
          }
          // Legacy: just template IDs in the order given
          const ids = idsParam.split(",").filter(Boolean);
          if (ids.length === 0) {
            return allTemplates.map((t, i) => ({
              kind: "template" as const,
              id: t.id,
              key: `t-${t.id}-${i}`,
            }));
          }
          return ids.map((id, i) => ({
            kind: "template" as const,
            id,
            key: `t-${id}-${i}`,
          }));
        })();

  // Track per-item readiness — once all entries are ready, trigger print
  const readyMapRef = useRef<Map<string, boolean>>(new Map());
  const printedRef = useRef(false);

  const markReady = useCallback(
    (key: string) => {
      readyMapRef.current.set(key, true);
      if (
        !printedRef.current &&
        sequence &&
        sequence.length > 0 &&
        sequence.every((item) => readyMapRef.current.get(item.key))
      ) {
        printedRef.current = true;
        setTimeout(() => window.print(), 350);
      }
    },
    [sequence]
  );

  if (loadError) {
    return <div className="p-8 text-sm text-destructive">{loadError}</div>;
  }

  if (allTemplates === null || sequence === null) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Loading templates…
      </div>
    );
  }

  if (sequence.length === 0) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        No templates to print.
      </div>
    );
  }

  const templatesById = new Map(allTemplates.map((t) => [t.id, t]));

  return (
    <div className="space-y-4">
      <div className="stmt-no-print sticky top-0 bg-background border-b px-4 py-2 flex items-center gap-3 z-10">
        <p className="text-sm text-muted-foreground">
          Print dialog opens automatically once all {sequence.length}{" "}
          page section{sequence.length === 1 ? "" : "s"} finish loading.
        </p>
        <button
          onClick={() => window.print()}
          className="ml-auto text-sm underline"
        >
          Print now
        </button>
      </div>

      {sequence.map((item, idx) => {
        if (item.kind === "separator") {
          return (
            <SeparatorPrintSection
              key={item.key}
              title={item.title}
              subtitle={item.subtitle}
              onReady={() => markReady(item.key)}
              forcePageBreakBefore={idx > 0}
            />
          );
        }
        const t = templatesById.get(item.id);
        if (!t) {
          return null;
        }
        return (
          <TemplatePrintSection
            key={item.key}
            template={t}
            onReady={() => markReady(item.key)}
            forcePageBreakBefore={idx > 0}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Separator / title page — full-page centered title + optional subtitle.
// ---------------------------------------------------------------------------

function SeparatorPrintSection({
  title,
  subtitle,
  onReady,
  forcePageBreakBefore,
}: {
  title: string;
  subtitle?: string;
  onReady: () => void;
  forcePageBreakBefore: boolean;
}) {
  useEffect(() => {
    onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={[
        forcePageBreakBefore ? "stmt-page-break" : "",
        "stmt-single-page",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-h-[9in] flex flex-col items-center justify-center text-center px-12 py-16">
        <h2 className="text-4xl font-semibold tracking-tight">{title}</h2>
        {subtitle && (
          <p className="mt-4 text-lg text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One template's rendered output. Resolves the period (handles static /
// dynamic / hybrid), fetches the right data for the saved active_tab, and
// reports back via onReady when fully rendered.
// ---------------------------------------------------------------------------

function TemplatePrintSection({
  template,
  onReady,
  forcePageBreakBefore,
}: {
  template: FinancialModelTemplate;
  onReady: () => void;
  forcePageBreakBefore: boolean;
}) {
  const resolved = resolveTemplatePeriod({
    periodMode: template.periodMode,
    staticRange:
      template.startYear &&
      template.startMonth &&
      template.endYear &&
      template.endMonth
        ? {
            startYear: template.startYear,
            startMonth: template.startMonth,
            endYear: template.endYear,
            endMonth: template.endMonth,
          }
        : null,
    staticStart:
      template.startYear && template.startMonth
        ? { year: template.startYear, month: template.startMonth }
        : null,
    dynamicPreset: (template.dynamicPreset as DynamicPreset) ?? null,
  });

  const tab = template.activeTab;
  const isStatementsTab =
    tab === "all" ||
    tab === "income-statement" ||
    tab === "balance-sheet" ||
    tab === "cash-flow" ||
    tab === "pro-forma";
  const isBreakdownTab =
    tab === "re-breakdown" || tab === "entity-breakdown";

  if (!resolved) {
    return (
      <UnsupportedSection
        template={template}
        message="has no resolvable period."
        onReady={onReady}
        pageBreakBefore={forcePageBreakBefore}
      />
    );
  }

  if (isStatementsTab) {
    return (
      <StatementsTabSection
        template={template}
        resolved={resolved}
        onReady={onReady}
        pageBreakBefore={forcePageBreakBefore}
      />
    );
  }

  if (isBreakdownTab) {
    return (
      <BreakdownSection
        template={template}
        resolved={resolved}
        apiPath={
          tab === "re-breakdown"
            ? "/api/financial-statements/reporting-entity-breakdown"
            : "/api/financial-statements/entity-breakdown"
        }
        titleSuffix={
          tab === "re-breakdown"
            ? "Reporting Entity Breakdown"
            : "Entity Breakdown"
        }
        onReady={onReady}
        pageBreakBefore={forcePageBreakBefore}
      />
    );
  }

  return (
    <UnsupportedSection
      template={template}
      message={`tab “${tab}” is not yet supported in the templates print export.`}
      onReady={onReady}
      pageBreakBefore={forcePageBreakBefore}
    />
  );
}

function UnsupportedSection({
  template,
  message,
  onReady,
  pageBreakBefore,
}: {
  template: FinancialModelTemplate;
  message: string;
  onReady: () => void;
  pageBreakBefore: boolean;
}) {
  useEffect(() => {
    onReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <PrintWrapper pageBreak={pageBreakBefore}>
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm font-semibold">{template.name}</p>
          <p className="text-xs text-muted-foreground mt-2">{message}</p>
        </CardContent>
      </Card>
    </PrintWrapper>
  );
}

function PrintWrapper({
  children,
  pageBreak,
}: {
  children: React.ReactNode;
  pageBreak: boolean;
}) {
  return (
    <div className={pageBreak ? "stmt-page-break" : undefined}>{children}</div>
  );
}

// ---------------------------------------------------------------------------
// Section: IS / BS / CF / pro-forma / "all"
// Uses the same /api/financial-statements endpoint as the on-screen view and
// renders <StatementCard> components — identical CSS path as Print on the
// Financial Model page.
// ---------------------------------------------------------------------------

function StatementsTabSection({
  template,
  resolved,
  onReady,
  pageBreakBefore,
}: {
  template: FinancialModelTemplate;
  resolved: { startYear: number; startMonth: number; endYear: number; endMonth: number };
  onReady: () => void;
  pageBreakBefore: boolean;
}) {
  const [data, setData] = useState<FinancialStatementsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("scope", template.scope);
    params.set("startYear", String(resolved.startYear));
    params.set("startMonth", String(resolved.startMonth));
    params.set("endYear", String(resolved.endYear));
    params.set("endMonth", String(resolved.endMonth));
    params.set("granularity", template.granularity);
    params.set("includeBudget", String(template.includeBudget));
    params.set("includeYoY", String(template.includeYoY));
    // Pro-forma tab needs the adjustments list even if the template didn't
    // flip on the includeProForma toggle for the numeric impact.
    params.set(
      "includeProForma",
      String(template.includeProForma || template.activeTab === "pro-forma")
    );
    params.set("includeAllocations", String(template.includeAllocations));
    params.set("includeTotal", String(template.includeTotal));
    if (template.scope === "entity" && template.entityId) {
      params.set("entityId", template.entityId);
    }
    if (template.scope !== "entity") {
      // Org ID isn't stored on the template; the API can resolve via session
      // membership when not provided, but our endpoint requires it. We rely
      // on the surrounding page passing orgId via the URL — fetch the
      // template list endpoint above already used it, so re-derive from the
      // window URL.
      const url = new URL(window.location.href);
      const orgId = url.searchParams.get("organizationId");
      if (orgId) params.set("organizationId", orgId);
    }
    if (template.scope === "reporting_entity" && template.reportingEntityId) {
      params.set("reportingEntityId", template.reportingEntityId);
    }
    if (template.chartId) params.set("chartId", template.chartId);

    fetch(`/api/financial-statements?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Fetch failed (${r.status})`);
        }
        return r.json();
      })
      .then((body: FinancialStatementsResponse) => {
        setData(body);
        onReady();
      })
      .catch((e: Error) => {
        setError(e.message);
        onReady();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <PrintWrapper pageBreak={pageBreakBefore}>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-semibold">{template.name}</p>
            <p className="text-sm text-destructive mt-2">{error}</p>
          </CardContent>
        </Card>
      </PrintWrapper>
    );
  }

  if (!data) {
    return (
      <PrintWrapper pageBreak={pageBreakBefore}>
        <div className="p-8 text-sm text-muted-foreground">
          Loading {template.name}…
        </div>
      </PrintWrapper>
    );
  }

  const companyName =
    template.scope === "reporting_entity"
      ? data.metadata.reportingEntityName ?? ""
      : template.scope === "entity"
        ? data.metadata.entityName ?? ""
        : data.metadata.organizationName ?? "";

  const titlePrefix = template.scope === "organization" ? "Consolidated " : "";

  const incomeStatement = template.ebitdaOnly
    ? filterForEbitdaOnly(data.incomeStatement)
    : data.incomeStatement;

  // For a single-statement tab, the tab itself implies which statement
  // prints. For the "all" tab, the per-statement include flags from the
  // template's save dialog drive what's included in the export.
  const tab = template.activeTab;
  const showIS =
    tab === "income-statement" ||
    (tab === "all" && template.includeIncomeStatement);
  const showBS =
    (tab === "balance-sheet" ||
      (tab === "all" && template.includeBalanceSheet)) &&
    !template.ebitdaOnly;
  const showCF =
    (tab === "cash-flow" ||
      (tab === "all" && template.includeCashFlow)) &&
    !template.ebitdaOnly;
  const showProForma =
    (tab === "pro-forma" ||
      (tab === "all" && template.includeProFormaSchedule)) &&
    !!data.proFormaAdjustments &&
    data.proFormaAdjustments.length > 0;

  const sharedProps = {
    companyName,
    startYear: resolved.startYear,
    startMonth: resolved.startMonth,
    endYear: resolved.endYear,
    endMonth: resolved.endMonth,
    granularity: template.granularity as Granularity,
    varianceDisplay: template.varianceDisplay,
  };

  return (
    <div className={pageBreakBefore ? "stmt-page-break" : undefined}>
      {showIS && (
        <StatementCard
          {...sharedProps}
          statementTitle={`${titlePrefix}Income Statement`}
          statementData={incomeStatement}
          periods={data.periods}
          showBudget={template.includeBudget}
          showYoY={template.includeYoY}
          compareTotalOnly={!!template.compareTotalOnly}
        />
      )}
      {showBS && (
        <StatementCard
          {...sharedProps}
          statementTitle={`${titlePrefix}Balance Sheet`}
          statementData={data.balanceSheet}
          periods={data.periods}
          showBudget={template.includeBudget}
          showYoY={template.includeYoY}
          compareTotalOnly={!!template.compareTotalOnly}
          pageBreak
        />
      )}
      {showCF && (
        <StatementCard
          {...sharedProps}
          statementTitle={`${titlePrefix}Statement of Cash Flows`}
          statementData={data.cashFlowStatement}
          periods={data.periods}
          showBudget={false}
          showYoY={template.includeYoY}
          compareTotalOnly={!!template.compareTotalOnly}
          pageBreak
        />
      )}
      {showProForma && data.proFormaAdjustments && (
        <div className="stmt-page-break">
          <ProFormaDetailSchedule
            companyName={companyName}
            startYear={resolved.startYear}
            startMonth={resolved.startMonth}
            endYear={resolved.endYear}
            endMonth={resolved.endMonth}
            granularity={template.granularity as Granularity}
            adjustments={data.proFormaAdjustments}
            printMode
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section: entity-breakdown / re-breakdown
// Renders both IS and BS using the same EntityBreakdownTable component used
// on the on-screen tabs.
// ---------------------------------------------------------------------------

function BreakdownSection({
  template,
  resolved,
  apiPath,
  titleSuffix,
  onReady,
  pageBreakBefore,
}: {
  template: FinancialModelTemplate;
  resolved: { startYear: number; startMonth: number; endYear: number; endMonth: number };
  apiPath: string;
  titleSuffix: string;
  onReady: () => void;
  pageBreakBefore: boolean;
}) {
  const [data, setData] = useState<EntityBreakdownResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    const url = new URL(window.location.href);
    const orgId = url.searchParams.get("organizationId");
    if (orgId) params.set("organizationId", orgId);
    if (template.scope === "reporting_entity" && template.reportingEntityId) {
      params.set("reportingEntityId", template.reportingEntityId);
    }
    if (template.chartId) params.set("chartId", template.chartId);
    params.set("startYear", String(resolved.startYear));
    params.set("startMonth", String(resolved.startMonth));
    params.set("endYear", String(resolved.endYear));
    params.set("endMonth", String(resolved.endMonth));
    params.set("granularity", template.granularity);
    params.set("includeProForma", String(template.includeProForma));
    params.set("includeAllocations", String(template.includeAllocations));

    fetch(`${apiPath}?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error ?? `Fetch failed (${r.status})`);
        }
        return r.json();
      })
      .then((body: EntityBreakdownResponse) => {
        setData(body);
        onReady();
      })
      .catch((e: Error) => {
        setError(e.message);
        onReady();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <PrintWrapper pageBreak={pageBreakBefore}>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm font-semibold">{template.name}</p>
            <p className="text-sm text-destructive mt-2">{error}</p>
          </CardContent>
        </Card>
      </PrintWrapper>
    );
  }

  if (!data) {
    return (
      <PrintWrapper pageBreak={pageBreakBefore}>
        <div className="p-8 text-sm text-muted-foreground">
          Loading {template.name}…
        </div>
      </PrintWrapper>
    );
  }

  const companyName = data.metadata.organizationName ?? "";
  const incomeStatement = template.ebitdaOnly
    ? filterForEbitdaOnly(data.incomeStatement)
    : data.incomeStatement;

  return (
    <div className={pageBreakBefore ? "stmt-page-break" : undefined}>
      <div className="stmt-single-page">
        <Card>
          <CardContent className="pt-2 pb-6 px-4">
            <StatementHeader
              companyName={companyName}
              statementTitle={`Income Statement — ${titleSuffix}`}
              startYear={resolved.startYear}
              startMonth={resolved.startMonth}
              endYear={resolved.endYear}
              endMonth={resolved.endMonth}
              granularity={template.granularity as Granularity}
            />
            <EntityBreakdownTable
              data={incomeStatement}
              columns={data.columns}
              showPctOfTotal={false}
            />
          </CardContent>
        </Card>
      </div>

      {!template.ebitdaOnly && (
        <div className="stmt-page-break stmt-single-page">
          <Card>
            <CardContent className="pt-2 pb-6 px-4">
              <StatementHeader
                companyName={companyName}
                statementTitle={`Balance Sheet — ${titleSuffix}`}
                startYear={resolved.startYear}
                startMonth={resolved.startMonth}
                endYear={resolved.endYear}
                endMonth={resolved.endMonth}
                granularity={template.granularity as Granularity}
              />
              <EntityBreakdownTable
                data={data.balanceSheet}
                columns={data.columns}
                showPctOfTotal={false}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
