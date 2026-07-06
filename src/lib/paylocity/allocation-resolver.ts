/**
 * Date-aware employee allocation resolver.
 *
 * Resolves which allocation is active for an employee on a given date.
 * An employee can have multiple allocation rows, each with an effective_date.
 * The active allocation for a date is the one with the most recent
 * effective_date <= that date.
 *
 * Pre-sorts allocations per employee at construction time so each
 * date lookup is a single linear scan.
 */

/** One class % split entry. Percentages within a row sum to 100. */
export interface ClassSplit {
  className: string;
  pct: number; // 0-100
}

export interface AllocationRow {
  employee_id: string;
  paylocity_company_id: string;
  department: string | null;
  class: string | null;
  /** Multi-class % split: [{class, pct}, ...] summing to 100. Null = legacy single `class` at 100%. */
  class_allocations?: { class: string; pct: number }[] | null;
  allocated_entity_id: string | null;
  allocated_entity_name: string | null;
  effective_date: string; // "YYYY-MM-DD"
}

/**
 * A span of a month during which one allocation row is constantly in effect.
 * `weight` is the span's calendar-day share of the month (weights sum to 1).
 */
export interface MonthSegment {
  row: AllocationRow | null;
  startDate: string; // "YYYY-MM-DD" (>= first of month)
  endDate: string;   // "YYYY-MM-DD" (<= last of month)
  days: number;
  weight: number;
}

/**
 * Normalize a row's class configuration into a clean split list.
 * Prefers class_allocations; falls back to the legacy single `class` column
 * at 100%. Filters invalid entries and re-normalizes percentages to sum to
 * exactly 100 (defensive — the API validates on write).
 */
export function getClassSplits(row: AllocationRow | null): ClassSplit[] {
  if (!row) return [];
  const raw = Array.isArray(row.class_allocations) ? row.class_allocations : [];
  const valid = raw
    .filter((s) => s && typeof s.class === "string" && s.class.trim() !== "" && Number(s.pct) > 0)
    .map((s) => ({ className: s.class.trim(), pct: Number(s.pct) }));
  if (valid.length > 0) {
    const sum = valid.reduce((t, s) => t + s.pct, 0);
    if (sum <= 0) return [];
    return valid.map((s) => ({ className: s.className, pct: (s.pct / sum) * 100 }));
  }
  if (row.class && row.class.trim() !== "") {
    return [{ className: row.class.trim(), pct: 100 }];
  }
  return [];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export class AllocationResolver {
  // Map<"employeeId:companyId", AllocationRow[] sorted by effective_date DESC>
  private byEmployee: Map<string, AllocationRow[]>;

  constructor(rows: AllocationRow[]) {
    this.byEmployee = new Map();
    for (const row of rows) {
      const key = `${row.employee_id}:${row.paylocity_company_id}`;
      if (!this.byEmployee.has(key)) {
        this.byEmployee.set(key, []);
      }
      this.byEmployee.get(key)!.push(row);
    }
    // Sort DESC so the first match in a scan is the most recent
    for (const [, arr] of this.byEmployee) {
      arr.sort((a, b) => b.effective_date.localeCompare(a.effective_date));
    }
  }

  /** Get the allocation active on a specific date. Returns null if none. */
  getForDate(
    employeeId: string,
    companyId: string,
    date: string
  ): AllocationRow | null {
    const arr = this.byEmployee.get(`${employeeId}:${companyId}`);
    if (!arr) return null;
    for (const alloc of arr) {
      if (alloc.effective_date <= date) return alloc;
    }
    return null;
  }

  /** Get all allocation periods for an employee, sorted ASC by effective_date. */
  getAllPeriods(
    employeeId: string,
    companyId: string
  ): AllocationRow[] {
    const arr = this.byEmployee.get(`${employeeId}:${companyId}`);
    if (!arr) return [];
    return [...arr].reverse(); // stored DESC → return ASC
  }

  /** Check if an employee has multiple allocation periods. */
  hasMultiplePeriods(
    employeeId: string,
    companyId: string
  ): boolean {
    return (this.byEmployee.get(`${employeeId}:${companyId}`)?.length ?? 0) > 1;
  }

  /**
   * Split a month into calendar-day segments, one per allocation row in
   * effect. A mid-month effective date starts a new segment on that day.
   * Weights are day-count fractions of the month and always sum to 1.
   * With no allocation rows, returns one full-month segment with row: null.
   */
  getSegmentsForMonth(
    employeeId: string,
    companyId: string,
    year: number,
    month: number
  ): MonthSegment[] {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstIso = isoDate(year, month, 1);
    const lastIso = isoDate(year, month, daysInMonth);

    // Effective dates strictly inside the month start new segments.
    const periods = this.getAllPeriods(employeeId, companyId);
    const boundaryDays = new Set<number>([1]);
    for (const p of periods) {
      if (p.effective_date > firstIso && p.effective_date <= lastIso) {
        boundaryDays.add(Number(p.effective_date.slice(8, 10)));
      }
    }

    const starts = [...boundaryDays].sort((a, b) => a - b);
    const segments: MonthSegment[] = [];
    for (let i = 0; i < starts.length; i++) {
      const startDay = starts[i];
      const endDay = i + 1 < starts.length ? starts[i + 1] - 1 : daysInMonth;
      const startDate = isoDate(year, month, startDay);
      const days = endDay - startDay + 1;
      segments.push({
        row: this.getForDate(employeeId, companyId, startDate),
        startDate,
        endDate: isoDate(year, month, endDay),
        days,
        weight: days / daysInMonth,
      });
    }
    return segments;
  }
}
