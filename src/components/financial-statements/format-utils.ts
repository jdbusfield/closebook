import type { Period, Granularity, StatementData } from "./types";

/**
 * Format a number for 10-K style financial statements.
 * Uses parentheses for negatives, optional dollar sign.
 */
export function formatStatementAmount(
  amount: number,
  showDollarSign: boolean = false
): string {
  if (amount === 0) {
    return showDollarSign ? "$\u2014" : "\u2014"; // em dash for zero
  }

  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(abs);

  const prefix = showDollarSign ? "$" : "";

  if (amount < 0) {
    return `${prefix}(${formatted})`;
  }
  return `${prefix}${formatted}`;
}

/**
 * Format with decimals for detailed views.
 */
export function formatStatementAmountDetailed(
  amount: number,
  showDollarSign: boolean = false
): string {
  if (amount === 0) {
    return showDollarSign ? "$\u2014" : "\u2014";
  }

  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);

  const prefix = showDollarSign ? "$" : "";

  if (amount < 0) {
    return `${prefix}(${formatted})`;
  }
  return `${prefix}${formatted}`;
}

/**
 * Compute and format variance between actual and budget.
 */
export function formatVariance(
  actual: number,
  budget: number
): {
  dollarVariance: string;
  percentVariance: string;
  favorable: boolean;
  dollarValue: number;
  percentValue: number | null;
} {
  const dollarValue = actual - budget;
  const percentValue = budget !== 0 ? dollarValue / Math.abs(budget) : null;
  const favorable = dollarValue >= 0;

  return {
    dollarVariance: formatStatementAmount(dollarValue),
    percentVariance:
      percentValue !== null
        ? `${(percentValue * 100).toFixed(1)}%`
        : "N/A",
    favorable,
    dollarValue,
    percentValue,
  };
}

/**
 * Compute YoY change between current and prior year.
 */
export function formatYoYChange(
  current: number,
  priorYear: number
): {
  dollarChange: string;
  percentChange: string;
  positive: boolean;
  dollarValue: number;
  percentValue: number | null;
} {
  const dollarValue = current - priorYear;
  const percentValue =
    priorYear !== 0 ? dollarValue / Math.abs(priorYear) : null;
  const positive = dollarValue >= 0;

  return {
    dollarChange: formatStatementAmount(dollarValue),
    percentChange:
      percentValue !== null
        ? `${(percentValue * 100).toFixed(1)}%`
        : "N/A",
    positive,
    dollarValue,
    percentValue,
  };
}

/**
 * Build the column header label for a period.
 */
export function getPeriodColumnHeader(
  period: Period,
  granularity: Granularity
): string {
  return period.label;
}

/**
 * Filter an income statement to show only sections through Operating Margin %
 * (EBITDA-only view). Removes Other Expense, Other Income, Net Income, and
 * Net Income Margin % sections.
 */
export function filterForEbitdaOnly(statement: StatementData): StatementData {
  const cutoffIndex = statement.sections.findIndex(
    (s) => s.id === "operating_margin_pct"
  );
  if (cutoffIndex === -1) return statement;
  return {
    ...statement,
    sections: statement.sections.slice(0, cutoffIndex + 1),
  };
}

const MONTH_NAMES_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Build a period description for the statement header.
 * e.g., "For the Year Ended December 31, 2025"
 *        "For the Three Months Ended March 31, 2025"
 *        "For the Month Ended January 31, 2025"
 */
export function getStatementPeriodDescription(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
  granularity: Granularity
): string {
  const MONTH_NAMES_FULL = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const endDate = new Date(endYear, endMonth, 0); // last day of end month
  const endDayStr = `${MONTH_NAMES_FULL[endMonth - 1]} ${endDate.getDate()}, ${endYear}`;

  if (granularity === "yearly") {
    // When the selected range doesn't run through December, it's a
    // partial / YTD view — say so explicitly so the caption isn't
    // misread as a full-year statement.
    if (endMonth !== 12) {
      return `Year to Date through ${endDayStr}`;
    }
    return `For the Year Ended ${endDayStr}`;
  }
  if (granularity === "quarterly") {
    return `For the Three Months Ended ${endDayStr}`;
  }

  // Monthly — check if it's a single month or a range
  const totalMonths =
    (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
  if (totalMonths === 1) {
    return `For the Month Ended ${endDayStr}`;
  }
  return `For the ${totalMonths} Months Ended ${endDayStr}`;
}
