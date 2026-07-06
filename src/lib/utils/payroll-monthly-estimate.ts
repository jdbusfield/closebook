/**
 * Monthly Payroll Estimate — accrual-basis engine.
 *
 * Produces the accrual-basis payroll expense for a single month, per employee,
 * rolled up to reporting entity and organization, together with a reconciling
 * cash → accrual bridge:
 *
 *     Cash paid in month (checks dated in M)
 *     − Beginning accrued payroll (earned ≤ M−1, unpaid entering M)
 *     + Ending accrued payroll     (earned in M, unpaid at month end)
 *     = Accrual-basis payroll expense for month M
 *
 * The bridge is derived from the accrued-payroll-liability rollforward, which is
 * an EXACT identity (not an approximation), so it reconciles to the penny and
 * correctly absorbs deferred payroll (a check dated before the work it pays for
 * simply produces a negative beginning-accrued figure).
 *
 *   AccruedLiability(T) = (wages earned through T) − (wages paid through T)
 *   BAL = AccruedLiability(M_start − 1)
 *   EAL = AccruedLiability(M_end)
 *   EAL − BAL = E_M − Cash_M   ⟹   E_M = Cash_M − BAL + EAL
 *
 * All figures use day-count pro-rating of each check's PAY PERIOD (begin..end),
 * the same math the per-employee monthly drill-down already uses — this engine
 * generalizes it and rolls it up.
 *
 * Source of truth: employee_paycheck_details (actual Paylocity checks) ONLY.
 * Never read employee_monthly_costs.gross_pay here — it already bakes in a
 * current-month accrual tail and would double-count.
 */

import {
  calculateEmployerTaxes,
} from "./payroll-calculations";
import {
  getOperatingEntityForCostCenter,
  COMPANY_EMPLOYING_ENTITY,
} from "@/lib/paylocity/cost-center-config";
import {
  getClassSplits,
  type AllocationResolver,
  type ClassSplit,
  type MonthSegment,
} from "@/lib/paylocity/allocation-resolver";
import { getEntityMeta, ENTITY_ORDER } from "@/lib/paylocity/entities";

// ─── Types ────────────────────────────────────────────────────────────

/** Subset of employee_paycheck_details needed for the bridge. */
export interface PaycheckRow {
  employee_id: string;
  paylocity_company_id: string;
  employee_name: string;
  check_date: string; // "YYYY-MM-DD"
  begin_date: string; // pay period start
  end_date: string;   // pay period end
  transaction_number: string | null;
  gross_pay: number;
  er_taxes_estimated: number;
  er_benefits: number;
  // Premium pay detail (for the by-employee OT/DT/meal breakdown)
  overtime_hours: number;
  overtime_dollars: number;
  doubletime_hours: number;
  doubletime_dollars: number;
  meal_dollars: number;
  /** Count of meal premiums (each = 1 hr on a MEAL detail line). */
  meal_count: number;
}

/** Per-employee context the engine needs beyond the raw checks. */
export interface EmployeeMeta {
  employeeId: string;
  companyId: string;
  employeeName: string;
  costCenterCode: string | null;
  annualComp: number;
  /** YTD gross wages earned through month end (for tax-cap accuracy on the estimated tail). */
  ytdGrossThroughMEnd: number;
}

/** A wages / ER-tax / ER-benefit money triple. */
export interface AmountTriple {
  wages: number;
  erTaxes: number;
  erBenefits: number;
}

/**
 * One day-weighted share of an employee's month, attributed to a single
 * (entity, department, class-mix) combination. An employee whose allocation
 * changes mid-month has one slice per allocation period; slices' components
 * sum exactly to the employee's bridge (residual assigned to the last slice).
 */
export interface EmployeeSlice {
  entityId: string;
  entityCode: string;
  entityName: string;
  department: string;
  /** Calendar-day fraction of the month this slice covers (slices sum to 1). */
  weight: number;
  startDate: string;
  endDate: string;
  /** Class % splits in effect during this slice (empty = unassigned). */
  classSplits: ClassSplit[];
  cash: AmountTriple;
  beginningAccrued: AmountTriple;
  endingAccruedActual: AmountTriple;
  estimatedTail: AmountTriple;
  endingAccrued: AmountTriple;
  earnedInMonth: AmountTriple;
  overtimeHours: number;
  doubletimeHours: number;
  mealPremiums: number;
  premiumPayCost: number;
}

export interface EmployeeBridge {
  employeeId: string;
  companyId: string;
  employeeName: string;
  effectiveEntityId: string;
  effectiveEntityCode: string;
  effectiveEntityName: string;
  /** The entity whose payroll company actually paid this employee (by companyId),
   *  independent of allocation — used for the "paying entity" reconciliation view. */
  employingEntityId: string;
  employingEntityCode: string;
  employingEntityName: string;
  department: string;
  costCenterCode: string;
  usedCostCenterFallback: boolean;
  allocationChangedInMonth: boolean;
  // Bridge components (each is a wages/tax/benefit triple)
  cash: AmountTriple;              // checks dated in M
  beginningAccrued: AmountTriple;  // BAL (can be negative = net prepaid/deferred)
  endingAccruedActual: AmountTriple;
  estimatedTail: AmountTriple;     // 0 for the current in-progress month
  endingAccrued: AmountTriple;     // endingAccruedActual + estimatedTail
  earnedInMonth: AmountTriple;     // headline = cash − beginningAccrued + endingAccrued
  // Premium pay incurred in the month (earned-in-month allocated)
  overtimeHours: number;
  doubletimeHours: number;
  mealPremiums: number;
  /** Lump-sum cost of OT + DT + meal premiums (dollars). */
  premiumPayCost: number;
  // Coverage / data quality
  checkCount: number;
  hasZeroChecks: boolean;
  coveredDays: number;
  uncoveredTailDays: number;
  /** ISO date range of the uncovered trailing month-end span (e.g. 6/29–6/30),
   *  or null when the month is fully covered. */
  tailStartDate: string | null;
  tailEndDate: string | null;
  /** True when the uncovered month-end gap exceeds one pay cycle, so no tail was
   *  accrued (the employee likely terminated or their late checks aren't synced). */
  tailSuppressed: boolean;
  tailBasis: "trailing" | "annual_comp" | "none";
  reconciliationResidual: number;  // |earned − (cash − BAL + EAL)|, should be ~0
  /** Day-weighted allocation slices; components sum exactly to this bridge. */
  slices: EmployeeSlice[];
  /** On entity-grouped rows: this row's share of the employee's month (1 = whole month). */
  allocationWeight?: number;
  /** On entity-grouped rows: class % splits in effect for this row's slice. */
  classSplits?: ClassSplit[];
}

export interface EntityBridge {
  entityId: string;
  entityCode: string;
  entityName: string;
  headcount: number;
  cash: AmountTriple;
  beginningAccrued: AmountTriple;
  endingAccrued: AmountTriple;
  estimatedTail: AmountTriple;
  earnedInMonth: AmountTriple;
  overtimeHours: number;
  doubletimeHours: number;
  mealPremiums: number;
  premiumPayCost: number;
  employees: EmployeeBridge[];
}

/** Org-wide roll-up of one class's share of the month's payroll cost. */
export interface ClassBridge {
  className: string; // "Unassigned" when no class is set
  headcount: number; // distinct employees with any share in this class
  cash: AmountTriple;
  beginningAccrued: AmountTriple;
  endingAccrued: AmountTriple;
  estimatedTail: AmountTriple;
  earnedInMonth: AmountTriple;
  /** Per-entity breakdown of this class's accrual expense. */
  entities: {
    entityId: string;
    entityCode: string;
    entityName: string;
    earnedInMonth: AmountTriple;
  }[];
}

export type ExceptionKind =
  | "unmapped_cost_center"
  | "estimated_tail"
  | "long_uncovered_gap"
  | "zero_checks"
  | "allocation_changed_mid_month";

/**
 * Maximum trailing month-end days we will estimate an accrual for. A genuine
 * month-end tail is at most one pay cycle (weekly 7 / biweekly 14); a larger
 * uncovered span means the employee terminated or their late checks aren't
 * synced yet, so we accrue nothing and flag it instead of over-accruing weeks.
 */
export const MAX_TAIL_DAYS = 16;

export interface Exception {
  kind: ExceptionKind;
  employeeId: string;
  companyId: string;
  employeeName: string;
  entityCode: string;
  detail: string;
}

export interface OrgMonthlyEstimate {
  year: number;
  month: number;
  isClosedMonth: boolean;
  org: {
    cash: AmountTriple;
    beginningAccrued: AmountTriple;
    endingAccrued: AmountTriple;
    estimatedTail: AmountTriple;
    earnedInMonth: AmountTriple;
    overtimeHours: number;
    doubletimeHours: number;
    mealPremiums: number;
    premiumPayCost: number;
    headcount: number;
  };
  /** Grouped by allocated reporting entity (how costs are assigned). */
  entities: EntityBridge[];
  /** Grouped by paying entity / payroll company (how it comes out of payroll).
   *  Same org total as `entities`, partitioned differently for reconciliation. */
  payingEntities: EntityBridge[];
  /** Grouped by class (multi-class % splits applied). Same org total. */
  classes: ClassBridge[];
  exceptions: Exception[];
  reconciliation: {
    orgEqualsEntities: boolean;
    entitiesEqualEmployees: boolean;
    classesEqualOrg: boolean;
    bridgeBalances: boolean;
    maxResidual: number;
  };
}

// ─── Small money/date helpers ─────────────────────────────────────────

const ZERO: AmountTriple = { wages: 0, erTaxes: 0, erBenefits: 0 };

function addTriple(a: AmountTriple, b: AmountTriple): AmountTriple {
  return {
    wages: a.wages + b.wages,
    erTaxes: a.erTaxes + b.erTaxes,
    erBenefits: a.erBenefits + b.erBenefits,
  };
}

function subTriple(a: AmountTriple, b: AmountTriple): AmountTriple {
  return {
    wages: a.wages - b.wages,
    erTaxes: a.erTaxes - b.erTaxes,
    erBenefits: a.erBenefits - b.erBenefits,
  };
}

function scaleTriple(a: AmountTriple, f: number): AmountTriple {
  return { wages: a.wages * f, erTaxes: a.erTaxes * f, erBenefits: a.erBenefits * f };
}

function roundTriple(a: AmountTriple): AmountTriple {
  return { wages: round(a.wages), erTaxes: round(a.erTaxes), erBenefits: round(a.erBenefits) };
}

function tripleTotal(a: AmountTriple): number {
  return a.wages + a.erTaxes + a.erBenefits;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseDate(dateStr: string): Date {
  const datePart = dateStr.includes("T") ? dateStr.split("T")[0] : dateStr;
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Inclusive day count between two dates (both endpoints counted). */
function daysBetweenInclusive(start: Date, end: Date): number {
  if (end < start) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

/** Overlap in days (inclusive) of [aStart,aEnd] with [bStart,bEnd]. */
function overlapDays(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  return daysBetweenInclusive(s, e);
}

export function monthBounds(year: number, month: number): {
  mStart: Date;
  mEnd: Date;
  daysInMonth: number;
} {
  const mStart = new Date(year, month - 1, 1);
  const mEnd = new Date(year, month, 0); // day 0 of next month = last day of this month
  return { mStart, mEnd, daysInMonth: mEnd.getDate() };
}

// ─── Per-check temporal split ─────────────────────────────────────────

/**
 * Split a check's pay period into calendar-day fractions falling before /
 * inside / after the target month. The three fractions always sum to 1.
 */
export function splitCheckAcrossMonth(
  beginDate: string,
  endDate: string,
  year: number,
  month: number
): { wBefore: number; wIn: number; wAfter: number; periodDays: number } {
  const begin = parseDate(beginDate);
  const end = parseDate(endDate);
  const periodDays = daysBetweenInclusive(begin, end);
  if (periodDays <= 0) return { wBefore: 0, wIn: 0, wAfter: 0, periodDays: 0 };

  const { mStart, mEnd } = monthBounds(year, month);
  const dayBeforeMonth = new Date(mStart.getTime() - 86400000);
  const dayAfterMonth = new Date(mEnd.getTime() + 86400000);
  const farPast = new Date(1900, 0, 1);
  const farFuture = new Date(2200, 0, 1);

  const inDays = overlapDays(begin, end, mStart, mEnd);
  const beforeDays = overlapDays(begin, end, farPast, dayBeforeMonth);
  const afterDays = overlapDays(begin, end, dayAfterMonth, farFuture);

  return {
    wBefore: beforeDays / periodDays,
    wIn: inDays / periodDays,
    wAfter: afterDays / periodDays,
    periodDays,
  };
}

/**
 * Days of the target month covered by at least one check's pay period
 * (interval union — never double-counts overlapping periods), plus the last
 * covered day-of-month (0 if none). The estimated month-end tail is the
 * trailing uncovered span [lastCoveredDay+1 .. monthEnd].
 */
export function coverageInMonth(
  checks: PaycheckRow[],
  year: number,
  month: number
): { coveredDays: number; lastCoveredDay: number; uncoveredTailDays: number } {
  const { mStart, mEnd, daysInMonth } = monthBounds(year, month);
  const covered = new Array<boolean>(daysInMonth + 1).fill(false); // 1-indexed by day-of-month

  for (const c of checks) {
    const begin = parseDate(c.begin_date);
    const end = parseDate(c.end_date);
    const s = begin > mStart ? begin : mStart;
    const e = end < mEnd ? end : mEnd;
    if (e < s) continue;
    for (let d = s.getDate(); d <= e.getDate(); d++) covered[d] = true;
  }

  let coveredDays = 0;
  let lastCoveredDay = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (covered[d]) {
      coveredDays++;
      lastCoveredDay = d;
    }
  }
  const uncoveredTailDays = lastCoveredDay > 0 ? daysInMonth - lastCoveredDay : 0;
  return { coveredDays, lastCoveredDay, uncoveredTailDays };
}

// ─── Per-employee bridge ──────────────────────────────────────────────

/** A resolved (entity, department, class-mix) span of the month, pre-amounts. */
export interface SliceResolution {
  entityId: string;
  entityCode: string;
  entityName: string;
  department: string;
  weight: number;
  days: number;
  startDate: string;
  endDate: string;
  classSplits: ClassSplit[];
}

interface EntityResolution {
  effectiveEntityId: string;
  effectiveEntityCode: string;
  effectiveEntityName: string;
  department: string;
  usedCostCenterFallback: boolean;
  allocationChangedInMonth: boolean;
  /** Calendar-day slices of the month (weights sum to 1). */
  slices: SliceResolution[];
}

/**
 * Resolve an employee's effective reporting entity for the month, split into
 * calendar-day slices — one per allocation period in effect. A mid-month
 * change to company/department/class starts a new slice on its effective
 * date, so costs pro-rate by day count instead of snapping to month start.
 * Priority per slice: allocation override → cost-center default.
 * Headline entity/department fields come from the month-start slice.
 */
export function resolveEmployeeEntity(
  resolver: AllocationResolver | null,
  employeeId: string,
  companyId: string,
  costCenterCode: string | null,
  year: number,
  month: number
): EntityResolution {
  const { mStart, mEnd, daysInMonth } = monthBounds(year, month);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const ccEntry = getOperatingEntityForCostCenter(costCenterCode, companyId);
  const usedCostCenterFallback = ccEntry.department.startsWith("Unknown");

  const segments: MonthSegment[] = resolver
    ? resolver.getSegmentsForMonth(employeeId, companyId, year, month)
    : [
        {
          row: null,
          startDate: iso(mStart),
          endDate: iso(mEnd),
          days: daysInMonth,
          weight: 1,
        },
      ];

  // Resolve each segment, then merge consecutive segments whose resolved
  // (entity, department, class-mix) is identical — e.g. a period change that
  // only touched a field we don't attribute by.
  const resolved: SliceResolution[] = [];
  for (const seg of segments) {
    const entityId = seg.row?.allocated_entity_id || ccEntry.operatingEntityId;
    const entMeta = getEntityMeta(entityId);
    const slice: SliceResolution = {
      entityId,
      entityCode: entMeta.code,
      entityName: entMeta.name,
      department: seg.row?.department || ccEntry.department,
      weight: seg.weight,
      days: seg.days,
      startDate: seg.startDate,
      endDate: seg.endDate,
      classSplits: getClassSplits(seg.row),
    };
    const prev = resolved[resolved.length - 1];
    if (
      prev &&
      prev.entityId === slice.entityId &&
      prev.department === slice.department &&
      classKey(prev.classSplits) === classKey(slice.classSplits)
    ) {
      prev.days += slice.days;
      prev.weight += slice.weight;
      prev.endDate = slice.endDate;
    } else {
      resolved.push(slice);
    }
  }

  const primary = resolved[0];
  return {
    effectiveEntityId: primary.entityId,
    effectiveEntityCode: primary.entityCode,
    effectiveEntityName: primary.entityName,
    department: primary.department,
    usedCostCenterFallback,
    allocationChangedInMonth: resolved.length > 1,
    slices: resolved,
  };
}

function classKey(splits: ClassSplit[]): string {
  return splits.map((s) => `${s.className}:${s.pct.toFixed(4)}`).join("|");
}

/**
 * Distribute a rounded total across slice weights, assigning the rounding
 * residual to the last (largest-safe) piece so the pieces sum exactly.
 */
function distributeTriple(total: AmountTriple, fractions: number[]): AmountTriple[] {
  const pieces: AmountTriple[] = [];
  let acc = { ...ZERO };
  for (let i = 0; i < fractions.length; i++) {
    if (i === fractions.length - 1) {
      pieces.push(subTriple(total, acc));
    } else {
      const p = roundTriple(scaleTriple(total, fractions[i]));
      pieces.push(p);
      acc = addTriple(acc, p);
    }
  }
  return pieces;
}

function distributeNumber(total: number, fractions: number[], dp = 2): number[] {
  const f = Math.pow(10, dp);
  const pieces: number[] = [];
  let acc = 0;
  for (let i = 0; i < fractions.length; i++) {
    if (i === fractions.length - 1) {
      pieces.push(Math.round((total - acc) * f) / f);
    } else {
      const p = Math.round(total * fractions[i] * f) / f;
      pieces.push(p);
      acc += p;
    }
  }
  return pieces;
}

/**
 * Compute the accrual bridge for one employee from their checks (windowed to
 * cover the month plus its boundary spillover).
 */
export function computeEmployeeBridge(
  checks: PaycheckRow[],
  meta: EmployeeMeta,
  entity: EntityResolution,
  opts: { year: number; month: number; isClosedMonth: boolean }
): EmployeeBridge {
  const { year, month, isClosedMonth } = opts;
  const { mStart, mEnd } = monthBounds(year, month);

  let cash = { ...ZERO };
  let bal = { ...ZERO };  // beginning accrued liability = AccruedLiab(M_start-1)
  let eal = { ...ZERO };  // ending accrued liability (actual) = AccruedLiab(M_end)
  let earned = { ...ZERO }; // E_M = Σ amount * wIn
  let checkCount = 0;
  // Premium pay incurred in the month (allocated by earned-in-month fraction)
  let otHours = 0, dtHours = 0, mealCount = 0, premiumCost = 0;

  for (const c of checks) {
    const { wBefore, wIn, periodDays } = splitCheckAcrossMonth(c.begin_date, c.end_date, year, month);
    if (periodDays <= 0) continue;
    checkCount++;

    otHours += (c.overtime_hours ?? 0) * wIn;
    dtHours += (c.doubletime_hours ?? 0) * wIn;
    mealCount += (c.meal_count ?? 0) * wIn;
    premiumCost += ((c.overtime_dollars ?? 0) + (c.doubletime_dollars ?? 0) + (c.meal_dollars ?? 0)) * wIn;

    const amt: AmountTriple = {
      wages: c.gross_pay ?? 0,
      erTaxes: c.er_taxes_estimated ?? 0,
      erBenefits: c.er_benefits ?? 0,
    };
    const checkDate = parseDate(c.check_date);
    const paidBeforeMonth = checkDate < mStart;         // date <= M_start-1
    const paidThroughMonthEnd = checkDate <= mEnd;      // date <= M_end

    // earned in month
    earned = addTriple(earned, scaleTriple(amt, wIn));

    // cash paid in month (check dated in M)
    if (checkDate >= mStart && checkDate <= mEnd) cash = addTriple(cash, amt);

    // AccruedLiab(T) = earnedThrough(T) − paidThrough(T), accumulated per check
    // BAL: earned-through(M_start-1) = wBefore; paid-through(M_start-1) = full if paidBeforeMonth
    bal = addTriple(bal, scaleTriple(amt, wBefore));
    if (paidBeforeMonth) bal = subTriple(bal, amt);

    // EAL(actual): earned-through(M_end) = wBefore+wIn; paid-through(M_end) = full if paidThroughMonthEnd
    eal = addTriple(eal, scaleTriple(amt, wBefore + wIn));
    if (paidThroughMonthEnd) eal = subTriple(eal, amt);
  }

  // ── Estimated month-end tail (closed months only) ──
  const { coveredDays, lastCoveredDay, uncoveredTailDays } = coverageInMonth(checks, year, month);
  const daysInMonth = mEnd.getDate();
  let estimatedTail = { ...ZERO };
  let tailBasis: EmployeeBridge["tailBasis"] = "none";

  // ISO range of the uncovered trailing span (for display), regardless of whether
  // we book or suppress the accrual.
  let tailStartDate: string | null = null;
  let tailEndDate: string | null = null;
  if (isClosedMonth && checkCount > 0 && uncoveredTailDays > 0) {
    const pad = (n: number) => String(n).padStart(2, "0");
    tailStartDate = `${year}-${pad(month)}-${pad(lastCoveredDay + 1)}`;
    tailEndDate = `${year}-${pad(month)}-${pad(daysInMonth)}`;
  }

  // Suppress the tail when the uncovered span exceeds one pay cycle — that
  // signals a mid-month termination or un-synced late checks, not a real accrual.
  const tailSuppressed =
    isClosedMonth && checkCount > 0 && uncoveredTailDays > MAX_TAIL_DAYS;

  if (isClosedMonth && uncoveredTailDays > 0 && uncoveredTailDays <= MAX_TAIL_DAYS && checkCount > 0) {
    // Trailing earned daily wage rate from this employee's own in-month checks;
    // fall back to annual_comp / 365 when we can't derive it.
    let dailyWage = 0;
    if (coveredDays > 0 && earned.wages > 0) {
      dailyWage = earned.wages / coveredDays;
      tailBasis = "trailing";
    } else if (meta.annualComp > 0) {
      dailyWage = meta.annualComp / 365;
      tailBasis = "annual_comp";
    }

    if (dailyWage > 0) {
      const tailWages = dailyWage * uncoveredTailDays;
      // ER taxes via the canonical capped engine (never a flat rate)
      const tailTax = calculateEmployerTaxes(tailWages, meta.ytdGrossThroughMEnd).total;
      // ER benefits: trailing average daily benefit from this month's earned benefits
      const avgDailyBenefit =
        coveredDays > 0 && earned.erBenefits > 0 ? earned.erBenefits / coveredDays : 0;
      estimatedTail = {
        wages: tailWages,
        erTaxes: tailTax,
        erBenefits: avgDailyBenefit * uncoveredTailDays,
      };
    }
  }

  const endingAccruedActual = eal;
  const endingAccrued = addTriple(endingAccruedActual, estimatedTail);
  const earnedInMonth = addTriple(earned, estimatedTail);

  // Round at the output boundary
  const rCash = roundTriple(cash);
  const rBal = roundTriple(bal);
  const rEalActual = roundTriple(endingAccruedActual);
  const rTail = roundTriple(estimatedTail);
  const rEnding = roundTriple(endingAccrued);
  const rEarned = roundTriple(earnedInMonth);

  // Bridge residual on rounded figures: earned − (cash − bal + ending)
  const bridge = addTriple(subTriple(rCash, rBal), rEnding);
  const residual = Math.abs(tripleTotal(rEarned) - tripleTotal(bridge));

  // Paying/employing entity: derived purely from the payroll company id.
  const employingEntityId =
    COMPANY_EMPLOYING_ENTITY[meta.companyId] ?? entity.effectiveEntityId;
  const employingMeta = getEntityMeta(employingEntityId);

  // ── Day-weighted allocation slices ──
  // Each bridge component is distributed across the month's allocation slices
  // by calendar-day weight, with the rounding residual on the last slice so
  // slices sum exactly to the employee's bridge.
  const sliceDefs = entity.slices.length > 0 ? entity.slices : [];
  const weights = sliceDefs.map((s) => s.weight);
  const rOt = Math.round(otHours * 100) / 100;
  const rDt = Math.round(dtHours * 100) / 100;
  const rMeal = Math.round(mealCount * 10) / 10;
  const rPrem = round(premiumCost);
  const dCash = distributeTriple(rCash, weights);
  const dBal = distributeTriple(rBal, weights);
  const dEalActual = distributeTriple(rEalActual, weights);
  const dTail = distributeTriple(rTail, weights);
  const dEnding = distributeTriple(rEnding, weights);
  const dEarned = distributeTriple(rEarned, weights);
  const dOt = distributeNumber(rOt, weights);
  const dDt = distributeNumber(rDt, weights);
  const dMeal = distributeNumber(rMeal, weights, 1);
  const dPrem = distributeNumber(rPrem, weights);
  const slices: EmployeeSlice[] = sliceDefs.map((s, i) => ({
    entityId: s.entityId,
    entityCode: s.entityCode,
    entityName: s.entityName,
    department: s.department,
    weight: s.weight,
    startDate: s.startDate,
    endDate: s.endDate,
    classSplits: s.classSplits,
    cash: dCash[i],
    beginningAccrued: dBal[i],
    endingAccruedActual: dEalActual[i],
    estimatedTail: dTail[i],
    endingAccrued: dEnding[i],
    earnedInMonth: dEarned[i],
    overtimeHours: dOt[i],
    doubletimeHours: dDt[i],
    mealPremiums: dMeal[i],
    premiumPayCost: dPrem[i],
  }));

  return {
    employeeId: meta.employeeId,
    companyId: meta.companyId,
    employeeName: meta.employeeName,
    effectiveEntityId: entity.effectiveEntityId,
    effectiveEntityCode: entity.effectiveEntityCode,
    effectiveEntityName: entity.effectiveEntityName,
    employingEntityId,
    employingEntityCode: employingMeta.code,
    employingEntityName: employingMeta.name,
    department: entity.department,
    costCenterCode: meta.costCenterCode ?? "UNKNOWN",
    usedCostCenterFallback: entity.usedCostCenterFallback,
    allocationChangedInMonth: entity.allocationChangedInMonth,
    cash: rCash,
    beginningAccrued: rBal,
    endingAccruedActual: rEalActual,
    estimatedTail: rTail,
    endingAccrued: rEnding,
    earnedInMonth: rEarned,
    overtimeHours: rOt,
    doubletimeHours: rDt,
    mealPremiums: rMeal,
    premiumPayCost: rPrem,
    checkCount,
    hasZeroChecks: checkCount === 0,
    coveredDays,
    uncoveredTailDays: isClosedMonth ? uncoveredTailDays : 0,
    tailStartDate,
    tailEndDate,
    tailSuppressed,
    tailBasis,
    reconciliationResidual: round(residual),
    slices,
  };
}

// ─── Org roll-up ──────────────────────────────────────────────────────

export interface BuildInput {
  year: number;
  month: number;
  isClosedMonth: boolean;
  /** Windowed, deduped checks grouped by "employeeId:companyId". */
  checksByEmployee: Map<string, PaycheckRow[]>;
  /** Per-employee metadata keyed by "employeeId:companyId". */
  metaByEmployee: Map<string, EmployeeMeta>;
  resolver: AllocationResolver | null;
}

export function buildOrgEstimate(input: BuildInput): OrgMonthlyEstimate {
  const { year, month, isClosedMonth, checksByEmployee, metaByEmployee, resolver } = input;

  const employees: EmployeeBridge[] = [];
  for (const [key, checks] of checksByEmployee) {
    const meta = metaByEmployee.get(key);
    if (!meta) continue;
    const entity = resolveEmployeeEntity(
      resolver,
      meta.employeeId,
      meta.companyId,
      meta.costCenterCode,
      year,
      month
    );
    employees.push(computeEmployeeBridge(checks, meta, entity, { year, month, isClosedMonth }));
  }

  // Skip employees with zero activity from totals.
  const active = employees.filter((e) => !e.hasZeroChecks);

  // Group the active employees by an arbitrary entity key (allocated vs paying).
  function groupBy(
    keyFn: (e: EmployeeBridge) => { id: string; code: string; name: string }
  ): EntityBridge[] {
    const map = new Map<string, EntityBridge>();
    for (const emp of active) {
      const k = keyFn(emp);
      let ent = map.get(k.id);
      if (!ent) {
        ent = {
          entityId: k.id,
          entityCode: k.code,
          entityName: k.name,
          headcount: 0,
          cash: { ...ZERO },
          beginningAccrued: { ...ZERO },
          endingAccrued: { ...ZERO },
          estimatedTail: { ...ZERO },
          earnedInMonth: { ...ZERO },
          overtimeHours: 0,
          doubletimeHours: 0,
          mealPremiums: 0,
          premiumPayCost: 0,
          employees: [],
        };
        map.set(k.id, ent);
      }
      ent.headcount++;
      ent.cash = addTriple(ent.cash, emp.cash);
      ent.beginningAccrued = addTriple(ent.beginningAccrued, emp.beginningAccrued);
      ent.endingAccrued = addTriple(ent.endingAccrued, emp.endingAccrued);
      ent.estimatedTail = addTriple(ent.estimatedTail, emp.estimatedTail);
      ent.earnedInMonth = addTriple(ent.earnedInMonth, emp.earnedInMonth);
      ent.overtimeHours += emp.overtimeHours;
      ent.doubletimeHours += emp.doubletimeHours;
      ent.mealPremiums += emp.mealPremiums;
      ent.premiumPayCost += emp.premiumPayCost;
      ent.employees.push(emp);
    }
    return [...map.values()]
      .map((e) => ({
        ...e,
        cash: roundTriple(e.cash),
        beginningAccrued: roundTriple(e.beginningAccrued),
        endingAccrued: roundTriple(e.endingAccrued),
        estimatedTail: roundTriple(e.estimatedTail),
        earnedInMonth: roundTriple(e.earnedInMonth),
        overtimeHours: Math.round(e.overtimeHours * 100) / 100,
        doubletimeHours: Math.round(e.doubletimeHours * 100) / 100,
        mealPremiums: Math.round(e.mealPremiums * 10) / 10,
        premiumPayCost: round(e.premiumPayCost),
        employees: e.employees.sort(
          (a, b) => tripleTotal(b.earnedInMonth) - tripleTotal(a.earnedInMonth)
        ),
      }))
      .sort((a, b) => {
        const ia = ENTITY_ORDER.indexOf(a.entityId);
        const ib = ENTITY_ORDER.indexOf(b.entityId);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
  }

  // Allocated-entity grouping works on day-weighted slices so a mid-month
  // company/department change splits the employee's cost across entities.
  function groupSlicesByEntity(): EntityBridge[] {
    const map = new Map<string, EntityBridge>();
    const seenEmployees = new Map<string, Set<string>>();
    for (const emp of active) {
      for (const s of emp.slices) {
        let ent = map.get(s.entityId);
        if (!ent) {
          ent = {
            entityId: s.entityId,
            entityCode: s.entityCode,
            entityName: s.entityName,
            headcount: 0,
            cash: { ...ZERO },
            beginningAccrued: { ...ZERO },
            endingAccrued: { ...ZERO },
            estimatedTail: { ...ZERO },
            earnedInMonth: { ...ZERO },
            overtimeHours: 0,
            doubletimeHours: 0,
            mealPremiums: 0,
            premiumPayCost: 0,
            employees: [],
          };
          map.set(s.entityId, ent);
          seenEmployees.set(s.entityId, new Set());
        }
        const empKey = `${emp.employeeId}:${emp.companyId}`;
        const seen = seenEmployees.get(s.entityId)!;
        if (!seen.has(empKey)) {
          seen.add(empKey);
          ent.headcount++;
        }
        ent.cash = addTriple(ent.cash, s.cash);
        ent.beginningAccrued = addTriple(ent.beginningAccrued, s.beginningAccrued);
        ent.endingAccrued = addTriple(ent.endingAccrued, s.endingAccrued);
        ent.estimatedTail = addTriple(ent.estimatedTail, s.estimatedTail);
        ent.earnedInMonth = addTriple(ent.earnedInMonth, s.earnedInMonth);
        ent.overtimeHours += s.overtimeHours;
        ent.doubletimeHours += s.doubletimeHours;
        ent.mealPremiums += s.mealPremiums;
        ent.premiumPayCost += s.premiumPayCost;
        // Slice pseudo-row: employee-shaped, carrying this slice's amounts.
        ent.employees.push({
          ...emp,
          effectiveEntityId: s.entityId,
          effectiveEntityCode: s.entityCode,
          effectiveEntityName: s.entityName,
          department: s.department,
          cash: s.cash,
          beginningAccrued: s.beginningAccrued,
          endingAccruedActual: s.endingAccruedActual,
          estimatedTail: s.estimatedTail,
          endingAccrued: s.endingAccrued,
          earnedInMonth: s.earnedInMonth,
          overtimeHours: s.overtimeHours,
          doubletimeHours: s.doubletimeHours,
          mealPremiums: s.mealPremiums,
          premiumPayCost: s.premiumPayCost,
          allocationWeight: s.weight,
          classSplits: s.classSplits,
        });
      }
    }
    return [...map.values()]
      .map((e) => ({
        ...e,
        cash: roundTriple(e.cash),
        beginningAccrued: roundTriple(e.beginningAccrued),
        endingAccrued: roundTriple(e.endingAccrued),
        estimatedTail: roundTriple(e.estimatedTail),
        earnedInMonth: roundTriple(e.earnedInMonth),
        overtimeHours: Math.round(e.overtimeHours * 100) / 100,
        doubletimeHours: Math.round(e.doubletimeHours * 100) / 100,
        mealPremiums: Math.round(e.mealPremiums * 10) / 10,
        premiumPayCost: round(e.premiumPayCost),
        employees: e.employees.sort(
          (a, b) => tripleTotal(b.earnedInMonth) - tripleTotal(a.earnedInMonth)
        ),
      }))
      .sort((a, b) => {
        const ia = ENTITY_ORDER.indexOf(a.entityId);
        const ib = ENTITY_ORDER.indexOf(b.entityId);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });
  }

  const entities = groupSlicesByEntity();
  const payingEntities = groupBy((e) => ({
    id: e.employingEntityId,
    code: e.employingEntityCode,
    name: e.employingEntityName,
  }));

  // ── By-class roll-up (multi-class % splits applied per slice) ──
  const classMap = new Map<
    string,
    {
      bridge: ClassBridge;
      employeeKeys: Set<string>;
      entityMap: Map<string, { entityId: string; entityCode: string; entityName: string; earnedInMonth: AmountTriple }>;
    }
  >();
  for (const emp of active) {
    for (const s of emp.slices) {
      const splits: ClassSplit[] =
        s.classSplits.length > 0 ? s.classSplits : [{ className: "Unassigned", pct: 100 }];
      const fractions = splits.map((sp) => sp.pct / 100);
      const cCash = distributeTriple(s.cash, fractions);
      const cBal = distributeTriple(s.beginningAccrued, fractions);
      const cEnding = distributeTriple(s.endingAccrued, fractions);
      const cTail = distributeTriple(s.estimatedTail, fractions);
      const cEarned = distributeTriple(s.earnedInMonth, fractions);
      splits.forEach((sp, i) => {
        let entry = classMap.get(sp.className);
        if (!entry) {
          entry = {
            bridge: {
              className: sp.className,
              headcount: 0,
              cash: { ...ZERO },
              beginningAccrued: { ...ZERO },
              endingAccrued: { ...ZERO },
              estimatedTail: { ...ZERO },
              earnedInMonth: { ...ZERO },
              entities: [],
            },
            employeeKeys: new Set(),
            entityMap: new Map(),
          };
          classMap.set(sp.className, entry);
        }
        entry.employeeKeys.add(`${emp.employeeId}:${emp.companyId}`);
        entry.bridge.cash = addTriple(entry.bridge.cash, cCash[i]);
        entry.bridge.beginningAccrued = addTriple(entry.bridge.beginningAccrued, cBal[i]);
        entry.bridge.endingAccrued = addTriple(entry.bridge.endingAccrued, cEnding[i]);
        entry.bridge.estimatedTail = addTriple(entry.bridge.estimatedTail, cTail[i]);
        entry.bridge.earnedInMonth = addTriple(entry.bridge.earnedInMonth, cEarned[i]);
        let entEntry = entry.entityMap.get(s.entityId);
        if (!entEntry) {
          entEntry = {
            entityId: s.entityId,
            entityCode: s.entityCode,
            entityName: s.entityName,
            earnedInMonth: { ...ZERO },
          };
          entry.entityMap.set(s.entityId, entEntry);
        }
        entEntry.earnedInMonth = addTriple(entEntry.earnedInMonth, cEarned[i]);
      });
    }
  }
  const classes: ClassBridge[] = [...classMap.values()]
    .map(({ bridge, employeeKeys, entityMap }) => ({
      ...bridge,
      headcount: employeeKeys.size,
      cash: roundTriple(bridge.cash),
      beginningAccrued: roundTriple(bridge.beginningAccrued),
      endingAccrued: roundTriple(bridge.endingAccrued),
      estimatedTail: roundTriple(bridge.estimatedTail),
      earnedInMonth: roundTriple(bridge.earnedInMonth),
      entities: [...entityMap.values()]
        .map((e) => ({ ...e, earnedInMonth: roundTriple(e.earnedInMonth) }))
        .sort((a, b) => tripleTotal(b.earnedInMonth) - tripleTotal(a.earnedInMonth)),
    }))
    .sort((a, b) => {
      // "Unassigned" last, then by expense descending
      if (a.className === "Unassigned") return 1;
      if (b.className === "Unassigned") return -1;
      return tripleTotal(b.earnedInMonth) - tripleTotal(a.earnedInMonth);
    });

  // Org totals
  const org = {
    cash: { ...ZERO },
    beginningAccrued: { ...ZERO },
    endingAccrued: { ...ZERO },
    estimatedTail: { ...ZERO },
    earnedInMonth: { ...ZERO },
    overtimeHours: 0,
    doubletimeHours: 0,
    mealPremiums: 0,
    premiumPayCost: 0,
    headcount: 0,
  };
  for (const e of entities) {
    org.cash = addTriple(org.cash, e.cash);
    org.beginningAccrued = addTriple(org.beginningAccrued, e.beginningAccrued);
    org.endingAccrued = addTriple(org.endingAccrued, e.endingAccrued);
    org.estimatedTail = addTriple(org.estimatedTail, e.estimatedTail);
    org.earnedInMonth = addTriple(org.earnedInMonth, e.earnedInMonth);
    org.overtimeHours += e.overtimeHours;
    org.doubletimeHours += e.doubletimeHours;
    org.mealPremiums += e.mealPremiums;
    org.premiumPayCost += e.premiumPayCost;
  }
  // Distinct active employees — an employee split across entities counts once.
  org.headcount = active.length;
  org.cash = roundTriple(org.cash);
  org.beginningAccrued = roundTriple(org.beginningAccrued);
  org.endingAccrued = roundTriple(org.endingAccrued);
  org.estimatedTail = roundTriple(org.estimatedTail);
  org.earnedInMonth = roundTriple(org.earnedInMonth);
  org.overtimeHours = Math.round(org.overtimeHours * 100) / 100;
  org.doubletimeHours = Math.round(org.doubletimeHours * 100) / 100;
  org.mealPremiums = Math.round(org.mealPremiums * 10) / 10;
  org.premiumPayCost = round(org.premiumPayCost);

  // ── Exceptions ──
  const exceptions: Exception[] = [];
  for (const emp of employees) {
    const base = {
      employeeId: emp.employeeId,
      companyId: emp.companyId,
      employeeName: emp.employeeName,
      entityCode: emp.effectiveEntityCode,
    };
    if (emp.hasZeroChecks) {
      exceptions.push({ ...base, kind: "zero_checks", detail: "No checks overlap this month." });
      continue;
    }
    if (emp.usedCostCenterFallback) {
      exceptions.push({
        ...base,
        kind: "unmapped_cost_center",
        detail: `Cost center "${emp.costCenterCode}" is unmapped — fell back to ${emp.effectiveEntityCode}.`,
      });
    }
    if (emp.uncoveredTailDays > 0 && tripleTotal(emp.estimatedTail) > 0) {
      exceptions.push({
        ...base,
        kind: "estimated_tail",
        detail: `${emp.uncoveredTailDays} day(s) at month end estimated (${emp.tailBasis}) — verify no termination.`,
      });
    }
    if (emp.tailSuppressed) {
      exceptions.push({
        ...base,
        kind: "long_uncovered_gap",
        detail: `${emp.uncoveredTailDays} uncovered day(s) at month end exceed one pay cycle — NOT accrued. Verify termination or re-sync Paylocity.`,
      });
    }
    if (emp.allocationChangedInMonth) {
      const parts = emp.slices
        .map((s) => `${s.entityCode}/${s.department} ${(s.weight * 100).toFixed(0)}%`)
        .join(", ");
      exceptions.push({
        ...base,
        kind: "allocation_changed_mid_month",
        detail: `Allocation changed mid-month; cost split by calendar days (${parts}).`,
      });
    }
  }

  // ── Reconciliation ──
  const sumEntities = entities.reduce(
    (acc, e) => ({
      cash: addTriple(acc.cash, e.cash),
      earned: addTriple(acc.earned, e.earnedInMonth),
    }),
    { cash: { ...ZERO }, earned: { ...ZERO } }
  );
  const orgEqualsEntities =
    Math.abs(tripleTotal(sumEntities.earned) - tripleTotal(org.earnedInMonth)) < 0.01;

  const sumEmployees = active.reduce((acc, e) => addTriple(acc, e.earnedInMonth), { ...ZERO });
  const entitiesEqualEmployees =
    Math.abs(tripleTotal(sumEmployees) - tripleTotal(org.earnedInMonth)) < 0.01;

  const sumClasses = classes.reduce((acc, c) => addTriple(acc, c.earnedInMonth), { ...ZERO });
  const classesEqualOrg =
    Math.abs(tripleTotal(sumClasses) - tripleTotal(org.earnedInMonth)) < 0.01;

  let maxResidual = 0;
  for (const e of employees) maxResidual = Math.max(maxResidual, e.reconciliationResidual);
  // Org-level bridge residual
  const orgBridge =
    tripleTotal(org.cash) - tripleTotal(org.beginningAccrued) + tripleTotal(org.endingAccrued);
  const orgResidual = Math.abs(tripleTotal(org.earnedInMonth) - orgBridge);
  maxResidual = Math.max(maxResidual, orgResidual);
  // Tolerance scales with headcount: penny-rounding accumulates across employees,
  // so a few cents of drift is not a real imbalance (a genuine bug is dollars+).
  const bridgeBalances = maxResidual < Math.max(1, org.headcount * 0.02);

  return {
    year,
    month,
    isClosedMonth,
    org,
    entities,
    payingEntities,
    classes,
    exceptions,
    reconciliation: {
      orgEqualsEntities,
      entitiesEqualEmployees,
      classesEqualOrg,
      bridgeBalances,
      maxResidual: round(maxResidual),
    },
  };
}
