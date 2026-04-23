// Amortization calculation engine for debt instruments
// Supports: term loans, LOCs/revolving credit, balloon loans, mortgages, equipment loans
// Features: variable rates, day count conventions, payment structures, current/LT split

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface DebtForAmortization {
  debt_type: string;
  original_amount: number;
  interest_rate: number; // current annual rate as decimal (e.g. 0.065 = 6.5%)
  term_months: number | null;
  start_date: string; // ISO date
  maturity_date?: string | null;
  payment_amount: number | null;
  payment_structure?: string; // "principal_and_interest" | "interest_only" | "balloon" | "revolving" | "custom"
  day_count_convention?: string; // "30/360" | "actual/360" | "actual/365" | "actual/actual"
  credit_limit: number | null;
  current_draw: number | null;
  balloon_amount?: number | null;
  balloon_date?: string | null;
  rate_type?: string; // "fixed" | "variable" | "adjustable"
  is_pik?: boolean; // Payment-in-Kind: interest capitalizes to balance (compounds) instead of cash payment
}

export interface RateChange {
  effective_date: string; // ISO date
  interest_rate: number; // annual rate as decimal
}

export interface AmortizationEntry {
  period_year: number;
  period_month: number;
  beginning_balance: number;
  payment: number;
  principal: number;
  interest: number;
  ending_balance: number;
  interest_rate: number; // rate used for this period
  fees: number;
  cumulative_principal: number;
  cumulative_interest: number;
}

export interface AmortizationSummary {
  total_payments: number;
  total_principal: number;
  total_interest: number;
  total_fees: number;
  current_portion: number;
  long_term_portion: number;
  weighted_avg_rate: number;
  remaining_term_months: number;
}

// ---------------------------------------------------------------------------
// Day Count Conventions
// ---------------------------------------------------------------------------

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
}

/**
 * Calculate the interest factor for a period based on the day count convention.
 */
export function interestFactor(
  year: number,
  month: number,
  convention: string
): number {
  switch (convention) {
    case "30/360":
      return 30 / 360;
    case "actual/360":
      return daysInMonth(year, month) / 360;
    case "actual/365":
      return daysInMonth(year, month) / 365;
    case "actual/actual":
      return daysInMonth(year, month) / daysInYear(year);
    default:
      return 1 / 12;
  }
}

// ---------------------------------------------------------------------------
// Monthly Payment Calculation
// ---------------------------------------------------------------------------

function parseDate(dateStr: string): { year: number; month: number } {
  const d = new Date(dateStr);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/**
 * Calculate the fixed monthly payment for a term loan using the standard
 * amortization formula: M = P * [r(1+r)^n] / [(1+r)^n - 1]
 */
export function calculateMonthlyPayment(
  principal: number,
  annualRate: number,
  termMonths: number
): number {
  if (principal <= 0 || termMonths <= 0) return 0;
  if (annualRate <= 0) {
    return Math.round((principal / termMonths) * 100) / 100;
  }

  const r = annualRate / 12;
  const factor = Math.pow(1 + r, termMonths);
  const payment = principal * (r * factor) / (factor - 1);
  return Math.round(payment * 100) / 100;
}

// ---------------------------------------------------------------------------
// Rate Lookup
// ---------------------------------------------------------------------------

function getRateForPeriod(
  baseRate: number,
  year: number,
  month: number,
  rateChanges: RateChange[]
): number {
  if (rateChanges.length === 0) return baseRate;

  const periodStart = new Date(year, month - 1, 1);
  let effectiveRate = baseRate;

  for (const change of rateChanges) {
    const changeDate = new Date(change.effective_date);
    if (changeDate <= periodStart) {
      effectiveRate = change.interest_rate;
    }
  }

  return effectiveRate;
}

// ---------------------------------------------------------------------------
// Schedule Generation
// ---------------------------------------------------------------------------

/**
 * Generate the full amortization schedule for a debt instrument.
 * Supports all payment structures and variable rates.
 */
export function generateAmortizationSchedule(
  debt: DebtForAmortization,
  throughYear: number,
  throughMonth: number,
  rateChanges: RateChange[] = []
): AmortizationEntry[] {
  const sortedRates = [...rateChanges].sort(
    (a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime()
  );

  // PIK overrides the payment structure: interest capitalizes each period,
  // no cash service, full accrued balance due at maturity.
  if (debt.is_pik) {
    return generatePIKSchedule(debt, throughYear, throughMonth, sortedRates);
  }

  const structure = debt.payment_structure ?? "principal_and_interest";

  switch (structure) {
    case "interest_only":
      return generateInterestOnlySchedule(debt, throughYear, throughMonth, sortedRates);
    case "balloon":
      return generateBalloonSchedule(debt, throughYear, throughMonth, sortedRates);
    case "revolving":
      return generateInterestOnlySchedule(debt, throughYear, throughMonth, sortedRates);
    case "principal_and_interest":
    default:
      // For LOC types without explicit structure, default to interest-only
      if (["line_of_credit", "revolving_credit"].includes(debt.debt_type)) {
        return generateInterestOnlySchedule(debt, throughYear, throughMonth, sortedRates);
      }
      return generatePISchedule(debt, throughYear, throughMonth, sortedRates);
  }
}

/**
 * Payment-in-Kind schedule — interest accrues and is capitalized into the
 * balance each period ("interest on interest"). No cash payments during the
 * term. At maturity, the full compounded balance is due as a bullet.
 */
function generatePIKSchedule(
  debt: DebtForAmortization,
  throughYear: number,
  throughMonth: number,
  rateChanges: RateChange[]
): AmortizationEntry[] {
  const entries: AmortizationEntry[] = [];
  const start = parseDate(debt.start_date);
  const convention = debt.day_count_convention ?? "30/360";
  const termMonths = debt.term_months ?? 120;

  let balance = debt.current_draw ?? debt.original_amount;
  if (balance <= 0) return entries;

  let cy = start.year;
  let cm = start.month;
  let cumPrincipal = 0;
  let cumInterest = 0;

  let matYear: number | null = null;
  let matMonth: number | null = null;
  if (debt.maturity_date) {
    const mat = parseDate(debt.maturity_date);
    matYear = mat.year;
    matMonth = mat.month;
  }

  for (let i = 0; i < termMonths; i++) {
    if (cy > throughYear || (cy === throughYear && cm > throughMonth)) break;

    const rate = getRateForPeriod(debt.interest_rate, cy, cm, rateChanges);
    const factor = interestFactor(cy, cm, convention);
    const interest = round2(balance * rate * factor);

    const isMaturityPeriod =
      (matYear !== null && cy === matYear && cm === matMonth) ||
      (matYear === null && i === termMonths - 1);

    let payment: number;
    let principal: number;
    let endingBalance: number;

    if (isMaturityPeriod) {
      // Bullet payoff: entire accrued balance + final period interest
      principal = round2(balance);
      payment = round2(balance + interest);
      endingBalance = 0;
    } else {
      // Capitalize: interest added to balance, no cash movement
      principal = 0;
      payment = 0;
      endingBalance = round2(balance + interest);
    }

    cumPrincipal += principal;
    cumInterest += interest;

    entries.push({
      period_year: cy,
      period_month: cm,
      beginning_balance: round2(balance),
      payment,
      principal,
      interest,
      ending_balance: endingBalance,
      interest_rate: rate,
      fees: 0,
      cumulative_principal: round2(cumPrincipal),
      cumulative_interest: round2(cumInterest),
    });

    if (endingBalance <= 0) break;
    balance = endingBalance;
    ({ year: cy, month: cm } = advanceMonth(cy, cm));
  }

  return entries;
}

/**
 * Standard Principal & Interest (fully amortizing) schedule.
 */
function generatePISchedule(
  debt: DebtForAmortization,
  throughYear: number,
  throughMonth: number,
  rateChanges: RateChange[]
): AmortizationEntry[] {
  const entries: AmortizationEntry[] = [];
  const start = parseDate(debt.start_date);
  const termMonths = debt.term_months ?? 60;
  const convention = debt.day_count_convention ?? "30/360";

  let balance = debt.original_amount;
  let cy = start.year;
  let cm = start.month;
  let cumPrincipal = 0;
  let cumInterest = 0;

  let lastRate = debt.interest_rate;
  let remainingTerm = termMonths;
  let monthlyPayment =
    debt.payment_amount ?? calculateMonthlyPayment(balance, lastRate, remainingTerm);

  for (let i = 0; i < termMonths; i++) {
    if (cy > throughYear || (cy === throughYear && cm > throughMonth)) break;
    if (balance <= 0.005) break;

    const rate = getRateForPeriod(debt.interest_rate, cy, cm, rateChanges);

    // Recalculate payment if rate changed (variable rate re-amortization)
    if (rate !== lastRate && !debt.payment_amount) {
      remainingTerm = termMonths - i;
      monthlyPayment = calculateMonthlyPayment(balance, rate, remainingTerm);
      lastRate = rate;
    }

    const factor = interestFactor(cy, cm, convention);
    const interest = round2(balance * rate * factor);
    const payment = Math.min(monthlyPayment, balance + interest);
    const principal = round2(payment - interest);
    const endingBalance = round2(Math.max(0, balance - principal));

    cumPrincipal += principal;
    cumInterest += interest;

    entries.push({
      period_year: cy,
      period_month: cm,
      beginning_balance: round2(balance),
      payment: round2(payment),
      principal,
      interest,
      ending_balance: endingBalance,
      interest_rate: rate,
      fees: 0,
      cumulative_principal: round2(cumPrincipal),
      cumulative_interest: round2(cumInterest),
    });

    balance = endingBalance;
    ({ year: cy, month: cm } = advanceMonth(cy, cm));
  }

  return entries;
}

/**
 * Interest-Only schedule — only interest is paid each period, principal at maturity.
 */
function generateInterestOnlySchedule(
  debt: DebtForAmortization,
  throughYear: number,
  throughMonth: number,
  rateChanges: RateChange[]
): AmortizationEntry[] {
  const entries: AmortizationEntry[] = [];
  const start = parseDate(debt.start_date);
  const balance = debt.current_draw ?? debt.original_amount;
  const convention = debt.day_count_convention ?? "30/360";

  if (balance <= 0) return entries;

  let cy = start.year;
  let cm = start.month;
  let cumPrincipal = 0;
  let cumInterest = 0;

  const maxPeriods = debt.term_months ?? 120;

  for (let i = 0; i < maxPeriods; i++) {
    if (cy > throughYear || (cy === throughYear && cm > throughMonth)) break;

    const rate = getRateForPeriod(debt.interest_rate, cy, cm, rateChanges);
    const factor = interestFactor(cy, cm, convention);
    const interest = round2(balance * rate * factor);

    // Check if this is the maturity month
    let principal = 0;
    let endingBalance = balance;
    if (debt.maturity_date) {
      const mat = parseDate(debt.maturity_date);
      if (cy === mat.year && cm === mat.month) {
        principal = balance;
        endingBalance = 0;
      }
    }

    const payment = round2(interest + principal);
    cumPrincipal += principal;
    cumInterest += interest;

    entries.push({
      period_year: cy,
      period_month: cm,
      beginning_balance: round2(balance),
      payment,
      principal,
      interest,
      ending_balance: round2(endingBalance),
      interest_rate: rate,
      fees: 0,
      cumulative_principal: round2(cumPrincipal),
      cumulative_interest: round2(cumInterest),
    });

    if (endingBalance <= 0) break;
    ({ year: cy, month: cm } = advanceMonth(cy, cm));
  }

  return entries;
}

/**
 * Balloon schedule — regular P&I payments with a large balloon at maturity.
 */
function generateBalloonSchedule(
  debt: DebtForAmortization,
  throughYear: number,
  throughMonth: number,
  rateChanges: RateChange[]
): AmortizationEntry[] {
  const entries: AmortizationEntry[] = [];
  const start = parseDate(debt.start_date);
  const termMonths = debt.term_months ?? 60;
  const convention = debt.day_count_convention ?? "30/360";

  let balance = debt.original_amount;
  let cy = start.year;
  let cm = start.month;
  let cumPrincipal = 0;
  let cumInterest = 0;

  const monthlyPayment =
    debt.payment_amount ?? calculateMonthlyPayment(balance, debt.interest_rate, termMonths);

  for (let i = 0; i < termMonths; i++) {
    if (cy > throughYear || (cy === throughYear && cm > throughMonth)) break;
    if (balance <= 0.005) break;

    const rate = getRateForPeriod(debt.interest_rate, cy, cm, rateChanges);
    const factor = interestFactor(cy, cm, convention);
    const interest = round2(balance * rate * factor);

    const isLastPeriod = i === termMonths - 1;
    let payment: number;
    let principal: number;

    if (isLastPeriod) {
      principal = balance;
      payment = round2(principal + interest);
    } else {
      payment = Math.min(monthlyPayment, balance + interest);
      principal = round2(payment - interest);
    }

    const endingBalance = round2(Math.max(0, balance - principal));

    cumPrincipal += principal;
    cumInterest += interest;

    entries.push({
      period_year: cy,
      period_month: cm,
      beginning_balance: round2(balance),
      payment: round2(payment),
      principal,
      interest,
      ending_balance: endingBalance,
      interest_rate: rate,
      fees: 0,
      cumulative_principal: round2(cumPrincipal),
      cumulative_interest: round2(cumInterest),
    });

    balance = endingBalance;
    ({ year: cy, month: cm } = advanceMonth(cy, cm));
  }

  return entries;
}

// ---------------------------------------------------------------------------
// What-If Amortization Table
// ---------------------------------------------------------------------------

export interface WhatIfParams {
  principal: number;
  annualRate: number;
  termMonths: number;
  startDate: string;
  paymentStructure?: string;
  dayCountConvention?: string;
}

/**
 * Generate a what-if amortization table for scenario analysis.
 */
export function generateWhatIfSchedule(params: WhatIfParams): AmortizationEntry[] {
  const debt: DebtForAmortization = {
    debt_type: "term_loan",
    original_amount: params.principal,
    interest_rate: params.annualRate,
    term_months: params.termMonths,
    start_date: params.startDate,
    maturity_date: null,
    payment_amount: null,
    payment_structure: params.paymentStructure ?? "principal_and_interest",
    day_count_convention: params.dayCountConvention ?? "30/360",
    credit_limit: null,
    current_draw: params.principal,
    balloon_amount: null,
    balloon_date: null,
    rate_type: "fixed",
  };

  const start = parseDate(params.startDate);
  let endYear = start.year + Math.floor((start.month + params.termMonths - 1) / 12);
  let endMonth = ((start.month + params.termMonths - 1) % 12) + 1;
  if (endMonth === 0) { endMonth = 12; endYear--; }

  return generateAmortizationSchedule(debt, endYear, endMonth);
}

// ---------------------------------------------------------------------------
// Current / Long-Term Portion Split
// ---------------------------------------------------------------------------

/**
 * Calculate the current (within 12 months) and long-term portions of debt.
 */
export function calculateCurrentLongTermSplit(
  schedule: AmortizationEntry[],
  asOfYear: number,
  asOfMonth: number
): { current: number; longTerm: number } {
  const asOfEntry = schedule.find(
    (e) => e.period_year === asOfYear && e.period_month === asOfMonth
  );
  if (!asOfEntry) {
    return { current: 0, longTerm: 0 };
  }

  const currentBalance = asOfEntry.ending_balance;
  let futureYear = asOfYear;
  let futureMonth = asOfMonth;
  let currentPortion = 0;

  for (let i = 0; i < 12; i++) {
    ({ year: futureYear, month: futureMonth } = advanceMonth(futureYear, futureMonth));
    const entry = schedule.find(
      (e) => e.period_year === futureYear && e.period_month === futureMonth
    );
    if (entry) {
      currentPortion += entry.principal;
    }
  }

  currentPortion = round2(Math.min(currentPortion, currentBalance));
  const longTerm = round2(currentBalance - currentPortion);

  return { current: currentPortion, longTerm };
}

// ---------------------------------------------------------------------------
// Schedule Summary
// ---------------------------------------------------------------------------

export function summarizeSchedule(
  schedule: AmortizationEntry[],
  asOfYear?: number,
  asOfMonth?: number
): AmortizationSummary {
  if (schedule.length === 0) {
    return {
      total_payments: 0,
      total_principal: 0,
      total_interest: 0,
      total_fees: 0,
      current_portion: 0,
      long_term_portion: 0,
      weighted_avg_rate: 0,
      remaining_term_months: 0,
    };
  }

  const totalPayments = schedule.reduce((s, e) => s + e.payment, 0);
  const totalPrincipal = schedule.reduce((s, e) => s + e.principal, 0);
  const totalInterest = schedule.reduce((s, e) => s + e.interest, 0);
  const totalFees = schedule.reduce((s, e) => s + e.fees, 0);

  const totalBalanceWeight = schedule.reduce((s, e) => s + e.beginning_balance, 0);
  const weightedRate = totalBalanceWeight > 0
    ? schedule.reduce((s, e) => s + e.interest_rate * e.beginning_balance, 0) / totalBalanceWeight
    : 0;

  const year = asOfYear ?? schedule[schedule.length - 1].period_year;
  const month = asOfMonth ?? schedule[schedule.length - 1].period_month;
  const { current, longTerm } = calculateCurrentLongTermSplit(schedule, year, month);

  const asOfIdx = schedule.findIndex(
    (e) => e.period_year === year && e.period_month === month
  );
  const remainingTerm = asOfIdx >= 0 ? schedule.length - asOfIdx - 1 : 0;

  return {
    total_payments: round2(totalPayments),
    total_principal: round2(totalPrincipal),
    total_interest: round2(totalInterest),
    total_fees: round2(totalFees),
    current_portion: current,
    long_term_portion: longTerm,
    weighted_avg_rate: round2(weightedRate * 10000) / 10000,
    remaining_term_months: remainingTerm,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function advanceMonth(year: number, month: number): { year: number; month: number } {
  if (month >= 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}
