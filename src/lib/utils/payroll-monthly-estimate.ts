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
import type { AllocationResolver } from "@/lib/paylocity/allocation-resolver";
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
  employees: EmployeeBridge[];
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
    headcount: number;
  };
  /** Grouped by allocated reporting entity (how costs are assigned). */
  entities: EntityBridge[];
  /** Grouped by paying entity / payroll company (how it comes out of payroll).
   *  Same org total as `entities`, partitioned differently for reconciliation. */
  payingEntities: EntityBridge[];
  exceptions: Exception[];
  reconciliation: {
    orgEqualsEntities: boolean;
    entitiesEqualEmployees: boolean;
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

interface EntityResolution {
  effectiveEntityId: string;
  effectiveEntityCode: string;
  effectiveEntityName: string;
  department: string;
  usedCostCenterFallback: boolean;
  allocationChangedInMonth: boolean;
}

/**
 * Resolve an employee's effective reporting entity for the month.
 * Priority: allocation override (as of month start, matching monthly-costs GET)
 * → cost-center default. Flags fallback + mid-month allocation changes.
 */
export function resolveEmployeeEntity(
  resolver: AllocationResolver | null,
  employeeId: string,
  companyId: string,
  costCenterCode: string | null,
  year: number,
  month: number
): EntityResolution {
  const { mStart, mEnd } = monthBounds(year, month);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const ccEntry = getOperatingEntityForCostCenter(costCenterCode, companyId);
  const usedCostCenterFallback = ccEntry.department.startsWith("Unknown");

  const overrideStart = resolver?.getForDate(employeeId, companyId, iso(mStart)) ?? null;
  const overrideEnd = resolver?.getForDate(employeeId, companyId, iso(mEnd)) ?? null;
  const allocationChangedInMonth =
    (overrideStart?.allocated_entity_id ?? null) !== (overrideEnd?.allocated_entity_id ?? null) ||
    (overrideStart?.department ?? null) !== (overrideEnd?.department ?? null);

  const effectiveEntityId = overrideStart?.allocated_entity_id || ccEntry.operatingEntityId;
  const meta = getEntityMeta(effectiveEntityId);
  const department = overrideStart?.department || ccEntry.department;

  return {
    effectiveEntityId,
    effectiveEntityCode: meta.code,
    effectiveEntityName: meta.name,
    department,
    usedCostCenterFallback,
    allocationChangedInMonth,
  };
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

  for (const c of checks) {
    const { wBefore, wIn, periodDays } = splitCheckAcrossMonth(c.begin_date, c.end_date, year, month);
    if (periodDays <= 0) continue;
    checkCount++;

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
    checkCount,
    hasZeroChecks: checkCount === 0,
    coveredDays,
    uncoveredTailDays: isClosedMonth ? uncoveredTailDays : 0,
    tailStartDate,
    tailEndDate,
    tailSuppressed,
    tailBasis,
    reconciliationResidual: round(residual),
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

  const entities = groupBy((e) => ({
    id: e.effectiveEntityId,
    code: e.effectiveEntityCode,
    name: e.effectiveEntityName,
  }));
  const payingEntities = groupBy((e) => ({
    id: e.employingEntityId,
    code: e.employingEntityCode,
    name: e.employingEntityName,
  }));

  // Org totals
  const org = {
    cash: { ...ZERO },
    beginningAccrued: { ...ZERO },
    endingAccrued: { ...ZERO },
    estimatedTail: { ...ZERO },
    earnedInMonth: { ...ZERO },
    headcount: 0,
  };
  for (const e of entities) {
    org.cash = addTriple(org.cash, e.cash);
    org.beginningAccrued = addTriple(org.beginningAccrued, e.beginningAccrued);
    org.endingAccrued = addTriple(org.endingAccrued, e.endingAccrued);
    org.estimatedTail = addTriple(org.estimatedTail, e.estimatedTail);
    org.earnedInMonth = addTriple(org.earnedInMonth, e.earnedInMonth);
    org.headcount += e.headcount;
  }
  org.cash = roundTriple(org.cash);
  org.beginningAccrued = roundTriple(org.beginningAccrued);
  org.endingAccrued = roundTriple(org.endingAccrued);
  org.estimatedTail = roundTriple(org.estimatedTail);
  org.earnedInMonth = roundTriple(org.earnedInMonth);

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
      exceptions.push({
        ...base,
        kind: "allocation_changed_mid_month",
        detail: "Entity allocation changed mid-month; assigned by month-start allocation.",
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
    exceptions,
    reconciliation: {
      orgEqualsEntities,
      entitiesEqualEmployees,
      bridgeBalances,
      maxResidual: round(maxResidual),
    },
  };
}
