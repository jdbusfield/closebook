/**
 * Personnel pricing engine: one headcount row x 12 months x cost components.
 *
 * Pure. No database access, no dates from the wall clock. Accrual basis:
 * salary / 12, hourly = rate x weekly hours x 52 / 12, both scaled by FTE.
 * Employer taxes apply their caps on cumulative calendar-year wages, so a
 * January start with a high earner front-loads tax cost the way the payroll
 * estimate does. Bonus accrues evenly (JD decision, Sep 2026).
 */
import { AssumptionSet } from "./assumption-keys";
import { getEmployerTaxTable, overridesFromAssumptions, employerTaxesOnWages, type EmployerTaxTable } from "./tax-tables";
import type { PersonnelComponent } from "./personnel-accounts";

export type CostComponent =
  | "wages"
  | "overtime"
  | "doubletime"
  | "meal"
  | "bonus"
  | "commission"
  | "other_earnings"
  | "fica_ss"
  | "medicare"
  | "futa"
  | "sui"
  | "ett"
  | "benefits"
  | "match"
  | "life_disability"
  | "workers_comp"
  | "pto"
  | "payroll_fees"
  | "recruiting"
  | "other_costs";

export const COST_COMPONENTS: CostComponent[] = [
  "wages", "overtime", "doubletime", "meal", "bonus", "commission", "other_earnings",
  "fica_ss", "medicare", "futa", "sui", "ett",
  "benefits", "match", "life_disability", "workers_comp", "pto", "payroll_fees", "recruiting", "other_costs",
];

export const COMPONENT_LABELS: Record<CostComponent, string> = {
  wages: "Base wages",
  overtime: "Overtime",
  doubletime: "Double time",
  meal: "Meal premiums",
  bonus: "Bonus",
  commission: "Commission",
  other_earnings: "Other earnings",
  fica_ss: "Social Security (ER)",
  medicare: "Medicare (ER)",
  futa: "FUTA",
  sui: "CA SUI",
  ett: "CA ETT",
  benefits: "Medical, dental, vision (ER)",
  match: "401(k) match",
  life_disability: "Life and disability",
  workers_comp: "Workers comp",
  pto: "PTO accrual",
  payroll_fees: "Payroll fees",
  recruiting: "Recruiting",
  other_costs: "Other per-head costs",
};

/** Which sub-master each component lands on. */
export const COMPONENT_TO_MASTER: Record<CostComponent, PersonnelComponent> = {
  wages: "wages",
  overtime: "overtime",
  doubletime: "overtime",
  meal: "overtime",
  bonus: "bonus_commission",
  commission: "bonus_commission",
  other_earnings: "wages",
  fica_ss: "payroll_taxes",
  medicare: "payroll_taxes",
  futa: "payroll_taxes",
  sui: "payroll_taxes",
  ett: "payroll_taxes",
  benefits: "benefits",
  match: "benefits",
  life_disability: "benefits",
  workers_comp: "workers_comp",
  pto: "pto",
  payroll_fees: "fees_other",
  recruiting: "fees_other",
  other_costs: "fees_other",
};

export interface HeadcountRowInput {
  id: string;
  name: string;
  employeeId?: string | null;
  paylocityCompanyId?: string | null;
  reportingEntityId?: string | null;
  isRequisition: boolean;
  status: "active" | "planned" | "terminated" | "excluded";
  /** Amount = a monthly sum set aside with no rate (open roles). */
  payType: "Hourly" | "Salary" | "Amount";
  baseRate: number | null;
  annualSalary: number | null;
  /** pay_type Amount: dollars per active month. */
  amountMonthly?: number | null;
  /** pay_type Amount: true = the amount is the whole cost; false = wages only, taxes and benefits added. */
  amountIsLoaded?: boolean;
  stdHoursWeek: number;
  ftePct: number;
  startMonth: number;
  endMonth: number | null;
  /** Legacy per-row merit; read as a percent adjustment when compAdj is null. */
  meritPct: number;
  meritMonth: number | null;
  /** One pay change for the year. Replaces the default merit for this row. */
  compAdj?: CompAdjustment | null;
  bonusTarget: number;
  commissionAnnual: number;
  otPct: number;
  dtPct: number;
  mealPct: number;
  otherEarningsMonthly: number;
  benefitsMonthly: number;
  matchPct: number;
  lifeDisabilityMonthly: number;
  wcClassCode: string | null;
  ptoHoursPerPeriod: number;
  otherCostsMonthly: number;
  /** [{ entity_id, pct }] summing to 100; empty = 100% to the version's RE */
  entityAllocations: Array<{ entity_id: string; pct: number }>;
  /** [{ class, pct }] summing to 100; empty = no class */
  classAllocations: Array<{ class: string; pct: number }>;
}

export interface CompAdjustment {
  /** percent = +/- % of pay; amount = +/- dollars in the pay unit ($/h or $/yr); rate = the new rate in the pay unit. */
  kind: "percent" | "amount" | "rate";
  value: number;
  /** First month the change applies (1-12). */
  month: number;
  reason?: string | null;
}

/** The row's adjustment, reading a legacy per-row merit as a percent change. */
export function effectiveCompAdj(row: Pick<HeadcountRowInput, "compAdj" | "meritPct" | "meritMonth">): CompAdjustment | null {
  if (row.compAdj && row.compAdj.value !== 0) {
    return { ...row.compAdj, month: Math.min(12, Math.max(1, row.compAdj.month || 1)) };
  }
  if (row.meritPct) return { kind: "percent", value: row.meritPct, month: Math.min(12, Math.max(1, row.meritMonth ?? 1)) };
  return null;
}

/** The same row with its adjustment removed, for pricing the baseline. */
export function withoutCompAdj(row: HeadcountRowInput): HeadcountRowInput {
  return { ...row, compAdj: null, meritPct: 0, meritMonth: null };
}

/** Monthly base wage once an adjustment is in force, as an average month. */
export function adjustedMonthlyBase(row: HeadcountRowInput, adj: CompAdjustment): number {
  const base100 = monthlyBaseWage(row);
  if (adj.kind === "percent") return base100 * (1 + adj.value / 100);
  const usesRate = row.payType === "Hourly" || (row.payType === "Salary" && !(row.annualSalary && row.annualSalary > 0));
  if (usesRate) {
    const current = row.baseRate ?? 0;
    const next = adj.kind === "rate" ? adj.value : current + adj.value;
    return monthlyBaseWage({ ...row, baseRate: Math.max(0, next) });
  }
  const current = row.annualSalary ?? 0;
  const next = adj.kind === "rate" ? adj.value : current + adj.value;
  return monthlyBaseWage({ ...row, annualSalary: Math.max(0, next) });
}

export interface PricingContext {
  year: number;
  assumptions: AssumptionSet;
  /** Share of this row that belongs to the version's reporting entity (0-1). */
  reShare?: number;
}

export type MonthlyAmounts = number[]; // index 0 = January

export interface PricedPosition {
  rowId: string;
  name: string;
  /** Component -> 12 monthly amounts, already scaled by reShare. */
  components: Record<CostComponent, MonthlyAmounts>;
  /** Sum of every component per month. */
  totalByMonth: MonthlyAmounts;
  /** Annual total. */
  total: number;
  /** Annual total per component. */
  componentTotals: Record<CostComponent, number>;
  /** Wages base per month before OT (for the bridge). */
  baseWagesByMonth: MonthlyAmounts;
  activeMonths: number;
  reShare: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function zeros(): MonthlyAmounts {
  return new Array(12).fill(0);
}

function emptyComponents(): Record<CostComponent, MonthlyAmounts> {
  const out = {} as Record<CostComponent, MonthlyAmounts>;
  for (const c of COST_COMPONENTS) out[c] = zeros();
  return out;
}

export type MonthBasis = "flat" | "working_days" | "calendar_days";

export function monthBasisFromAssumption(value: number): MonthBasis {
  if (value === 2) return "calendar_days";
  if (value === 0) return "flat";
  return "working_days";
}

/**
 * Twelve factors that average to 1, so multiplying an average month by its
 * factor spreads the same annual amount across months in proportion to their
 * working days (Monday to Friday) or calendar days. Flat returns all ones.
 */
export function monthWeights(year: number, basis: MonthBasis): number[] {
  if (basis === "flat") return new Array(12).fill(1);
  const counts: number[] = [];
  for (let m = 0; m < 12; m++) {
    const days = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    if (basis === "calendar_days") {
      counts.push(days);
      continue;
    }
    let weekdays = 0;
    for (let d = 1; d <= days; d++) {
      const dow = new Date(Date.UTC(year, m, d)).getUTCDay();
      if (dow !== 0 && dow !== 6) weekdays++;
    }
    counts.push(weekdays);
  }
  const total = counts.reduce((t, v) => t + v, 0);
  return counts.map((c) => (c * 12) / total);
}

/** Monthly base wages at 100% FTE before merit, as an average month. */
export function monthlyBaseWage(row: Pick<HeadcountRowInput, "payType" | "baseRate" | "annualSalary" | "stdHoursWeek">): number {
  if (row.payType === "Salary") {
    if (row.annualSalary && row.annualSalary > 0) return row.annualSalary / 12;
    // Salaried rows sometimes only carry an hourly-equivalent rate
    if (row.baseRate && row.baseRate > 0) return (row.baseRate * (row.stdHoursWeek || 40) * 52) / 12;
    return 0;
  }
  if (row.baseRate && row.baseRate > 0) return (row.baseRate * (row.stdHoursWeek || 40) * 52) / 12;
  if (row.annualSalary && row.annualSalary > 0) return row.annualSalary / 12;
  return 0;
}

export function buildTaxTable(ctx: PricingContext, companyId?: string | null): EmployerTaxTable {
  const a = ctx.assumptions;
  const companyScope = companyId ? [{ scope: "company", scopeId: companyId }] : [];
  const pct = (key: string) => a.get(key, companyScope) / 100;
  return getEmployerTaxTable(ctx.year, companyId, overridesFromAssumptions({
    fica_wage_base: a.get("fica_wage_base"),
    fica_rate: pct("fica_rate"),
    medicare_rate: pct("medicare_rate"),
    futa_rate: pct("futa_rate"),
    futa_cap: a.get("futa_cap"),
    sui_rate: pct("sui_rate"),
    sui_cap: a.get("sui_cap"),
    ett_rate: pct("ett_rate"),
    ett_cap: a.get("ett_cap"),
  }));
}

/**
 * Prices one position for the budget year. Months outside
 * [startMonth, endMonth] are zero. Excluded rows price to zero.
 */
export function pricePosition(row: HeadcountRowInput, ctx: PricingContext): PricedPosition {
  const components = emptyComponents();
  const baseWagesByMonth = zeros();
  const reShare = ctx.reShare ?? 1;
  const a = ctx.assumptions;
  const scopes = [
    ...(row.employeeId ? [{ scope: "employee", scopeId: `${row.paylocityCompanyId ?? ""}:${row.employeeId}` }] : []),
    ...(row.reportingEntityId ? [{ scope: "reporting_entity", scopeId: row.reportingEntityId }] : []),
    ...(row.paylocityCompanyId ? [{ scope: "company", scopeId: row.paylocityCompanyId }] : []),
  ];
  const companyScopes = row.paylocityCompanyId ? [{ scope: "company", scopeId: row.paylocityCompanyId }] : [];

  const active = row.status !== "excluded" && row.status !== "terminated";
  const startMonth = Math.min(12, Math.max(1, row.startMonth || 1));
  const endMonth = row.endMonth ? Math.min(12, Math.max(startMonth, row.endMonth)) : 12;
  const fte = Math.max(0, (row.ftePct ?? 100) / 100);

  // A row-level adjustment replaces the default merit; otherwise the default applies.
  const compAdj = effectiveCompAdj(row);
  const meritPct = compAdj ? 0 : a.get("merit_pct_default", scopes);
  const meritMonth = a.get("merit_month_default", scopes);
  const isAmount = row.payType === "Amount";
  const amountLoaded = isAmount && row.amountIsLoaded !== false;
  const amountMonthly = isAmount ? Math.max(0, row.amountMonthly ?? 0) : 0;

  const taxTable = buildTaxTable(ctx, row.paylocityCompanyId);
  const periodsPerYear = a.get("pay_periods_per_year", companyScopes) || 26;
  const checksPerMonth = periodsPerYear / 12;
  const feePerCheck = a.get("payroll_fee_per_check", companyScopes);
  const feePerEmployeeMonth = a.get("payroll_fee_per_employee_month", companyScopes);
  const renewalPct = a.get("benefit_renewal_pct", scopes) / 100;
  const renewalMonth = a.get("benefit_renewal_month", companyScopes);
  const waitingMonths = a.get("benefits_waiting_months");
  const newHireBenefits = a.get("new_hire_benefits_monthly", scopes);
  const wcRate = row.wcClassCode
    ? a.get("wc_rate", [{ scope: "org", scopeId: row.wcClassCode }]) || a.get("wc_rate_default", scopes)
    : a.get("wc_rate_default", scopes);
  const wcMod = a.get("wc_experience_mod", companyScopes) || 1;
  const bonusAccrual = a.get("bonus_accrual") !== 0;
  const bonusPayoutMonth = a.get("bonus_payout_month");
  const ptoHoursPerPeriod = row.ptoHoursPerPeriod || a.get("pto_accrual_hours_per_period", scopes);
  const recruiting = row.isRequisition ? a.get("recruiting_cost_per_hire", scopes) : 0;

  const base100 = isAmount ? amountMonthly : monthlyBaseWage(row);
  const adjustedBase100 = compAdj && !isAmount ? adjustedMonthlyBase(row, compAdj) : base100;
  // An amount per month is what was asked for each month; rates spread by the month basis.
  const weights = isAmount ? new Array(12).fill(1) : monthWeights(ctx.year, monthBasisFromAssumption(a.get("wage_month_basis")));
  const hourlyEquivalent = amountLoaded
    ? 0
    : row.payType === "Hourly" && row.baseRate
      ? row.baseRate
      : base100 > 0 ? (base100 * 12) / ((row.stdHoursWeek || 40) * 52) : 0;

  let ytdTaxable = 0;
  let activeMonths = 0;

  for (let m = 1; m <= 12; m++) {
    const i = m - 1;
    if (!active || m < startMonth || m > endMonth) continue;
    activeMonths++;

    const meritFactor = meritPct && m >= meritMonth ? 1 + meritPct / 100 : 1;
    const monthBase100 = compAdj && m >= compAdj.month ? adjustedBase100 : base100;
    // Weighted by the month's working or calendar days (assumption wage_month_basis)
    const base = monthBase100 * fte * meritFactor * weights[i];
    baseWagesByMonth[i] = base;

    if (amountLoaded) {
      // The amount is the whole cost: it lands on wages and nothing is added.
      components.wages[i] = round2(base * reShare);
      components.other_costs[i] = round2(row.otherCostsMonthly * reShare);
      continue;
    }

    const overtime = base * (row.otPct / 100);
    const doubletime = base * (row.dtPct / 100);
    const meal = base * (row.mealPct / 100);
    const bonus = bonusAccrual
      ? row.bonusTarget / 12
      : m === bonusPayoutMonth ? row.bonusTarget : 0;
    const commission = row.commissionAnnual / 12;
    const otherEarnings = row.otherEarningsMonthly;
    const taxable = base + overtime + doubletime + meal + bonus + commission + otherEarnings;

    const taxes = employerTaxesOnWages(taxable, ytdTaxable, taxTable);
    ytdTaxable += taxable;

    const monthsSinceStart = m - startMonth;
    const benefitsEligible = !row.isRequisition || monthsSinceStart >= waitingMonths;
    const benefitBase = row.isRequisition && row.benefitsMonthly === 0 ? newHireBenefits : row.benefitsMonthly;
    const benefits = benefitsEligible ? benefitBase * (m >= renewalMonth ? 1 + renewalPct : 1) : 0;
    const match = taxable * (row.matchPct / 100);
    const lifeDisability = benefitsEligible ? row.lifeDisabilityMonthly : 0;
    const workersComp = ((base + overtime + doubletime + meal + bonus + commission + otherEarnings) / 100) * wcRate * wcMod;
    const adjFactor = base100 > 0 ? monthBase100 / base100 : 1;
    const pto = ptoHoursPerPeriod * checksPerMonth * hourlyEquivalent * meritFactor * adjFactor * fte;
    const fees = feePerCheck * checksPerMonth + feePerEmployeeMonth;
    const recruit = m === startMonth ? recruiting : 0;

    const set = (c: CostComponent, v: number) => {
      components[c][i] = round2(v * reShare);
    };
    set("wages", base);
    set("overtime", overtime);
    set("doubletime", doubletime);
    set("meal", meal);
    set("bonus", bonus);
    set("commission", commission);
    set("other_earnings", otherEarnings);
    set("fica_ss", taxes.breakdown.FICA_SS ?? 0);
    set("medicare", taxes.breakdown.MEDICARE ?? 0);
    set("futa", taxes.breakdown.FUTA ?? 0);
    set("sui", taxes.breakdown.CA_SUI ?? 0);
    set("ett", taxes.breakdown.CA_ETT ?? 0);
    set("benefits", benefits);
    set("match", match);
    set("life_disability", lifeDisability);
    set("workers_comp", workersComp);
    set("pto", pto);
    set("payroll_fees", fees);
    set("recruiting", recruit);
    set("other_costs", row.otherCostsMonthly);
  }

  const totalByMonth = zeros();
  const componentTotals = {} as Record<CostComponent, number>;
  let total = 0;
  for (const c of COST_COMPONENTS) {
    let ct = 0;
    for (let i = 0; i < 12; i++) {
      totalByMonth[i] = round2(totalByMonth[i] + components[c][i]);
      ct += components[c][i];
    }
    componentTotals[c] = round2(ct);
    total += ct;
  }

  return {
    rowId: row.id,
    name: row.name,
    components,
    totalByMonth,
    total: round2(total),
    componentTotals,
    baseWagesByMonth: baseWagesByMonth.map((v) => round2(v * reShare)),
    activeMonths,
    reShare,
  };
}

/** Sums priced positions per component per month. */
export function sumPositions(positions: PricedPosition[]): {
  components: Record<CostComponent, MonthlyAmounts>;
  totalByMonth: MonthlyAmounts;
  total: number;
} {
  const components = emptyComponents();
  const totalByMonth = zeros();
  let total = 0;
  for (const p of positions) {
    for (const c of COST_COMPONENTS) {
      for (let i = 0; i < 12; i++) components[c][i] = round2(components[c][i] + p.components[c][i]);
    }
    for (let i = 0; i < 12; i++) totalByMonth[i] = round2(totalByMonth[i] + p.totalByMonth[i]);
    total += p.total;
  }
  return { components, totalByMonth, total: round2(total) };
}

/**
 * Share of a row that belongs to a reporting entity: the sum of entity
 * allocation percentages for the RE's member entities. Rows with no
 * allocations belong wholly to the version they sit in.
 */
export function reportingEntityShare(
  row: Pick<HeadcountRowInput, "entityAllocations">,
  memberEntityIds: Set<string>,
): number {
  const allocs = row.entityAllocations ?? [];
  if (allocs.length === 0) return 1;
  const total = allocs.reduce((t, a) => t + Number(a.pct || 0), 0);
  if (total <= 0) return 1;
  const share = allocs.filter((a) => memberEntityIds.has(a.entity_id)).reduce((t, a) => t + Number(a.pct || 0), 0);
  return share / total;
}
