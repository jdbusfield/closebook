/**
 * Payroll Accrual Calculation Engine
 *
 * Pure functions for computing wage accruals and employer payroll tax estimates.
 * All employees are employed by Silverco — costs are allocated to operating
 * entities via cost center assignments.
 *
 * Wage accrual: pro-rata from last pay date to period end based on annual comp.
 * Tax accrual: per-employee, respecting annual wage base caps and YTD wages.
 */

import {
  employerTaxesOnWages,
  getEmployerTaxTable,
  type EmployerTaxTable,
} from "@/lib/budget/tax-tables";
import type { Employee, PayStatementSummary, PayStatementDetail } from "@/lib/paylocity/types";
import {
  getOperatingEntityForCostCenter,
  EMPLOYING_ENTITY_ID,
  type CostCenterEntry,
} from "@/lib/paylocity/cost-center-config";

/** Employee with optional companyId tag for multi-company cost center resolution */
type TaggedEmployee = Employee & { _companyId?: string };

// ─── Constants ───────────────────────────────────────────────────────

/** Standard working days per year (5 days × 52 weeks) */
const WORKING_DAYS_PER_YEAR = 260;

/** Calendar days per year */
const CALENDAR_DAYS_PER_YEAR = 365;

/** Default weekly hours for hourly employees */
const DEFAULT_WEEKLY_HOURS = 40;

// ─── Employer Payroll Tax Rates ──────────────────────────────────────
//
// Rates and wage bases live in src/lib/budget/tax-tables.ts by year (and
// per Paylocity company for SUI). CA SDI is employee paid and is not an
// employer cost. `TAX_RATES` stays exported for callers that only need the
// current year's table in the old shape.

function currentYearTable(): EmployerTaxTable {
  return getEmployerTaxTable(new Date().getFullYear());
}

export const TAX_RATES: Record<string, { rate: number; cap: number; label: string }> =
  Object.fromEntries(currentYearTable().map((c) => [c.key, { rate: c.rate, cap: c.cap, label: c.label }]));

// ─── Employer-Paid Benefits ──────────────────────────────────────────
//
// Pay statement detail types that represent employer-paid benefit costs.
// These are NOT employee deductions — they are company-paid MEMO earnings.
//
// Identified from Paylocity pay statement detail analysis:
//   ERMED  (detType: "Memo")         — Employer medical/dental/vision contribution
//   401ER  (detType: "MemoERMatch")  — Employer 401(k) match
//
// Employee deductions (DNTL, MDCL, 401K, VISON, LIFE) come out of the
// employee's paycheck and should NOT be included in employer cost.

/**
 * Pay statement detail types that indicate employer-paid benefits.
 * We match on `detType` (case-insensitive) to catch all MEMO-type codes.
 */
export const EMPLOYER_BENEFIT_DET_TYPES = new Set([
  "memo",
  "memoermatch",
]);

/**
 * Per-employee employer benefit cost breakdown.
 */
export interface EmployerBenefitCost {
  /** Total annual employer benefit cost for this employee */
  total: number;
  /** Breakdown by code: ERMED, 401ER, etc. */
  breakdown: Record<string, number>;
}

/**
 * Extract employer-paid benefit costs from pay statement detail lines.
 * Only includes MEMO-type items (employer contributions), NOT employee deductions.
 *
 * @param details - All pay statement detail lines for an employee for a year
 * @returns Employer benefit cost total and breakdown by code
 */
export function extractEmployerBenefitCosts(
  details: PayStatementDetail[]
): EmployerBenefitCost {
  const breakdown: Record<string, number> = {};
  let total = 0;

  for (const d of details) {
    const detTypeLower = (d.detType ?? "").toLowerCase();
    if (EMPLOYER_BENEFIT_DET_TYPES.has(detTypeLower)) {
      const amount = d.amount ?? 0;
      if (amount > 0) {
        breakdown[d.detCode] = (breakdown[d.detCode] ?? 0) + amount;
        total += amount;
      }
    }
  }

  // Round everything
  for (const key of Object.keys(breakdown)) {
    breakdown[key] = round(breakdown[key]);
  }

  return { total: round(total), breakdown };
}

/**
 * Annualize employer benefit costs from partial-year data.
 * If we have YTD data for N months, extrapolate to 12 months.
 *
 * @param ytdCost - Year-to-date employer benefit cost
 * @param monthsOfData - Number of months of pay data available
 * @returns Estimated annual employer benefit cost
 */
export function annualizeEmployerBenefits(
  ytdCost: number,
  monthsOfData: number
): number {
  if (monthsOfData <= 0 || ytdCost <= 0) return 0;
  return round((ytdCost / monthsOfData) * 12);
}

// ─── Types ───────────────────────────────────────────────────────────

export interface EmployeeAccrualInput {
  employee: Employee;
  /** YTD gross wages from pay statements (for tax cap calculations) */
  ytdGrossWages: number;
  /** Last pay period end date (ISO string) — accrual starts day after this */
  lastCheckDate: string | null;
  /** Most recent pay statement for reference */
  lastPayStatement?: PayStatementSummary;
  /** Annualized employer benefit cost (medical, 401k match, etc.) */
  annualBenefitCost?: number;
  /** Breakdown of employer benefits by code */
  benefitBreakdown?: Record<string, number>;
  /**
   * Company-wide last pay period end date. Used as fallback when the
   * employee has no individual pay statements — accrues from this date
   * instead of the start of the month.
   */
  companyLastPayPeriodEnd?: string | null;
  /**
   * Average weekly gross pay from recent paychecks. Used with calendar-day
   * pro-rata for the accrual period, which is schedule-agnostic (works for
   * both Mon-Fri and Mon-Sat work weeks). Preferred over annualComp/260.
   */
  recentWeeklyRate?: number | null;
}

export interface AccrualLineItem {
  /** Operating entity that bears this cost */
  operatingEntityId: string;
  operatingEntityCode: string;
  operatingEntityName: string;
  /** Employing entity (always Silverco) */
  employingEntityId: string;
  /** Accrual type */
  type: "wages" | "payroll_tax" | "pto" | "benefits";
  /** Human-readable description */
  description: string;
  /** Dollar amount */
  amount: number;
  /** Breakdown details */
  details?: Record<string, number>;
}

export interface EmployeeAccrualResult {
  employeeId: string;
  employeeName: string;
  department: string;
  costCenterCode: string;
  costCenterEntry: CostCenterEntry;
  annualComp: number;
  dailyRate: number;
  accrualDays: number;
  wageAccrual: number;
  taxAccrual: number;
  taxBreakdown: Record<string, number>;
  /** Monthly pro-rata employer benefit cost */
  benefitAccrual: number;
  /** Annualized employer benefit cost */
  annualBenefitCost: number;
  /** Breakdown by benefit code (ERMED, 401ER, etc.) */
  benefitBreakdown: Record<string, number>;
}

export interface AccrualResult {
  /** Period being accrued */
  periodYear: number;
  periodMonth: number;
  periodEndDate: string;
  /** Summary totals */
  totalWageAccrual: number;
  totalTaxAccrual: number;
  totalBenefitAccrual: number;
  totalAccrual: number;
  employeeCount: number;
  /** Line items grouped by operating entity (for journal entries) */
  lineItems: AccrualLineItem[];
  /** Per-employee detail */
  employeeDetails: EmployeeAccrualResult[];
  /** Errors/warnings encountered */
  warnings: string[];
}

// ─── Working Day Helpers ─────────────────────────────────────────────

/**
 * Count business days (Mon-Fri) between two dates, inclusive of both.
 */
export function countWorkingDays(startDate: Date, endDate: Date): number {
  if (endDate < startDate) return 0;

  let count = 0;
  const current = new Date(startDate);
  while (current <= endDate) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/**
 * Get the last day of a month.
 */
export function getMonthEndDate(year: number, month: number): Date {
  return new Date(year, month, 0); // month is 1-based, day 0 = last day of prev month
}

/**
 * Parse an ISO date string to a Date at midnight local time.
 * Handles both "2026-03-22" and "2026-03-22T00:00:00" formats
 * (Paylocity returns the latter).
 */
function parseDate(dateStr: string): Date {
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ─── Annual Compensation ─────────────────────────────────────────────

/**
 * Calculate annualized compensation from employee pay rate data.
 */
export function getAnnualComp(employee: Employee): number {
  const payRate = employee.currentPayRate;
  if (!payRate) return 0;

  if (payRate.annualSalary && payRate.annualSalary > 0) {
    return payRate.annualSalary;
  }

  if (payRate.payType === "Hourly" && payRate.baseRate) {
    const weeklyHours = payRate.defaultHours ?? DEFAULT_WEEKLY_HOURS;
    return payRate.baseRate * weeklyHours * 52;
  }

  if (payRate.salary && payRate.salary > 0) {
    return payRate.salary;
  }

  if (payRate.baseRate && payRate.baseRate > 0) {
    return payRate.baseRate * DEFAULT_WEEKLY_HOURS * 52;
  }

  return 0;
}

// ─── Employer Tax Calculation ────────────────────────────────────────

/**
 * Calculate employer payroll taxes on a wage amount, considering YTD wages
 * already paid (to correctly handle wage base caps).
 *
 * @param wageAmount - The accrued wages for this period
 * @param ytdGrossWages - YTD gross wages already paid before this period
 * @returns Tax amount and breakdown by component
 */
export function calculateEmployerTaxes(
  wageAmount: number,
  ytdGrossWages: number,
  table: EmployerTaxTable = currentYearTable()
): { total: number; breakdown: Record<string, number> } {
  return employerTaxesOnWages(wageAmount, ytdGrossWages, table);
}

// ─── Main Accrual Calculator ─────────────────────────────────────────

/**
 * Calculate payroll accruals for a given period.
 *
 * For each employee:
 * 1. Determine daily wage rate from annual comp
 * 2. Count working days from day after last pay date through period end
 * 3. Calculate accrued wages
 * 4. Calculate employer payroll taxes on accrued wages (respecting caps)
 * 5. Group by operating entity via cost center assignment
 *
 * @param inputs - Array of employee data with YTD wages and last check dates
 * @param periodYear - Accrual period year
 * @param periodMonth - Accrual period month (1-12)
 */
export function calculateAccruals(
  inputs: EmployeeAccrualInput[],
  periodYear: number,
  periodMonth: number
): AccrualResult {
  const periodEnd = getMonthEndDate(periodYear, periodMonth);
  const periodEndStr = formatDate(periodEnd);
  const warnings: string[] = [];
  const employeeDetails: EmployeeAccrualResult[] = [];

  // Aggregate by operating entity + department
  const deptWages: Record<string, { entry: CostCenterEntry; wages: number; taxes: number; taxBreakdown: Record<string, number>; benefits: number; benefitBreakdown: Record<string, number> }> = {};

  for (const input of inputs) {
    const { employee, ytdGrossWages, lastCheckDate } = input;

    // Build display name from info fields (displayName is not returned by API)
    const empName = employee.displayName
      ?? ([employee.info?.firstName, employee.info?.lastName].filter(Boolean).join(" ") || `Employee ${employee.id}`);

    // Determine compensation basis
    const annualComp = getAnnualComp(employee);
    const weeklyRate = input.recentWeeklyRate;
    const useWeeklyRate = weeklyRate != null && weeklyRate > 0;

    if (!useWeeklyRate && annualComp <= 0) {
      warnings.push(`${empName} (${employee.id}): no compensation data, skipped`);
      continue;
    }

    // Determine accrual start date:
    // 1. Day after employee's last pay period end (if they have pay statements)
    // 2. Day after company's last payroll date (if employee has none but company does)
    // 3. Start of month (last resort)
    let accrualStart: Date;
    if (lastCheckDate) {
      accrualStart = parseDate(lastCheckDate);
      accrualStart.setDate(accrualStart.getDate() + 1);
    } else if (input.companyLastPayPeriodEnd) {
      accrualStart = parseDate(input.companyLastPayPeriodEnd);
      accrualStart.setDate(accrualStart.getDate() + 1);
    } else {
      accrualStart = new Date(periodYear, periodMonth - 1, 1);
    }

    // Calculate wage accrual using the appropriate method:
    // - Weekly rate + calendar-day pro-rata: schedule-agnostic, works for
    //   both Mon-Fri (biweekly) and Mon-Sat (weekly) pay schedules
    // - Annual comp / working days: fallback for salaried employees
    //   without recent pay data
    let wageAccrual: number;
    let accrualDays: number;
    const dailyRate = annualComp > 0 ? annualComp / WORKING_DAYS_PER_YEAR : 0;

    if (useWeeklyRate) {
      // Calendar-day pro-rata: total calendar days / 7 = weeks
      const calendarDays = Math.floor(
        (periodEnd.getTime() - accrualStart.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;
      if (calendarDays <= 0) continue;
      const accrualWeeks = calendarDays / 7;
      wageAccrual = round(weeklyRate * accrualWeeks);
      // For display purposes, show Mon-Fri working days
      accrualDays = countWorkingDays(accrualStart, periodEnd);
    } else {
      accrualDays = countWorkingDays(accrualStart, periodEnd);
      if (accrualDays <= 0) continue;
      wageAccrual = round(dailyRate * accrualDays);
    }

    // Calculate employer payroll taxes
    const { total: taxAccrual, breakdown: taxBreakdown } = calculateEmployerTaxes(
      wageAccrual,
      ytdGrossWages
    );

    // Employer benefit cost — pro-rata for the accrual period
    const annualBenefitCost = input.annualBenefitCost ?? 0;
    const benefitBreakdown = input.benefitBreakdown ?? {};
    // Monthly pro-rata: annualBenefitCost × (accrual days / working days per year)
    const benefitAccrual = annualBenefitCost > 0
      ? round(annualBenefitCost * (accrualDays / WORKING_DAYS_PER_YEAR))
      : 0;

    // Map to operating entity (company-scoped for correct cost center resolution)
    const costCenterCode = employee.position?.costCenter1 ?? null;
    const costCenterEntry = getOperatingEntityForCostCenter(
      costCenterCode,
      (employee as TaggedEmployee)._companyId
    );

    // Accumulate by entity + department
    const deptKey = `${costCenterEntry.operatingEntityId}:${costCenterEntry.department}`;
    if (!deptWages[deptKey]) {
      deptWages[deptKey] = {
        entry: costCenterEntry,
        wages: 0,
        taxes: 0,
        taxBreakdown: {},
        benefits: 0,
        benefitBreakdown: {},
      };
    }
    deptWages[deptKey].wages += wageAccrual;
    deptWages[deptKey].taxes += taxAccrual;
    deptWages[deptKey].benefits += benefitAccrual;

    // Merge tax breakdown
    for (const [taxKey, taxAmount] of Object.entries(taxBreakdown)) {
      deptWages[deptKey].taxBreakdown[taxKey] =
        (deptWages[deptKey].taxBreakdown[taxKey] || 0) + taxAmount;
    }

    // Merge benefit breakdown
    for (const [bKey, bAmount] of Object.entries(benefitBreakdown)) {
      deptWages[deptKey].benefitBreakdown[bKey] =
        (deptWages[deptKey].benefitBreakdown[bKey] || 0) + (bAmount * (accrualDays / WORKING_DAYS_PER_YEAR));
    }

    employeeDetails.push({
      employeeId: employee.id,
      employeeName: empName,
      department: costCenterEntry.department,
      costCenterCode: costCenterCode ?? "UNKNOWN",
      costCenterEntry,
      annualComp,
      dailyRate: round(dailyRate),
      accrualDays,
      wageAccrual,
      taxAccrual,
      taxBreakdown,
      benefitAccrual,
      annualBenefitCost,
      benefitBreakdown,
    });
  }

  // Build line items — one per entity + department + type
  const lineItems: AccrualLineItem[] = [];
  let totalWageAccrual = 0;
  let totalTaxAccrual = 0;
  let totalBenefitAccrual = 0;

  for (const [, data] of Object.entries(deptWages)) {
    const dept = data.entry.department;
    const wages = round(data.wages);
    const taxes = round(data.taxes);
    const benefits = round(data.benefits);

    if (wages > 0) {
      lineItems.push({
        operatingEntityId: data.entry.operatingEntityId,
        operatingEntityCode: data.entry.operatingEntityCode,
        operatingEntityName: data.entry.operatingEntityName,
        employingEntityId: EMPLOYING_ENTITY_ID,
        type: "wages",
        description: `Accrued wages — ${dept}`,
        amount: wages,
      });
    }

    if (taxes > 0) {
      const roundedBreakdown: Record<string, number> = {};
      for (const [k, v] of Object.entries(data.taxBreakdown)) {
        roundedBreakdown[k] = round(v);
      }

      lineItems.push({
        operatingEntityId: data.entry.operatingEntityId,
        operatingEntityCode: data.entry.operatingEntityCode,
        operatingEntityName: data.entry.operatingEntityName,
        employingEntityId: EMPLOYING_ENTITY_ID,
        type: "payroll_tax",
        description: `Employer payroll taxes — ${dept}`,
        amount: taxes,
        details: roundedBreakdown,
      });
    }

    if (benefits > 0) {
      const roundedBenefits: Record<string, number> = {};
      for (const [k, v] of Object.entries(data.benefitBreakdown)) {
        roundedBenefits[k] = round(v);
      }

      lineItems.push({
        operatingEntityId: data.entry.operatingEntityId,
        operatingEntityCode: data.entry.operatingEntityCode,
        operatingEntityName: data.entry.operatingEntityName,
        employingEntityId: EMPLOYING_ENTITY_ID,
        type: "benefits",
        description: `Employer benefits — ${dept}`,
        amount: benefits,
        details: roundedBenefits,
      });
    }

    totalWageAccrual += wages;
    totalTaxAccrual += taxes;
    totalBenefitAccrual += benefits;
  }

  // Sort line items: grouped by entity then department, then type within each
  const typeOrder = { wages: 0, payroll_tax: 1, benefits: 2, pto: 3 };
  lineItems.sort((a, b) => {
    if (a.operatingEntityCode !== b.operatingEntityCode) {
      return a.operatingEntityCode.localeCompare(b.operatingEntityCode);
    }
    if (a.description !== b.description) {
      return a.description.localeCompare(b.description);
    }
    return (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
  });

  return {
    periodYear,
    periodMonth,
    periodEndDate: periodEndStr,
    totalWageAccrual: round(totalWageAccrual),
    totalTaxAccrual: round(totalTaxAccrual),
    totalBenefitAccrual: round(totalBenefitAccrual),
    totalAccrual: round(totalWageAccrual + totalTaxAccrual + totalBenefitAccrual),
    employeeCount: employeeDetails.length,
    lineItems,
    employeeDetails,
    warnings,
  };
}

// ─── Annual Employer Cost Estimation ─────────────────────────────────

/**
 * Estimate annual employer payroll taxes for a given annual compensation.
 * This is a simplified full-year estimate (assumes employee hits caps mid-year).
 * Used for "Total Comp" display on dashboards and roster pages.
 *
 * Components: FICA SS, Medicare, FUTA, CA SUI, CA ETT, CA SDI
 */
export function estimateAnnualERTaxes(
  annualComp: number,
  table: EmployerTaxTable = currentYearTable()
): {
  total: number;
  breakdown: Record<string, number>;
} {
  return employerTaxesOnWages(annualComp, 0, table);
}

// ─── Helpers ─────────────────────────────────────────────────────────

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Aggregation Utilities ───────────────────────────────────────────

export interface EntityPayrollSummary {
  entityId: string;
  entityCode: string;
  entityName: string;
  headcount: number;
  totalAnnualComp: number;
  totalMonthlyComp: number;
  totalAnnualBenefits: number;
  departments: {
    department: string;
    headcount: number;
    totalAnnualComp: number;
  }[];
}

/**
 * Aggregate employee data into per-entity payroll summaries.
 * Used by dashboards for KPI cards and charts.
 *
 * @param employees - Employee list with _companyId tags
 * @param benefitCosts - Optional map of "employeeId:companyId" → annual employer benefit cost
 */
export function aggregateByEntity(
  employees: (Employee & { _companyId?: string })[],
  benefitCosts?: Record<string, number>
): EntityPayrollSummary[] {
  const entityMap: Record<string, {
    entityId: string;
    entityCode: string;
    entityName: string;
    totalBenefits: number;
    deptMap: Record<string, { headcount: number; totalAnnualComp: number }>;
  }> = {};

  for (const emp of employees) {
    const annualComp = getAnnualComp(emp);
    const cc = getOperatingEntityForCostCenter(emp.position?.costCenter1, emp._companyId);

    if (!entityMap[cc.operatingEntityId]) {
      entityMap[cc.operatingEntityId] = {
        entityId: cc.operatingEntityId,
        entityCode: cc.operatingEntityCode,
        entityName: cc.operatingEntityName,
        totalBenefits: 0,
        deptMap: {},
      };
    }

    const entity = entityMap[cc.operatingEntityId];
    if (!entity.deptMap[cc.department]) {
      entity.deptMap[cc.department] = { headcount: 0, totalAnnualComp: 0 };
    }

    entity.deptMap[cc.department].headcount++;
    entity.deptMap[cc.department].totalAnnualComp += annualComp;

    // Add employer benefit cost if available
    if (benefitCosts) {
      const benefitKey = `${emp.id}:${emp._companyId}`;
      entity.totalBenefits += benefitCosts[benefitKey] ?? 0;
    }
  }

  return Object.values(entityMap).map((e) => {
    const departments = Object.entries(e.deptMap).map(([dept, data]) => ({
      department: dept,
      headcount: data.headcount,
      totalAnnualComp: round(data.totalAnnualComp),
    }));

    const headcount = departments.reduce((sum, d) => sum + d.headcount, 0);
    const totalAnnualComp = departments.reduce((sum, d) => sum + d.totalAnnualComp, 0);

    return {
      entityId: e.entityId,
      entityCode: e.entityCode,
      entityName: e.entityName,
      headcount,
      totalAnnualComp: round(totalAnnualComp),
      totalMonthlyComp: round(totalAnnualComp / 12),
      totalAnnualBenefits: round(e.totalBenefits),
      departments: departments.sort((a, b) => b.totalAnnualComp - a.totalAnnualComp),
    };
  }).sort((a, b) => b.totalAnnualComp - a.totalAnnualComp);
}
