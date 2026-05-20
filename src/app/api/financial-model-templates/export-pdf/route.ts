import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  resolveTemplatePeriod,
  type DynamicPreset,
  DYNAMIC_PRESET_LABELS,
} from "@/lib/financial-model-templates/period-resolver";
import type {
  StatementData,
  Period,
  LineItem,
  ProFormaAdjustmentDetail,
  Granularity,
} from "@/components/financial-statements/types";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

function fmtAmount(amount: number | null | undefined, showDollar = false): string {
  if (amount === null || amount === undefined) return "";
  if (amount === 0) return showDollar ? "$—" : "—";
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs);
  const prefix = showDollar ? "$" : "";
  return amount < 0 ? `${prefix}(${formatted})` : `${prefix}${formatted}`;
}

function fmtPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value === 0) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Internal API helpers
// ---------------------------------------------------------------------------

interface FetchedStatements {
  periods: Period[];
  incomeStatement: StatementData;
  balanceSheet: StatementData;
  cashFlowStatement: StatementData;
  proFormaAdjustments?: ProFormaAdjustmentDetail[];
  metadata: {
    entityName?: string;
    organizationName?: string;
    reportingEntityName?: string;
    granularity: Granularity;
    startPeriod: string;
    endPeriod: string;
    generatedAt: string;
  };
}

interface FetchedBreakdown {
  columns: Array<{ key: string; label: string; fullName: string }>;
  incomeStatement: StatementData;
  balanceSheet: StatementData;
  metadata: {
    organizationName?: string;
    reportingEntityName?: string;
    generatedAt: string;
    startPeriod: string;
    endPeriod: string;
  };
}

async function fetchInternalJson<T>(
  request: Request,
  path: string,
  params: URLSearchParams
): Promise<T> {
  const baseUrl = new URL(request.url).origin;
  const res = await fetch(`${baseUrl}${path}?${params.toString()}`, {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Fetch ${path} failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function buildStatementsParams(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: any,
  resolved: { startYear: number; startMonth: number; endYear: number; endMonth: number }
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("scope", template.scope);
  params.set("startYear", String(resolved.startYear));
  params.set("startMonth", String(resolved.startMonth));
  params.set("endYear", String(resolved.endYear));
  params.set("endMonth", String(resolved.endMonth));
  params.set("granularity", template.granularity);
  params.set("includeBudget", String(!!template.include_budget));
  params.set("includeYoY", String(!!template.include_yoy));
  params.set("includeProForma", String(!!template.include_pro_forma));
  params.set("includeAllocations", String(!!template.include_allocations));
  params.set("includeTotal", String(!!template.include_total));
  if (template.scope === "entity" && template.entity_id) {
    params.set("entityId", template.entity_id);
  }
  if (template.scope !== "entity" && template.organization_id) {
    params.set("organizationId", template.organization_id);
  }
  if (template.scope === "reporting_entity" && template.reporting_entity_id) {
    params.set("reportingEntityId", template.reporting_entity_id);
  }
  if (template.chart_id) {
    params.set("chartId", template.chart_id);
  }
  return params;
}

// ---------------------------------------------------------------------------
// EBITDA filter
// ---------------------------------------------------------------------------

function filterForEbitdaOnly(statement: StatementData): StatementData {
  const sections = [];
  for (const s of statement.sections) {
    sections.push(s);
    if (
      s.id === "operating_margin_pct" ||
      s.id === "operating_income" ||
      s.id === "operating_margin"
    ) {
      break;
    }
  }
  return { ...statement, sections };
}

// ---------------------------------------------------------------------------
// Generic columnar statement → autoTable rows.
//
// Used for both period-keyed statements (IS/BS/CF) and column-keyed
// breakdowns (entity / RE breakdown). The caller supplies the column
// definitions; we just look up amounts via line.amounts[column.key].
// ---------------------------------------------------------------------------

interface ColumnDef {
  key: string;
  label: string;
}

function statementToRowsGeneric(
  statement: StatementData,
  columns: ColumnDef[],
  includeBudget: boolean,
  varianceDisplay: "dollars" | "percentage",
  periods?: Period[] // when present, enables budget/variance triplets
): {
  head: string[][];
  body: (string | { content: string; styles?: Record<string, unknown> })[][];
} {
  const columnHeaders: string[] = ["Account"];
  for (const c of columns) {
    columnHeaders.push(c.label);
    if (includeBudget && periods) {
      columnHeaders.push("Budget");
      columnHeaders.push(varianceDisplay === "percentage" ? "Var %" : "Var $");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any[] = [];

  function pushLine(line: LineItem, indent: number, emphasis: "normal" | "bold" | "grand") {
    const isPct = line.id.endsWith("_pct");
    const indentSpaces = "  ".repeat(indent);
    const labelCell = {
      content: indentSpaces + line.label,
      styles: {
        fontStyle: emphasis === "normal" ? (isPct ? "italic" : "normal") : "bold",
        textColor: emphasis === "grand" ? [31, 58, 95] : [28, 36, 48],
      },
    };
    const row: object[] = [labelCell];

    for (const c of columns) {
      const v = line.amounts?.[c.key];
      const formatted = isPct
        ? fmtPercent(v)
        : fmtAmount(v, line.showDollarSign);
      row.push({
        content: formatted,
        styles: {
          halign: "right",
          fontStyle: emphasis === "normal" ? (isPct ? "italic" : "normal") : "bold",
        },
      });
      if (includeBudget && periods) {
        const b = line.budgetAmounts?.[c.key];
        row.push({
          content: isPct ? fmtPercent(b) : fmtAmount(b),
          styles: { halign: "right" },
        });
        let variance: number | null = null;
        if (v !== undefined && v !== null && b !== undefined && b !== null) {
          if (varianceDisplay === "percentage" && !isPct && b !== 0) {
            variance = (v - b) / Math.abs(b);
          } else {
            variance = v - b;
          }
        }
        row.push({
          content: variance === null
            ? ""
            : varianceDisplay === "percentage" && !isPct
              ? fmtPercent(variance)
              : fmtAmount(variance),
          styles: { halign: "right" },
        });
      }
    }
    body.push(row);
  }

  for (const section of statement.sections) {
    if (section.title) {
      body.push([
        {
          content: section.title.toUpperCase(),
          colSpan: columnHeaders.length,
          styles: {
            fontStyle: "bold",
            fillColor: [238, 242, 247],
            textColor: [31, 58, 95],
          },
        },
      ]);
    }
    for (const line of section.lines) {
      if (line.isSeparator) continue;
      if (line.isHeader) {
        pushLine(line, 1, "bold");
      } else {
        pushLine(line, 1, "normal");
      }
    }
    if (section.subtotalLine) {
      pushLine(
        section.subtotalLine,
        0,
        section.subtotalLine.isGrandTotal ? "grand" : "bold"
      );
    }
  }

  return { head: [columnHeaders], body };
}

// ---------------------------------------------------------------------------
// PDF page primitives
// ---------------------------------------------------------------------------

interface RenderContext {
  pdf: jsPDF;
  templateName: string;
  companyName: string;
  periodDescription: string;
}

function addPageForColumns(pdf: jsPDF, columnCount: number) {
  pdf.addPage(
    "letter",
    columnCount > 6 ? "landscape" : "portrait"
  );
}

function drawPageHeader(
  ctx: RenderContext,
  statementTitle: string,
  subTitle?: string
) {
  const { pdf, templateName, companyName, periodDescription } = ctx;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(28, 36, 48);
  pdf.text(
    companyName || "Financial Statements",
    pdf.internal.pageSize.getWidth() / 2,
    36,
    { align: "center" }
  );

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(31, 58, 95);
  pdf.text(
    statementTitle.toUpperCase(),
    pdf.internal.pageSize.getWidth() / 2,
    54,
    { align: "center" }
  );

  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(9);
  pdf.setTextColor(107, 114, 128);
  pdf.text(periodDescription, pdf.internal.pageSize.getWidth() / 2, 68, {
    align: "center",
  });
  pdf.text(
    `Template: ${templateName}${subTitle ? ` · ${subTitle}` : ""} · Unaudited — For Management Use Only`,
    pdf.internal.pageSize.getWidth() / 2,
    80,
    { align: "center" }
  );
}

function footerCallback(ctx: RenderContext) {
  return (data: { settings: { margin: { left: number; right: number } } }) => {
    const { pdf, templateName, periodDescription } = ctx;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    pdf.setFontSize(7);
    pdf.setTextColor(107, 114, 128);
    pdf.setFont("helvetica", "italic");
    pdf.text(
      `${templateName} — ${periodDescription}`,
      data.settings.margin.left,
      pageH - 12
    );
    pdf.text(
      `Page ${pdf.getNumberOfPages()}`,
      pageW - data.settings.margin.right,
      pageH - 12,
      { align: "right" }
    );
  };
}

// ---------------------------------------------------------------------------
// Statement page renderers (one per tab type)
// ---------------------------------------------------------------------------

function renderStatementPage(
  ctx: RenderContext,
  statement: StatementData,
  statementTitle: string,
  periods: Period[],
  includeBudget: boolean,
  varianceDisplay: "dollars" | "percentage"
) {
  const columns: ColumnDef[] = periods.map((p) => ({
    key: p.key,
    label: p.label,
  }));
  const totalCols =
    columns.length * (includeBudget ? 3 : 1) + 1;
  addPageForColumns(ctx.pdf, totalCols);

  drawPageHeader(ctx, statementTitle);

  const { head, body } = statementToRowsGeneric(
    statement,
    columns,
    includeBudget,
    varianceDisplay,
    periods
  );

  autoTable(ctx.pdf, {
    head,
    body,
    startY: 92,
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [28, 36, 48],
      lineColor: [209, 213, 219],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [31, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
    },
    columnStyles: { 0: { cellWidth: "auto", halign: "left" } },
    didDrawPage: footerCallback(ctx),
    margin: { left: 28, right: 28, bottom: 28 },
  });
}

function renderBreakdownPage(
  ctx: RenderContext,
  statement: StatementData,
  columns: ColumnDef[],
  title: string
) {
  addPageForColumns(ctx.pdf, columns.length + 1);
  drawPageHeader(ctx, title);

  const { head, body } = statementToRowsGeneric(
    statement,
    columns,
    false,
    "dollars"
  );

  autoTable(ctx.pdf, {
    head,
    body,
    startY: 92,
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [28, 36, 48],
      lineColor: [209, 213, 219],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [31, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "center",
    },
    columnStyles: { 0: { cellWidth: "auto", halign: "left" } },
    didDrawPage: footerCallback(ctx),
    margin: { left: 28, right: 28, bottom: 28 },
  });
}

function renderProFormaSchedulePage(
  ctx: RenderContext,
  adjustments: ProFormaAdjustmentDetail[],
  periods: Period[]
) {
  ctx.pdf.addPage("letter", "landscape");
  drawPageHeader(ctx, "Pro Forma Adjustments Detail");

  const validBucketKeys = new Set(periods.map((p) => p.key));
  const visible = adjustments.filter((a) => validBucketKeys.has(a.bucketKey));

  if (visible.length === 0) {
    ctx.pdf.setFont("helvetica", "italic");
    ctx.pdf.setFontSize(10);
    ctx.pdf.setTextColor(107, 114, 128);
    ctx.pdf.text(
      "No pro forma adjustments in this period.",
      ctx.pdf.internal.pageSize.getWidth() / 2,
      120,
      { align: "center" }
    );
    return;
  }

  const head = [
    ["Entity", "Account", "Offset", "Period", "Description", "Amount"],
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any[] = visible.map((a) => [
    `${a.entityCode} — ${a.entityName}`,
    `${a.accountNumber} ${a.accountName}`,
    a.offsetAccountNumber
      ? `${a.offsetAccountNumber} ${a.offsetAccountName ?? ""}`
      : "",
    `${MONTH_ABBR[a.periodMonth - 1]} ${a.periodYear}`,
    a.description + (a.notes ? `\n${a.notes}` : ""),
    { content: fmtAmount(a.amount, true), styles: { halign: "right" } },
  ]);

  autoTable(ctx.pdf, {
    head,
    body,
    startY: 92,
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 3,
      textColor: [28, 36, 48],
      lineColor: [209, 213, 219],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [31, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    margin: { left: 28, right: 28, bottom: 28 },
    didDrawPage: footerCallback(ctx),
  });
}

interface AllocationRow {
  source_entity_code: string;
  source_entity_name: string;
  destination_entity_code: string | null;
  destination_entity_name: string | null;
  master_account_number: string | null;
  master_account_name: string | null;
  destination_master_account_number: string | null;
  destination_master_account_name: string | null;
  amount: number;
  description: string | null;
  schedule_type: string;
  period_year: number | null;
  period_month: number | null;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  is_repeating: boolean | null;
}

function formatAllocationPeriod(a: AllocationRow): string {
  if (a.schedule_type === "single_month" && a.period_year && a.period_month) {
    let base = `${MONTH_ABBR[a.period_month - 1]} ${a.period_year}`;
    if (a.is_repeating) base += " (repeating)";
    return base;
  }
  if (
    a.schedule_type === "monthly_spread" &&
    a.start_year &&
    a.start_month &&
    a.end_year &&
    a.end_month
  ) {
    return `${MONTH_ABBR[a.start_month - 1]} ${a.start_year} – ${MONTH_ABBR[a.end_month - 1]} ${a.end_year}`;
  }
  return "—";
}

function renderAllocationsPage(
  ctx: RenderContext,
  allocations: AllocationRow[]
) {
  ctx.pdf.addPage("letter", "landscape");
  drawPageHeader(ctx, "Allocations Detail");

  if (allocations.length === 0) {
    ctx.pdf.setFont("helvetica", "italic");
    ctx.pdf.setFontSize(10);
    ctx.pdf.setTextColor(107, 114, 128);
    ctx.pdf.text(
      "No allocations found.",
      ctx.pdf.internal.pageSize.getWidth() / 2,
      120,
      { align: "center" }
    );
    return;
  }

  const head = [
    ["From", "To", "Account", "Reclass to", "Period", "Description", "Amount"],
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any[] = allocations.map((a) => [
    `${a.source_entity_code ?? ""} — ${a.source_entity_name ?? ""}`,
    a.destination_entity_code
      ? `${a.destination_entity_code} — ${a.destination_entity_name ?? ""}`
      : "—",
    a.master_account_number
      ? `${a.master_account_number} ${a.master_account_name ?? ""}`
      : (a.master_account_name ?? ""),
    a.destination_master_account_number
      ? `${a.destination_master_account_number} ${a.destination_master_account_name ?? ""}`
      : "",
    formatAllocationPeriod(a),
    a.description ?? "",
    { content: fmtAmount(a.amount, true), styles: { halign: "right" } },
  ]);

  autoTable(ctx.pdf, {
    head,
    body,
    startY: 92,
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 3,
      textColor: [28, 36, 48],
      lineColor: [209, 213, 219],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: [31, 58, 95],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    margin: { left: 28, right: 28, bottom: 28 },
    didDrawPage: footerCallback(ctx),
  });
}

function renderTemplateCoverPage(
  ctx: RenderContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: any,
  resolved: { startYear: number; startMonth: number; endYear: number; endMonth: number },
  isFirstPage: boolean,
  activeTabLabel: string
) {
  const { pdf } = ctx;
  if (!isFirstPage) {
    pdf.addPage("letter", "portrait");
  }

  const pageW = pdf.internal.pageSize.getWidth();
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(22);
  pdf.setTextColor(28, 36, 48);
  pdf.text(template.name, pageW / 2, 140, { align: "center" });

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(12);
  pdf.setTextColor(107, 114, 128);
  const periodLabel = `${MONTH_ABBR[resolved.startMonth - 1]} ${resolved.startYear} – ${MONTH_ABBR[resolved.endMonth - 1]} ${resolved.endYear}`;
  pdf.text(periodLabel, pageW / 2, 168, { align: "center" });

  pdf.setFontSize(10);
  const periodMode =
    template.period_mode === "dynamic"
      ? `Dynamic: ${DYNAMIC_PRESET_LABELS[template.dynamic_preset as DynamicPreset] ?? template.dynamic_preset}`
      : "Static range";
  pdf.text(periodMode, pageW / 2, 188, { align: "center" });

  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(31, 58, 95);
  pdf.text(`View: ${activeTabLabel}`, pageW / 2, 210, { align: "center" });
}

const TAB_LABELS: Record<string, string> = {
  all: "All Statements",
  "income-statement": "Income Statement",
  "balance-sheet": "Balance Sheet",
  "cash-flow": "Cash Flow Statement",
  "pro-forma": "Pro Forma Adjustments",
  allocations: "Allocations",
  "entity-breakdown": "Entity Breakdown",
  "re-breakdown": "Reporting Entity Breakdown",
  bridge: "Bridge",
};

// ---------------------------------------------------------------------------
// Per-template renderer — dispatches on active_tab
// ---------------------------------------------------------------------------

async function renderTemplate(
  request: Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: any,
  resolved: { startYear: number; startMonth: number; endYear: number; endMonth: number },
  pdf: jsPDF,
  isFirstPage: boolean
): Promise<void> {
  const activeTab: string = template.active_tab ?? "all";
  const activeTabLabel = TAB_LABELS[activeTab] ?? activeTab;

  const titlePrefix =
    template.scope === "organization" ? "Consolidated " : "";
  const varianceDisplay: "dollars" | "percentage" =
    template.variance_display === "percentage" ? "percentage" : "dollars";

  // Statements-tab cluster (all/IS/BS/CF/pro-forma): fetch the main API once
  // and dispatch to renderers.
  const wantsStatements = new Set([
    "all",
    "income-statement",
    "balance-sheet",
    "cash-flow",
    "pro-forma",
  ]).has(activeTab);

  // For "all" we fall back to the template's per-statement flags; for any
  // specific statement tab the flag is implied by the tab itself.
  const renderIS =
    activeTab === "all"
      ? !!template.include_income_statement
      : activeTab === "income-statement";
  const renderBS =
    activeTab === "all"
      ? !!template.include_balance_sheet
      : activeTab === "balance-sheet";
  const renderCF =
    activeTab === "all"
      ? !!template.include_cash_flow
      : activeTab === "cash-flow";
  const renderProForma =
    activeTab === "pro-forma" ||
    (activeTab === "all" && !!template.include_pro_forma_schedule);

  // Resolve company name and period description for the cover (best-effort
  // before any API calls — overridden below if we fetch metadata).
  let companyName = "";
  let periodDescription = `${MONTH_ABBR[resolved.startMonth - 1]} ${resolved.startYear} – ${MONTH_ABBR[resolved.endMonth - 1]} ${resolved.endYear}`;

  // ---- Statements tabs ----
  if (wantsStatements) {
    let data: FetchedStatements;
    try {
      data = await fetchInternalJson<FetchedStatements>(
        request,
        "/api/financial-statements",
        buildStatementsParams(template, resolved)
      );
    } catch (e) {
      const ctx: RenderContext = {
        pdf,
        templateName: template.name,
        companyName: "",
        periodDescription,
      };
      renderTemplateCoverPage(ctx, template, resolved, isFirstPage, activeTabLabel);
      pdf.setFontSize(11);
      pdf.setTextColor(180, 28, 28);
      pdf.text(
        `Failed to load: ${(e as Error).message}`,
        pdf.internal.pageSize.getWidth() / 2,
        250,
        { align: "center" }
      );
      return;
    }

    companyName =
      data.metadata.reportingEntityName ??
      data.metadata.entityName ??
      data.metadata.organizationName ??
      "";

    const ctx: RenderContext = {
      pdf,
      templateName: template.name,
      companyName,
      periodDescription,
    };

    renderTemplateCoverPage(ctx, template, resolved, isFirstPage, activeTabLabel);

    const incomeStatement = template.ebitda_only
      ? filterForEbitdaOnly(data.incomeStatement)
      : data.incomeStatement;

    if (renderIS) {
      renderStatementPage(
        ctx,
        incomeStatement,
        `${titlePrefix}Statement of Operations`,
        data.periods,
        !!template.include_budget,
        varianceDisplay
      );
    }
    if (renderBS) {
      renderStatementPage(
        ctx,
        data.balanceSheet,
        `${titlePrefix}Balance Sheet`,
        data.periods,
        false,
        varianceDisplay
      );
    }
    if (renderCF) {
      renderStatementPage(
        ctx,
        data.cashFlowStatement,
        `${titlePrefix}Statement of Cash Flows`,
        data.periods,
        false,
        varianceDisplay
      );
    }
    if (renderProForma && data.proFormaAdjustments) {
      renderProFormaSchedulePage(ctx, data.proFormaAdjustments, data.periods);
    }
    return;
  }

  // ---- Entity Breakdown ----
  if (activeTab === "entity-breakdown") {
    const params = new URLSearchParams();
    params.set("organizationId", template.organization_id);
    if (template.scope === "reporting_entity" && template.reporting_entity_id) {
      params.set("reportingEntityId", template.reporting_entity_id);
    }
    if (template.chart_id) params.set("chartId", template.chart_id);
    params.set("startYear", String(resolved.startYear));
    params.set("startMonth", String(resolved.startMonth));
    params.set("endYear", String(resolved.endYear));
    params.set("endMonth", String(resolved.endMonth));
    params.set("granularity", template.granularity);
    params.set("includeProForma", String(!!template.include_pro_forma));
    params.set("includeAllocations", String(!!template.include_allocations));

    let data: FetchedBreakdown;
    try {
      data = await fetchInternalJson<FetchedBreakdown>(
        request,
        "/api/financial-statements/entity-breakdown",
        params
      );
    } catch (e) {
      const ctx: RenderContext = { pdf, templateName: template.name, companyName: "", periodDescription };
      renderTemplateCoverPage(ctx, template, resolved, isFirstPage, activeTabLabel);
      pdf.setTextColor(180, 28, 28);
      pdf.text(`Failed to load: ${(e as Error).message}`, pdf.internal.pageSize.getWidth() / 2, 250, { align: "center" });
      return;
    }

    companyName = data.metadata.reportingEntityName ?? data.metadata.organizationName ?? "";
    const ctx: RenderContext = { pdf, templateName: template.name, companyName, periodDescription };
    renderTemplateCoverPage(ctx, template, resolved, isFirstPage, activeTabLabel);

    const incomeStatement = template.ebitda_only
      ? filterForEbitdaOnly(data.incomeStatement)
      : data.incomeStatement;

    const cols: ColumnDef[] = data.columns.map((c) => ({ key: c.key, label: c.label }));
    renderBreakdownPage(ctx, incomeStatement, cols, "Income Statement — Entity Breakdown");
    renderBreakdownPage(ctx, data.balanceSheet, cols, "Balance Sheet — Entity Breakdown");
    return;
  }

  // ---- Reporting Entity Breakdown ----
  if (activeTab === "re-breakdown") {
    const params = new URLSearchParams();
    params.set("organizationId", template.organization_id);
    if (template.chart_id) params.set("chartId", template.chart_id);
    params.set("startYear", String(resolved.startYear));
    params.set("startMonth", String(resolved.startMonth));
    params.set("endYear", String(resolved.endYear));
    params.set("endMonth", String(resolved.endMonth));
    params.set("granularity", template.granularity);
    params.set("includeProForma", String(!!template.include_pro_forma));
    params.set("includeAllocations", String(!!template.include_allocations));

    let data: FetchedBreakdown;
    try {
      data = await fetchInternalJson<FetchedBreakdown>(
        request,
        "/api/financial-statements/reporting-entity-breakdown",
        params
      );
    } catch (e) {
      const ctx: RenderContext = { pdf, templateName: template.name, companyName: "", periodDescription };
      renderTemplateCoverPage(ctx, template, resolved, isFirstPage, activeTabLabel);
      pdf.setTextColor(180, 28, 28);
      pdf.text(`Failed to load: ${(e as Error).message}`, pdf.internal.pageSize.getWidth() / 2, 250, { align: "center" });
      return;
    }

    companyName = data.metadata.organizationName ?? "";
    const ctx: RenderContext = { pdf, templateName: template.name, companyName, periodDescription };
    renderTemplateCoverPage(ctx, template, resolved, isFirstPage, activeTabLabel);

    const incomeStatement = template.ebitda_only
      ? filterForEbitdaOnly(data.incomeStatement)
      : data.incomeStatement;

    const cols: ColumnDef[] = data.columns.map((c) => ({ key: c.key, label: c.label }));
    renderBreakdownPage(ctx, incomeStatement, cols, "Income Statement — Reporting Entity Breakdown");
    renderBreakdownPage(ctx, data.balanceSheet, cols, "Balance Sheet — Reporting Entity Breakdown");
    return;
  }

  // ---- Allocations (read directly from DB; the tab does not have a single API) ----
  if (activeTab === "allocations") {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (admin as any)
      .from("allocation_adjustments")
      .select(
        `*,
        source:entities!allocation_adjustments_source_entity_id_fkey(name, code),
        destination:entities!allocation_adjustments_destination_entity_id_fkey(name, code),
        master_accounts!allocation_adjustments_master_account_id_fkey!inner(name, account_number),
        dest_master:master_accounts!allocation_adjustments_destination_master_account_id_fkey(name, account_number)`
      )
      .eq("organization_id", template.organization_id)
      .order("created_at", { ascending: false });

    if (template.scope === "entity" && template.entity_id) {
      q = q.or(
        `source_entity_id.eq.${template.entity_id},destination_entity_id.eq.${template.entity_id}`
      );
    }

    const { data: rows } = await q;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allocations: AllocationRow[] = (rows ?? []).map((r: any) => ({
      source_entity_code: r.source?.code ?? "",
      source_entity_name: r.source?.name ?? "",
      destination_entity_code: r.destination?.code ?? null,
      destination_entity_name: r.destination?.name ?? null,
      master_account_number: r.master_accounts?.account_number ?? null,
      master_account_name: r.master_accounts?.name ?? null,
      destination_master_account_number: r.dest_master?.account_number ?? null,
      destination_master_account_name: r.dest_master?.name ?? null,
      amount: Number(r.amount ?? 0),
      description: r.description ?? null,
      schedule_type: r.schedule_type,
      period_year: r.period_year,
      period_month: r.period_month,
      start_year: r.start_year,
      start_month: r.start_month,
      end_year: r.end_year,
      end_month: r.end_month,
      is_repeating: r.is_repeating,
    }));

    // Resolve org/entity name for header
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", template.organization_id)
      .single();
    companyName = org?.name ?? "";

    const ctx: RenderContext = { pdf, templateName: template.name, companyName, periodDescription };
    renderTemplateCoverPage(ctx, template, resolved, isFirstPage, activeTabLabel);
    renderAllocationsPage(ctx, allocations);
    return;
  }

  // ---- Bridge (placeholder — complex view; not yet supported in PDF) ----
  if (activeTab === "bridge") {
    const ctx: RenderContext = { pdf, templateName: template.name, companyName: "", periodDescription };
    renderTemplateCoverPage(ctx, template, resolved, isFirstPage, activeTabLabel);
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(10);
    pdf.setTextColor(107, 114, 128);
    pdf.text(
      "Bridge view is not yet supported in PDF export — open the tab in the app.",
      pdf.internal.pageSize.getWidth() / 2,
      250,
      { align: "center" }
    );
    return;
  }

  // ---- Fallback ----
  const ctx: RenderContext = { pdf, templateName: template.name, companyName: "", periodDescription };
  renderTemplateCoverPage(ctx, template, resolved, isFirstPage, activeTabLabel);
}

// ---------------------------------------------------------------------------
// GET — render PDF
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const organizationId = searchParams.get("organizationId");
    const filter = searchParams.get("filter") ?? "all"; // "all" | "favorites"
    const templateIdsParam = searchParams.get("templateIds");

    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId is required" },
        { status: 400 }
      );
    }

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .single();
    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (admin as any)
      .from("financial_model_templates")
      .select("*")
      .eq("organization_id", organizationId);

    if (filter === "favorites") {
      query = query.eq("is_favorite", true);
    }
    if (templateIdsParam) {
      const ids = templateIdsParam.split(",").filter(Boolean);
      if (ids.length > 0) query = query.in("id", ids);
    }

    query = query
      .order("is_favorite", { ascending: false })
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });

    const { data: templates, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!templates || templates.length === 0) {
      return NextResponse.json(
        { error: "No templates to export" },
        { status: 400 }
      );
    }

    const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });

    let isFirstPage = true;
    const today = new Date();

    for (const template of templates) {
      const resolved = resolveTemplatePeriod(
        {
          periodMode: template.period_mode,
          staticRange:
            template.start_year && template.start_month && template.end_year && template.end_month
              ? {
                  startYear: template.start_year,
                  startMonth: template.start_month,
                  endYear: template.end_year,
                  endMonth: template.end_month,
                }
              : null,
          dynamicPreset: template.dynamic_preset,
        },
        today
      );

      if (!resolved) continue;

      await renderTemplate(request, template, resolved, pdf, isFirstPage);
      isFirstPage = false;
    }

    const buf = pdf.output("arraybuffer");
    const filename = `financial-model-templates_${today.toISOString().slice(0, 10)}.pdf`;
    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
