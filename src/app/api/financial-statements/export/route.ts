import { NextResponse } from "next/server";
import ExcelJS, { type Worksheet, type Fill, type Borders } from "exceljs";
import type {
  StatementData,
  StatementTab,
  Period,
  LineItem,
  Granularity,
} from "@/components/financial-statements/types";
import { getStatementPeriodDescription } from "@/components/financial-statements/format-utils";

// ---------------------------------------------------------------------------
// Big Four auditor-grade income statement / balance sheet / cash flow export.
//
// Design conventions modeled on 10-K and PCAOB-style financial statements:
//   - Accounting number format: parenthesized negatives, em dash for zero
//   - Dollar sign on first line of section and on grand totals only
//   - Single-underline subtotals, double-underline grand totals
//   - Navy section headers, subtle zebra-free body (audit convention)
//   - Right-aligned numerics; centered period columns with bottom rule
//   - Freeze first column + header block
//   - Print setup: fit to 1 page wide, landscape/portrait per column count
//   - Footer with "Unaudited — For Management Use Only" + page numbers
// ---------------------------------------------------------------------------

// Accounting-style number formats. Excel's built-in accounting format but
// with em dash for zero (matches screen rendering) and configurable prefix.
const NUMFMT_CURRENCY =
  '_("$"* #,##0_);[Red]_("$"* (#,##0);_("$"* "—"??_);_(@_)';
const NUMFMT_NUMBER =
  '_(* #,##0_);[Red]_(* (#,##0);_(* "—"??_);_(@_)';
const NUMFMT_PERCENT = '0.0%;[Red](0.0%);"—"';
const NUMFMT_PERCENT_POINTS = '+0.0"pp";[Red]−0.0"pp";"—"';

// Muted, print-friendly palette.
const COLOR_NAVY = "FF1F3A5F";
const COLOR_BODY = "FF1C2430";
const COLOR_GRID = "FFD1D5DB";
const COLOR_MUTED = "FF6B7280";
const COLOR_SECTION_FILL = "FFEEF2F7";
const COLOR_TITLE_RULE = "FF1F3A5F";

const FONT_BODY = "Calibri";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BuildSheetOptions {
  sheetName: string;
  entityName: string;
  statementTitle: string;
  periodDescription: string;
  periods: Period[];
  statement: StatementData;
  includeBudget: boolean;
  includeYoY: boolean;
  varianceDisplay: "dollars" | "percentage";
  pageFooter: string;
}

// A single output column in the grid (first col is the label).
interface ColumnSpec {
  /** Header text (e.g. "Dec 2025", "Budget", "Var $") */
  header: string;
  /** Accessor returning raw numeric value (or null if N/A) for a line */
  value: (line: LineItem) => number | null | undefined;
  /** Number format to apply to this column's cells */
  format: (line: LineItem) => string;
  /** Width in Excel units */
  width: number;
  /** "total" col = bolder left border */
  isTotalColumn?: boolean;
  /** Variance/YoY columns get muted header color */
  muted?: boolean;
}

// ---------------------------------------------------------------------------
// Column plan
// ---------------------------------------------------------------------------

function buildColumns(opts: {
  periods: Period[];
  includeBudget: boolean;
  includeYoY: boolean;
  varianceDisplay: "dollars" | "percentage";
}): ColumnSpec[] {
  const { periods, includeBudget, includeYoY, varianceDisplay } = opts;
  const columns: ColumnSpec[] = [];
  const lastNonTotal = [...periods].reverse().find((p) => !p.isTotal);
  const lastNonTotalKey = lastNonTotal?.key ?? "";

  for (const p of periods) {
    columns.push({
      header: p.label,
      value: (line) => pickAmount(line.amounts[p.key]),
      format: (line) => formatForLine(line),
      width: 15,
      isTotalColumn: !!p.isTotal,
    });

    if (includeBudget) {
      columns.push({
        header: "Budget",
        value: (line) => pickAmount(line.budgetAmounts?.[p.key]),
        format: (line) => formatForLine(line),
        width: 14,
        muted: true,
      });
      columns.push({
        header: varianceDisplay === "percentage" ? "Var %" : "Var $",
        value: (line) => {
          const actual = line.amounts[p.key];
          const budget = line.budgetAmounts?.[p.key];
          if (actual == null || budget == null) return null;
          if (line.id.endsWith("_pct")) {
            return actual - budget; // pct points (stored as fraction)
          }
          if (varianceDisplay === "percentage") {
            if (budget === 0) return null;
            return (actual - budget) / Math.abs(budget);
          }
          return actual - budget;
        },
        format: (line) => {
          if (line.id.endsWith("_pct")) return NUMFMT_PERCENT_POINTS;
          return varianceDisplay === "percentage" ? NUMFMT_PERCENT : NUMFMT_NUMBER;
        },
        width: 13,
        muted: true,
      });
    }
  }

  if (includeYoY) {
    columns.push({
      header: "Prior Year",
      value: (line) => pickAmount(line.priorYearAmounts?.[lastNonTotalKey]),
      format: (line) => formatForLine(line),
      width: 14,
      muted: true,
    });
    columns.push({
      header: varianceDisplay === "percentage" ? "YoY %" : "YoY Change",
      value: (line) => {
        const cur = line.amounts[lastNonTotalKey];
        const py = line.priorYearAmounts?.[lastNonTotalKey];
        if (cur == null || py == null) return null;
        if (line.id.endsWith("_pct")) return cur - py;
        if (varianceDisplay === "percentage") {
          if (py === 0) return null;
          return (cur - py) / Math.abs(py);
        }
        return cur - py;
      },
      format: (line) => {
        if (line.id.endsWith("_pct")) return NUMFMT_PERCENT_POINTS;
        return varianceDisplay === "percentage" ? NUMFMT_PERCENT : NUMFMT_NUMBER;
      },
      width: 13,
      muted: true,
    });
  }

  return columns;
}

// Percentage rows store values as fractions (0.25 = 25%); Excel's percent
// format renders them correctly without scaling. Dollar rows pass through
// unchanged.
function pickAmount(raw: number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  return raw;
}

function formatForLine(line: LineItem): string {
  if (line.id.endsWith("_pct")) return NUMFMT_PERCENT;
  if (line.showDollarSign) return NUMFMT_CURRENCY;
  return NUMFMT_NUMBER;
}

// ---------------------------------------------------------------------------
// Styling primitives
// ---------------------------------------------------------------------------

const FILL_SECTION: Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: COLOR_SECTION_FILL },
};

function thinRule(color = COLOR_TITLE_RULE): Partial<Borders> {
  return {
    top: { style: "thin", color: { argb: color } },
  };
}

function doubleBottom(color = COLOR_TITLE_RULE): Partial<Borders> {
  return {
    top: { style: "thin", color: { argb: color } },
    bottom: { style: "double", color: { argb: color } },
  };
}

// ---------------------------------------------------------------------------
// Sheet builder
// ---------------------------------------------------------------------------

function addStatementSheet(wb: ExcelJS.Workbook, opts: BuildSheetOptions): Worksheet {
  const {
    sheetName,
    entityName,
    statementTitle,
    periodDescription,
    periods,
    statement,
    includeBudget,
    includeYoY,
    varianceDisplay,
    pageFooter,
  } = opts;

  const columns = buildColumns({ periods, includeBudget, includeYoY, varianceDisplay });
  const totalCols = 1 + columns.length; // +1 for the label column
  const labelWidth = 52;
  const numericColCount = totalCols - 1;

  const ws = wb.addWorksheet(sheetName, {
    views: [{ showGridLines: false }],
    properties: { defaultRowHeight: 15 },
    pageSetup: {
      orientation: numericColCount > 6 ? "landscape" : "portrait",
      // paperSize defaults to Letter (1) in Excel, which is what we want.
      // ExcelJS's typed PaperSize enum omits Letter, so we don't set it here.
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.5,
        right: 0.5,
        top: 0.75,
        bottom: 0.75,
        header: 0.3,
        footer: 0.3,
      },
      horizontalCentered: true,
    },
    headerFooter: {
      oddFooter: `&L&"${FONT_BODY}"&8&I${pageFooter}&R&"${FONT_BODY}"&8Page &P of &N`,
      evenFooter: `&L&"${FONT_BODY}"&8&I${pageFooter}&R&"${FONT_BODY}"&8Page &P of &N`,
    },
  });

  // Column widths
  ws.columns = [
    { width: labelWidth },
    ...columns.map((c) => ({ width: c.width })),
  ];

  // -----------------------------------------------------------------------
  // Title block (rows 1..N)
  // -----------------------------------------------------------------------
  let row = 1;

  // Entity name — large, bold, centered across all columns
  if (entityName) {
    ws.mergeCells(row, 1, row, totalCols);
    const cell = ws.getCell(row, 1);
    cell.value = entityName;
    cell.font = { name: FONT_BODY, size: 16, bold: true, color: { argb: COLOR_BODY } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    ws.getRow(row).height = 24;
    row++;
  }

  // Statement title — bold uppercase, centered
  ws.mergeCells(row, 1, row, totalCols);
  {
    const cell = ws.getCell(row, 1);
    cell.value = statementTitle.toUpperCase();
    cell.font = { name: FONT_BODY, size: 12, bold: true, color: { argb: COLOR_NAVY } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    ws.getRow(row).height = 19;
  }
  row++;

  // Period description — italic, muted, centered
  ws.mergeCells(row, 1, row, totalCols);
  {
    const cell = ws.getCell(row, 1);
    cell.value = periodDescription;
    cell.font = { name: FONT_BODY, size: 10, italic: true, color: { argb: COLOR_MUTED } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  row++;

  // Unaudited notation — small italic muted
  ws.mergeCells(row, 1, row, totalCols);
  {
    const cell = ws.getCell(row, 1);
    cell.value = "(Unaudited — For Management Use Only)";
    cell.font = { name: FONT_BODY, size: 9, italic: true, color: { argb: COLOR_MUTED } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  row++;

  // "In U.S. Dollars" notation
  ws.mergeCells(row, 1, row, totalCols);
  {
    const cell = ws.getCell(row, 1);
    cell.value = "(Expressed in U.S. Dollars)";
    cell.font = { name: FONT_BODY, size: 9, italic: true, color: { argb: COLOR_MUTED } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  row++;

  // Spacer
  row++;

  // -----------------------------------------------------------------------
  // Column header rows (sub-header for period grouping when budget enabled,
  // then main header row with period/budget/variance labels)
  // -----------------------------------------------------------------------

  // If budget is enabled, add a row above with merged period labels so the
  // reader can see which "Budget" / "Var" column belongs to which period.
  if (includeBudget && periods.length > 0) {
    const groupRowIdx = row;
    const groupRow = ws.getRow(groupRowIdx);
    groupRow.height = 18;

    // Label column stays blank in the group row
    const labelCell = ws.getCell(groupRowIdx, 1);
    labelCell.value = "";

    let colIdx = 2; // 1-indexed, skipping the label column
    for (const p of periods) {
      const startCol = colIdx;
      const endCol = colIdx + 2; // actual + budget + variance = 3 cols
      ws.mergeCells(groupRowIdx, startCol, groupRowIdx, endCol);
      const cell = ws.getCell(groupRowIdx, startCol);
      cell.value = p.label;
      cell.font = { name: FONT_BODY, size: 10, bold: true, color: { argb: COLOR_NAVY } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        bottom: { style: "thin", color: { argb: COLOR_NAVY } },
      };
      colIdx = endCol + 1;
    }

    // YoY columns in the group row: merge the two YoY cols under "YoY Comparison"
    if (includeYoY) {
      const startCol = colIdx;
      const endCol = colIdx + 1;
      ws.mergeCells(groupRowIdx, startCol, groupRowIdx, endCol);
      const cell = ws.getCell(groupRowIdx, startCol);
      cell.value = "YoY Comparison";
      cell.font = { name: FONT_BODY, size: 10, bold: true, italic: true, color: { argb: COLOR_MUTED } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        bottom: { style: "thin", color: { argb: COLOR_MUTED } },
      };
    }

    row++;
  }

  // Main column header row — holds per-column labels
  const headerRowIdx = row;
  const headerRow = ws.getRow(headerRowIdx);
  headerRow.height = 22;

  // Label column header
  {
    const cell = ws.getCell(headerRowIdx, 1);
    cell.value = "";
    cell.border = {
      bottom: { style: "medium", color: { argb: COLOR_NAVY } },
    };
  }

  columns.forEach((col, idx) => {
    const cellCol = idx + 2;
    const cell = ws.getCell(headerRowIdx, cellCol);
    cell.value = col.header;
    cell.font = {
      name: FONT_BODY,
      size: 10,
      bold: true,
      color: { argb: col.muted ? COLOR_MUTED : COLOR_NAVY },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = {
      top: col.isTotalColumn
        ? { style: "thin", color: { argb: COLOR_NAVY } }
        : undefined,
      left: col.isTotalColumn
        ? { style: "thin", color: { argb: COLOR_NAVY } }
        : undefined,
      bottom: { style: "medium", color: { argb: COLOR_NAVY } },
    };
  });

  row++;

  // Freeze first column + everything above this row
  ws.views = [
    {
      state: "frozen",
      xSplit: 1,
      ySplit: headerRowIdx,
      showGridLines: false,
    },
  ];

  // -----------------------------------------------------------------------
  // Body rows
  // -----------------------------------------------------------------------

  const writeNumericCells = (r: ExcelJS.Row, line: LineItem, style: "normal" | "total" | "grandTotal") => {
    columns.forEach((col, idx) => {
      const cellCol = idx + 2;
      const cell = r.getCell(cellCol);
      const v = col.value(line);
      if (v !== null && v !== undefined) {
        cell.value = v;
      }
      cell.numFmt = col.format(line);
      cell.font = {
        name: FONT_BODY,
        size: 10,
        bold: style !== "normal",
        italic: line.id.endsWith("_pct"),
        color: { argb: line.id.endsWith("_pct") ? COLOR_MUTED : COLOR_BODY },
      };
      cell.alignment = { vertical: "middle", horizontal: "right" };
      if (style === "total") {
        cell.border = {
          ...(cell.border ?? {}),
          top: { style: "thin", color: { argb: COLOR_NAVY } },
        };
      } else if (style === "grandTotal") {
        cell.border = {
          ...(cell.border ?? {}),
          top: { style: "thin", color: { argb: COLOR_NAVY } },
          bottom: { style: "double", color: { argb: COLOR_NAVY } },
        };
      }
      if (col.isTotalColumn) {
        cell.border = {
          ...(cell.border ?? {}),
          left: { style: "thin", color: { argb: COLOR_NAVY } },
        };
      }
    });
  };

  const writeSectionHeader = (title: string) => {
    const r = ws.getRow(row);
    r.height = 18;
    ws.mergeCells(row, 1, row, totalCols);
    const cell = ws.getCell(row, 1);
    cell.value = title.toUpperCase();
    cell.font = {
      name: FONT_BODY,
      size: 10,
      bold: true,
      color: { argb: COLOR_NAVY },
    };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 0 };
    cell.fill = FILL_SECTION;
    cell.border = {
      top: { style: "thin", color: { argb: COLOR_NAVY } },
      bottom: { style: "thin", color: { argb: COLOR_GRID } },
    };
    row++;
  };

  const writeBodyLine = (line: LineItem) => {
    if (line.isSeparator) {
      row++;
      return;
    }

    const r = ws.getRow(row);
    r.height = 15;

    const labelCell = r.getCell(1);
    labelCell.value = line.label;

    // Sub-header within a section (e.g., grouping label): italic, level 1
    if (line.isHeader) {
      labelCell.font = {
        name: FONT_BODY,
        size: 10,
        italic: true,
        bold: true,
        color: { argb: COLOR_BODY },
      };
      labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      // No numeric values in header lines
      row++;
      return;
    }

    labelCell.font = {
      name: FONT_BODY,
      size: 10,
      color: { argb: COLOR_BODY },
      italic: line.id.endsWith("_pct"),
    };
    labelCell.alignment = {
      vertical: "middle",
      horizontal: "left",
      indent: 2,
    };

    writeNumericCells(r, line, "normal");
    row++;
  };

  const writeSubtotalLine = (line: LineItem, isComputed: boolean) => {
    const r = ws.getRow(row);
    r.height = 16;

    const labelCell = r.getCell(1);
    labelCell.value = line.label;
    const isGrand = line.isGrandTotal;
    labelCell.font = {
      name: FONT_BODY,
      size: 10,
      bold: true,
      color: { argb: isGrand ? COLOR_NAVY : COLOR_BODY },
      italic: line.id.endsWith("_pct"),
    };
    labelCell.alignment = {
      vertical: "middle",
      horizontal: "left",
      indent: isComputed ? 0 : 1,
    };
    if (isGrand) {
      labelCell.border = doubleBottom(COLOR_NAVY);
    } else if (!line.id.endsWith("_pct")) {
      labelCell.border = thinRule(COLOR_NAVY);
    }

    writeNumericCells(
      r,
      line,
      isGrand ? "grandTotal" : line.id.endsWith("_pct") ? "normal" : "total"
    );
    row++;
  };

  for (const section of statement.sections) {
    const hasTitle = section.title && section.title.length > 0;
    const hasLines = section.lines.length > 0;

    // Pure computed/cross-section line (e.g., Gross Profit, Operating Income)
    if (!hasTitle && !hasLines && section.subtotalLine) {
      writeSubtotalLine(section.subtotalLine, true);
      // Extra gap after key inflection lines (e.g., operating margin)
      if (section.id === "operating_margin_pct") {
        row++;
      }
      continue;
    }

    // Headerless section with lines (below-the-line items)
    if (!hasTitle && hasLines) {
      for (const line of section.lines) {
        writeBodyLine(line);
      }
      if (section.subtotalLine) writeSubtotalLine(section.subtotalLine, true);
      row++;
      continue;
    }

    // Titled section
    if (hasTitle) writeSectionHeader(section.title);

    for (const line of section.lines) {
      writeBodyLine(line);
    }

    if (section.subtotalLine) writeSubtotalLine(section.subtotalLine, false);

    // Trailing spacer between sections
    row++;
  }

  // Balance check annotation for balance sheet / cash flow (auditor-style)
  if (statement.id === "balance_sheet") {
    const totalAssets = statement.sections.find((s) => s.id === "total_assets")
      ?.subtotalLine;
    const totalLE = statement.sections.find(
      (s) => s.id === "total_liabilities_and_equity"
    )?.subtotalLine;
    if (totalAssets && totalLE) {
      const r = ws.getRow(row);
      r.height = 14;
      const labelCell = r.getCell(1);
      labelCell.value = "Check: Assets − (Liabilities + Equity)";
      labelCell.font = {
        name: FONT_BODY,
        size: 9,
        italic: true,
        color: { argb: COLOR_MUTED },
      };
      labelCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      columns.forEach((col, idx) => {
        const cellCol = idx + 2;
        const cell = r.getCell(cellCol);
        const a = col.value(totalAssets);
        const b = col.value(totalLE);
        if (typeof a === "number" && typeof b === "number") {
          cell.value = a - b;
          cell.numFmt = NUMFMT_NUMBER;
        }
        cell.font = {
          name: FONT_BODY,
          size: 9,
          italic: true,
          color: { argb: COLOR_MUTED },
        };
        cell.alignment = { vertical: "middle", horizontal: "right" };
      });
      row++;
    }
  }

  // Apply body font color to any stray label cells (safety pass)
  for (let r = headerRowIdx + 1; r < row; r++) {
    const cell = ws.getCell(r, 1);
    if (cell.value && !cell.font) {
      cell.font = { name: FONT_BODY, size: 10, color: { argb: COLOR_BODY } };
    }
  }

  // Auto print title rows (repeat title block on each printed page)
  ws.pageSetup.printTitlesRow = `1:${headerRowIdx}`;

  return ws;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

async function fetchStatements(request: Request) {
  const { searchParams } = new URL(request.url);
  const params = new URLSearchParams();

  for (const [key, value] of searchParams.entries()) {
    params.set(key, value);
  }

  const baseUrl = new URL(request.url);
  const apiUrl = `${baseUrl.origin}/api/financial-statements?${params.toString()}`;

  const response = await fetch(apiUrl, {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error ?? "Failed to fetch financial statements");
  }

  return response.json();
}

export async function GET(request: Request) {
  try {
    const data = await fetchStatements(request);

    const {
      periods,
      incomeStatement,
      balanceSheet,
      cashFlowStatement,
      metadata,
    } = data as {
      periods: Period[];
      incomeStatement: StatementData;
      balanceSheet: StatementData;
      cashFlowStatement: StatementData;
      metadata: {
        entityName?: string;
        organizationName?: string;
        reportingEntityName?: string;
        generatedAt: string;
        granularity: Granularity;
        startPeriod: string;
        endPeriod: string;
      };
    };

    const { searchParams } = new URL(request.url);
    const statementsParam = (searchParams.get("statements") ?? "all") as StatementTab;
    const scope = searchParams.get("scope") ?? "organization";
    const includeBudget = searchParams.get("includeBudget") === "true";
    const includeYoY = searchParams.get("includeYoY") === "true";
    const startYear = parseInt(searchParams.get("startYear") ?? "2025", 10);
    const startMonth = parseInt(searchParams.get("startMonth") ?? "1", 10);
    const endYear = parseInt(searchParams.get("endYear") ?? "2025", 10);
    const endMonth = parseInt(searchParams.get("endMonth") ?? "12", 10);
    const granularity = (searchParams.get("granularity") ?? "monthly") as Granularity;

    const varianceParam = searchParams.get("varianceDisplay");
    const varianceDisplay: "dollars" | "percentage" =
      varianceParam === "percentage" ? "percentage" : "dollars";

    // Scope-aware display name: prefer the most-specific scope field.
    const entityName: string =
      metadata?.reportingEntityName ??
      metadata?.entityName ??
      metadata?.organizationName ??
      "";

    // Consolidated view prepends "Consolidated" to the statement title to
    // mirror the on-screen convention.
    const titlePrefix = scope === "organization" ? "Consolidated " : "";

    const periodDescription = getStatementPeriodDescription(
      startYear,
      startMonth,
      endYear,
      endMonth,
      granularity
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = entityName || "Accounting App";
    wb.company = entityName || "";
    wb.created = new Date();
    wb.modified = new Date();
    wb.title = `${entityName || ""} Financial Statements`.trim();

    const pageFooter = `${entityName} — Unaudited — For Management Use Only — ${periodDescription}`;

    const commonOpts = {
      entityName,
      periodDescription,
      periods,
      includeBudget,
      includeYoY,
      varianceDisplay,
      pageFooter,
    };

    if (statementsParam === "all" || statementsParam === "income-statement") {
      addStatementSheet(wb, {
        ...commonOpts,
        sheetName: "Income Statement",
        statementTitle: `${titlePrefix}Statement of Operations`,
        statement: incomeStatement,
      });
    }
    if (statementsParam === "all" || statementsParam === "balance-sheet") {
      addStatementSheet(wb, {
        ...commonOpts,
        sheetName: "Balance Sheet",
        statementTitle: `${titlePrefix}Balance Sheet`,
        statement: balanceSheet,
        // Balance sheet variance columns are rarely meaningful — keep budget
        // off even when enabled at report-level to avoid confusion.
        includeBudget: false,
      });
    }
    if (statementsParam === "all" || statementsParam === "cash-flow") {
      addStatementSheet(wb, {
        ...commonOpts,
        sheetName: "Cash Flow",
        statementTitle: `${titlePrefix}Statement of Cash Flows`,
        statement: cashFlowStatement,
        // Budget columns on cash flow are not supported in the UI; suppress.
        includeBudget: false,
      });
    }

    const xlsxBuffer = await wb.xlsx.writeBuffer();

    const filenameBase = entityName || "financial";
    const statementSuffix =
      statementsParam === "income-statement" ? "income_statement"
        : statementsParam === "balance-sheet" ? "balance_sheet"
        : statementsParam === "cash-flow" ? "cash_flow"
        : "financial_statements";
    const filename = `${filenameBase.replace(/[^a-zA-Z0-9]/g, "_")}_${statementSuffix}_${metadata?.startPeriod}_to_${metadata?.endPeriod}.xlsx`;

    return new Response(xlsxBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
