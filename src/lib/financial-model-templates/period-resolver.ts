// Resolves a financial-model template's period to a concrete year/month range.
// Used both on the client (when loading a template into the page state) and on
// the server (when exporting templates to PDF).

export type DynamicPreset =
  | "last_month"
  | "this_month"
  | "last_quarter"
  | "this_quarter"
  | "ytd"
  | "ytd_last_month"
  | "trailing_12"
  | "prior_year"
  | "last_year_full";

export const DYNAMIC_PRESET_LABELS: Record<DynamicPreset, string> = {
  last_month: "Last month",
  this_month: "This month (current)",
  last_quarter: "Last completed quarter",
  this_quarter: "This quarter to date",
  ytd: "Year to date (through current month)",
  ytd_last_month: "Year to date (through last completed month)",
  trailing_12: "Trailing 12 months",
  prior_year: "Prior calendar year",
  last_year_full: "Last full fiscal year",
};

export interface ResolvedPeriod {
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12 + 12) % 12;
  return { year: y, month: m + 1 };
}

function quarterStartMonth(month: number): number {
  return Math.floor((month - 1) / 3) * 3 + 1;
}

export function resolveDynamicPeriod(
  preset: DynamicPreset,
  today: Date = new Date()
): ResolvedPeriod {
  const curYear = today.getFullYear();
  const curMonth = today.getMonth() + 1;

  switch (preset) {
    case "this_month":
      return { startYear: curYear, startMonth: curMonth, endYear: curYear, endMonth: curMonth };

    case "last_month": {
      const lm = addMonths(curYear, curMonth, -1);
      return { startYear: lm.year, startMonth: lm.month, endYear: lm.year, endMonth: lm.month };
    }

    case "this_quarter": {
      const qStart = quarterStartMonth(curMonth);
      return {
        startYear: curYear,
        startMonth: qStart,
        endYear: curYear,
        endMonth: curMonth,
      };
    }

    case "last_quarter": {
      const qStart = quarterStartMonth(curMonth);
      // Move back one quarter from the current quarter's start
      const prev = addMonths(curYear, qStart, -3);
      const prevEnd = addMonths(prev.year, prev.month, 2);
      return {
        startYear: prev.year,
        startMonth: prev.month,
        endYear: prevEnd.year,
        endMonth: prevEnd.month,
      };
    }

    case "ytd":
      return { startYear: curYear, startMonth: 1, endYear: curYear, endMonth: curMonth };

    case "ytd_last_month": {
      // YTD through the last completed month. If we're in January, the
      // "last completed month" is December of the prior year — in which
      // case YTD-last-month effectively becomes the prior calendar year.
      if (curMonth === 1) {
        return { startYear: curYear - 1, startMonth: 1, endYear: curYear - 1, endMonth: 12 };
      }
      return { startYear: curYear, startMonth: 1, endYear: curYear, endMonth: curMonth - 1 };
    }

    case "trailing_12": {
      const start = addMonths(curYear, curMonth, -11);
      return {
        startYear: start.year,
        startMonth: start.month,
        endYear: curYear,
        endMonth: curMonth,
      };
    }

    case "prior_year":
      return { startYear: curYear - 1, startMonth: 1, endYear: curYear - 1, endMonth: 12 };

    case "last_year_full":
      return { startYear: curYear - 1, startMonth: 1, endYear: curYear - 1, endMonth: 12 };
  }
}

export interface TemplatePeriodInput {
  periodMode: "static" | "dynamic" | "hybrid";
  staticRange?: ResolvedPeriod | null;
  /** Static start, used by hybrid mode (start fixed, end follows today) */
  staticStart?: { year: number; month: number } | null;
  dynamicPreset?: DynamicPreset | null;
}

export function resolveTemplatePeriod(
  input: TemplatePeriodInput,
  today: Date = new Date()
): ResolvedPeriod | null {
  if (input.periodMode === "dynamic" && input.dynamicPreset) {
    return resolveDynamicPeriod(input.dynamicPreset, today);
  }
  if (input.periodMode === "hybrid" && input.staticStart && input.dynamicPreset) {
    // Take the end of the dynamic preset's range; use the static start.
    const dyn = resolveDynamicPeriod(input.dynamicPreset, today);
    return {
      startYear: input.staticStart.year,
      startMonth: input.staticStart.month,
      endYear: dyn.endYear,
      endMonth: dyn.endMonth,
    };
  }
  if (input.periodMode === "static" && input.staticRange) {
    return input.staticRange;
  }
  return null;
}
