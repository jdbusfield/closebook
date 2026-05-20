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
// Number formatting — parens for negatives, em dash for zero
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
// Fetch internal financial-statements API on behalf of the request user
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

async function fetchStatementsForTemplate(
  request: Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: any,
  resolved: { startYear: number; startMonth: number; endYear: number; endMonth: number }
): Promise<FetchedStatements> {
  const baseUrl = new URL(request.url).origin;
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

  const res = await fetch(
    `${baseUrl}/api/financial-statements?${params.toString()}`,
    { headers: { cookie: request.headers.get("cookie") ?? "" } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Statements fetch failed (${res.status})`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// EBITDA filter (mirrors filterForEbitdaOnly from format-utils)
// ---------------------------------------------------------------------------

function filterForEbitdaOnly(statement: StatementData): StatementData {
  // Drop everything after the operating_income computed line. This matches
  // the on-screen toggle's behavior without importing the client-only helper.
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
// PDF rendering: one statement per page
// ---------------------------------------------------------------------------

interface RenderContext {
  pdf: jsPDF;
  templateName: string;
  companyName: string;
  periodDescription: string;
}

function statementToRows(
  statement: StatementData,
  periods: Period[],
  includeBudget: boolean,
  varianceDisplay: "dollars" | "percentage"
): {
  head: string[][];
  body: (string | { content: string; styles?: Record<string, unknown> })[][];
} {
  const columnHeaders: string[] = ["Account"];
  for (const p of periods) {
    columnHeaders.push(p.label);
    if (includeBudget) {
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

    for (const p of periods) {
      const v = line.amounts?.[p.key];
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
      if (includeBudget) {
        const b = line.budgetAmounts?.[p.key];
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sectionRow: any[] = [
        {
          content: section.title.toUpperCase(),
          colSpan: columnHeaders.length,
          styles: {
            fontStyle: "bold",
            fillColor: [238, 242, 247],
            textColor: [31, 58, 95],
          },
        },
      ];
      body.push(sectionRow);
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

function renderStatementPage(
  ctx: RenderContext,
  statement: StatementData,
  statementTitle: string,
  periods: Period[],
  includeBudget: boolean,
  varianceDisplay: "dollars" | "percentage",
  isFirstPage: boolean
) {
  const { pdf, templateName, companyName, periodDescription } = ctx;

  if (!isFirstPage) {
    const colCount = periods.length * (includeBudget ? 3 : 1) + 1;
    pdf.addPage(colCount > 6 ? "letter" : "letter", colCount > 6 ? "landscape" : "portrait");
  }

  // Header
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(28, 36, 48);
  pdf.text(companyName || "Financial Statements", pdf.internal.pageSize.getWidth() / 2, 36, {
    align: "center",
  });

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(31, 58, 95);
  pdf.text(statementTitle.toUpperCase(), pdf.internal.pageSize.getWidth() / 2, 54, {
    align: "center",
  });

  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(9);
  pdf.setTextColor(107, 114, 128);
  pdf.text(periodDescription, pdf.internal.pageSize.getWidth() / 2, 68, {
    align: "center",
  });
  pdf.text(
    `Template: ${templateName} · Unaudited — For Management Use Only`,
    pdf.internal.pageSize.getWidth() / 2,
    80,
    { align: "center" }
  );

  const { head, body } = statementToRows(
    statement,
    periods,
    includeBudget,
    varianceDisplay
  );

  autoTable(pdf, {
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
    columnStyles: {
      0: { cellWidth: "auto", halign: "left" },
    },
    didDrawPage: (data) => {
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
    },
    margin: { left: 28, right: 28, bottom: 28 },
  });
}

function renderProFormaSchedulePage(
  ctx: RenderContext,
  adjustments: ProFormaAdjustmentDetail[],
  periods: Period[]
) {
  const { pdf, templateName, companyName, periodDescription } = ctx;
  pdf.addPage("letter", "landscape");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(28, 36, 48);
  pdf.text(companyName || "Pro Forma Adjustments", pdf.internal.pageSize.getWidth() / 2, 36, {
    align: "center",
  });

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(31, 58, 95);
  pdf.text("PRO FORMA ADJUSTMENTS DETAIL", pdf.internal.pageSize.getWidth() / 2, 54, {
    align: "center",
  });

  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(9);
  pdf.setTextColor(107, 114, 128);
  pdf.text(periodDescription, pdf.internal.pageSize.getWidth() / 2, 68, {
    align: "center",
  });
  pdf.text(
    `Template: ${templateName}`,
    pdf.internal.pageSize.getWidth() / 2,
    80,
    { align: "center" }
  );

  // Filter to adjustments inside the report period range
  const validBucketKeys = new Set(periods.map((p) => p.key));
  const visible = adjustments.filter((a) => validBucketKeys.has(a.bucketKey));

  if (visible.length === 0) {
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(10);
    pdf.setTextColor(107, 114, 128);
    pdf.text(
      "No pro forma adjustments in this period.",
      pdf.internal.pageSize.getWidth() / 2,
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

  autoTable(pdf, {
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
    didDrawPage: (data) => {
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
    },
  });
}

function renderTemplateCoverPage(
  ctx: RenderContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: any,
  resolved: { startYear: number; startMonth: number; endYear: number; endMonth: number },
  isFirstPage: boolean
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

  const statementsList: string[] = [];
  if (template.include_income_statement) statementsList.push("Income Statement");
  if (template.include_balance_sheet) statementsList.push("Balance Sheet");
  if (template.include_cash_flow) statementsList.push("Cash Flow Statement");
  if (template.include_pro_forma_schedule) statementsList.push("Pro Forma Adjustments");
  pdf.text(
    "Includes: " + (statementsList.join(", ") || "(no statements selected)"),
    pageW / 2,
    210,
    { align: "center" }
  );
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

      if (!resolved) {
        // Skip templates with no resolvable period rather than failing the
        // entire export.
        continue;
      }

      let data: FetchedStatements;
      try {
        data = await fetchStatementsForTemplate(request, template, resolved);
      } catch (e) {
        // Render a placeholder page that says the fetch failed but keep going
        renderTemplateCoverPage({
          pdf,
          templateName: template.name,
          companyName: "",
          periodDescription:
            `${MONTH_ABBR[resolved.startMonth - 1]} ${resolved.startYear} – ${MONTH_ABBR[resolved.endMonth - 1]} ${resolved.endYear}`,
        }, template, resolved, isFirstPage);
        isFirstPage = false;
        pdf.setFontSize(11);
        pdf.setTextColor(180, 28, 28);
        pdf.text(
          `Failed to load: ${(e as Error).message}`,
          pdf.internal.pageSize.getWidth() / 2,
          250,
          { align: "center" }
        );
        continue;
      }

      const periodDescription = `${MONTH_ABBR[resolved.startMonth - 1]} ${resolved.startYear} – ${MONTH_ABBR[resolved.endMonth - 1]} ${resolved.endYear}`;
      const companyName =
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

      renderTemplateCoverPage(ctx, template, resolved, isFirstPage);
      isFirstPage = false;

      const incomeStatement = template.ebitda_only
        ? filterForEbitdaOnly(data.incomeStatement)
        : data.incomeStatement;

      const varianceDisplay: "dollars" | "percentage" =
        template.variance_display === "percentage" ? "percentage" : "dollars";

      if (template.include_income_statement) {
        renderStatementPage(
          ctx,
          incomeStatement,
          template.scope === "organization" ? "Consolidated Statement of Operations" : "Statement of Operations",
          data.periods,
          !!template.include_budget,
          varianceDisplay,
          false
        );
      }

      if (template.include_balance_sheet) {
        renderStatementPage(
          ctx,
          data.balanceSheet,
          template.scope === "organization" ? "Consolidated Balance Sheet" : "Balance Sheet",
          data.periods,
          false,
          varianceDisplay,
          false
        );
      }

      if (template.include_cash_flow) {
        renderStatementPage(
          ctx,
          data.cashFlowStatement,
          template.scope === "organization" ? "Consolidated Statement of Cash Flows" : "Statement of Cash Flows",
          data.periods,
          false,
          varianceDisplay,
          false
        );
      }

      if (template.include_pro_forma_schedule && data.proFormaAdjustments) {
        renderProFormaSchedulePage(ctx, data.proFormaAdjustments, data.periods);
      }
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
