import { format, endOfMonth, startOfMonth, subMonths, addMonths } from "date-fns";

/**
 * Format a bare ISO date string ("YYYY-MM-DD" or "YYYY-MM-DDTHH:..") using the
 * viewer's locale without the UTC-vs-local timezone shift. `new Date(iso)` on
 * a bare date string parses as UTC midnight, which renders one day earlier in
 * negative-offset timezones (PST/EST/etc). This splits the string and builds
 * a local Date so the displayed date matches what was entered.
 */
export function formatIsoDateLocal(
  iso: string | null | undefined
): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("T")[0].split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString();
}

export function getPeriodLabel(year: number, month: number): string {
  const date = new Date(year, month - 1, 1);
  return format(date, "MMMM yyyy");
}

export function getPeriodShortLabel(year: number, month: number): string {
  const date = new Date(year, month - 1, 1);
  return format(date, "MMM yyyy");
}

export function getCurrentPeriod(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/**
 * Day of the month on which the prior month's close is treated as published.
 * Before this day, trailing-12 views end two months back so an unfinished
 * close never shows up in dashboard financials.
 */
export const REPORTING_CUTOVER_DAY = 20;

/**
 * The period that dashboard financials treat as "current" for trailing-12
 * windows. Until the 20th of the month the prior month's close is still in
 * progress, so this returns the prior period; on or after the 20th it returns
 * the actual current period. Trailing-12 ranges end one month before the
 * returned period.
 */
export function getReportingPeriod(now: Date = new Date()): {
  year: number;
  month: number;
} {
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  if (now.getDate() >= REPORTING_CUTOVER_DAY) return current;
  return getPriorPeriod(current.year, current.month);
}

export function getPriorPeriod(
  year: number,
  month: number
): { year: number; month: number } {
  const date = subMonths(new Date(year, month - 1, 1), 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function getNextPeriod(
  year: number,
  month: number
): { year: number; month: number } {
  const date = addMonths(new Date(year, month - 1, 1), 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

export function getPeriodEndDate(year: number, month: number): Date {
  return endOfMonth(new Date(year, month - 1, 1));
}

export function getPeriodStartDate(year: number, month: number): Date {
  return startOfMonth(new Date(year, month - 1, 1));
}

export function computeDueDate(
  periodYear: number,
  periodMonth: number,
  relativeDueDay: number
): Date {
  // relativeDueDay = days after period end
  const periodEnd = getPeriodEndDate(periodYear, periodMonth);
  const dueDate = new Date(periodEnd);
  dueDate.setDate(dueDate.getDate() + relativeDueDay);
  return dueDate;
}

export function formatCurrency(
  amount: number,
  currency: string = "USD"
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatPercentage(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumber(value: number, decimals: number = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// ---------------------------------------------------------------------------
// Period range and quarterly helpers (used by financial statements)
// ---------------------------------------------------------------------------

export function getQuarterForMonth(month: number): number {
  return Math.ceil(month / 3);
}

export function getQuarterLabel(year: number, quarter: number): string {
  return `Q${quarter} ${year}`;
}

export function getQuarterEndMonth(quarter: number): number {
  return quarter * 3;
}

export function getQuarterStartMonth(quarter: number): number {
  return (quarter - 1) * 3 + 1;
}

export interface PeriodBucket {
  key: string;
  label: string;
  year: number;
  startMonth: number;
  endMonth: number;
  endYear: number;
  /** All individual (year, month) pairs in this bucket */
  months: Array<{ year: number; month: number }>;
}

/**
 * Generate an array of period buckets from start to end at the given granularity.
 */
export function getPeriodsInRange(
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number,
  granularity: "monthly" | "quarterly" | "yearly"
): PeriodBucket[] {
  const buckets: PeriodBucket[] = [];

  if (granularity === "monthly") {
    let y = startYear;
    let m = startMonth;
    while (y < endYear || (y === endYear && m <= endMonth)) {
      const shortMonth = format(new Date(y, m - 1, 1), "MMM");
      const shortYear = String(y).slice(-2);
      buckets.push({
        key: `${y}-${String(m).padStart(2, "0")}`,
        label: `${shortMonth}-${shortYear}`,
        year: y,
        startMonth: m,
        endMonth: m,
        endYear: y,
        months: [{ year: y, month: m }],
      });
      const next = addMonths(new Date(y, m - 1, 1), 1);
      y = next.getFullYear();
      m = next.getMonth() + 1;
    }
  } else if (granularity === "quarterly") {
    // Start from the quarter containing startMonth
    let y = startYear;
    let q = getQuarterForMonth(startMonth);
    while (true) {
      const qStart = getQuarterStartMonth(q);
      const qEnd = getQuarterEndMonth(q);
      // Collect months in this quarter that fall within our range
      const months: Array<{ year: number; month: number }> = [];
      for (let m = qStart; m <= qEnd; m++) {
        if (
          (y > startYear || (y === startYear && m >= startMonth)) &&
          (y < endYear || (y === endYear && m <= endMonth))
        ) {
          months.push({ year: y, month: m });
        }
      }
      if (months.length > 0) {
        buckets.push({
          key: `${y}-Q${q}`,
          label: `Q${q} ${String(y).slice(-2)}`,
          year: y,
          startMonth: qStart,
          endMonth: qEnd,
          endYear: y,
          months,
        });
      }
      // Move to next quarter
      if (q === 4) {
        q = 1;
        y++;
      } else {
        q++;
      }
      // Stop if we've passed the end
      if (y > endYear || (y === endYear && getQuarterStartMonth(q) > endMonth)) {
        break;
      }
    }
  } else {
    // Yearly
    for (let y = startYear; y <= endYear; y++) {
      const months: Array<{ year: number; month: number }> = [];
      const mStart = y === startYear ? startMonth : 1;
      const mEnd = y === endYear ? endMonth : 12;
      for (let m = mStart; m <= mEnd; m++) {
        months.push({ year: y, month: m });
      }
      if (months.length > 0) {
        buckets.push({
          key: `FY${y}`,
          label: `FY ${String(y).slice(-2)}`,
          year: y,
          startMonth: mStart,
          endMonth: mEnd,
          endYear: y,
          months,
        });
      }
    }
  }

  return buckets;
}
