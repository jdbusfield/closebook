/**
 * Computes the unpaid-interest balance for a debt instrument as of the end
 * of a target period, using the same month-by-month, day-weighted replay
 * that drives the Unpaid Interest column on the debt detail page. This is
 * what the entity debt summary page reads to keep its Accrued Interest
 * column in sync with what the user sees on the detail page.
 *
 * The replay:
 *   - Seeds the unpaid-interest running balance from the instrument's
 *     `opening_accrued_interest` and the principal balance from
 *     `current_draw` (LOCs) or `original_amount` (term loans)
 *   - Walks forward one month at a time from `start_date`
 *   - Computes that month's accrual on the day-weighted average balance,
 *     honoring mid-month draws/paydowns recorded in `transactions`
 *   - Honors the "interest accrues the day AFTER start_date" rule — the
 *     start month's accrualDays = totalDays − startDay (start_date's day
 *     itself gets no interest)
 *   - Applies variable-rate changes from `rateHistory` (if present),
 *     falling back to the instrument's base rate otherwise
 *   - Adds `monthInterest`, subtracts interest paid that month (from
 *     transaction `to_interest` or `interest_payment` amounts), clamps at 0
 *   - Updates balance from net principal movement for the next month
 *
 * Stops once the loop reaches the target period, returning the unpaid
 * balance at that period's end. Pure — no Supabase, no React — so it can
 * be unit-tested and reused across pages.
 */

const LOC_TYPES = new Set([
  "line_of_credit",
  "revolving_credit",
  "investor_loc",
]);

export interface AccruedInterestInstrument {
  start_date: string; // ISO yyyy-mm-dd (or with time component)
  interest_rate: number; // annual, decimal
  debt_type: string;
  day_count_convention?: string | null;
  current_draw?: number | null;
  original_amount: number;
  opening_accrued_interest?: number | null;
  /**
   * Payment-in-Kind: when true, each period's accrual is computed on
   * (principal balance + running unpaid interest), so unpaid interest
   * compounds ("interest on interest") rather than accruing linearly.
   */
  is_pik?: boolean | null;
}

export interface AccruedInterestTransaction {
  effective_date: string; // ISO yyyy-mm-dd
  transaction_type: string;
  amount: number;
  to_principal: number | null;
  to_interest: number | null;
}

export interface AccruedInterestRateChange {
  effective_date: string; // ISO yyyy-mm-dd
  interest_rate: number; // annual, decimal
}

export interface AccruedInterestInput {
  instrument: AccruedInterestInstrument;
  transactions: AccruedInterestTransaction[];
  rateHistory: AccruedInterestRateChange[];
  /** End-of-period timestamp for the result. */
  targetYear: number;
  targetMonth: number; // 1-12
}

const PRINCIPAL_PAYMENT_TYPES = new Set([
  "principal_payment",
  "vehicle_payoff",
]);

function parseLocalYmd(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { year: y, month: m, day: d };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function isLeap(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Month interest factor mirroring `src/lib/utils/amortization.ts` so the
 * detail page's dynamic table and this utility share the same denominators.
 */
function monthFactor(
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
      return daysInMonth(year, month) / (isLeap(year) ? 366 : 365);
    default:
      return 1 / 12;
  }
}

export function computeUnpaidInterestAtPeriod(
  input: AccruedInterestInput
): number {
  const { instrument, transactions, rateHistory, targetYear, targetMonth } =
    input;

  const start = parseLocalYmd(instrument.start_date);
  const isLOC = LOC_TYPES.has(instrument.debt_type);

  // Before the loan starts, unpaid is just the opening accrued (there's no
  // accrual yet). If the target period predates start_date, return opening.
  const openingAccrued = Math.max(
    0,
    Number(instrument.opening_accrued_interest ?? 0)
  );
  if (
    targetYear < start.year ||
    (targetYear === start.year && targetMonth < start.month)
  ) {
    return openingAccrued;
  }

  let balance = Math.max(
    0,
    (isLOC
      ? Number(instrument.current_draw ?? instrument.original_amount)
      : Number(instrument.original_amount)) || 0
  );
  let unpaid = openingAccrued;

  const convention = instrument.day_count_convention ?? "30/360";
  const baseRate = Number(instrument.interest_rate ?? 0);

  const sortedRates = [...rateHistory].sort(
    (a, b) =>
      new Date(a.effective_date).getTime() -
      new Date(b.effective_date).getTime()
  );
  function rateFor(y: number, m: number): number {
    if (sortedRates.length === 0) return baseRate;
    const periodStart = new Date(y, m - 1, 1);
    let effective = baseRate;
    for (const rc of sortedRates) {
      if (new Date(rc.effective_date) <= periodStart) {
        effective = rc.interest_rate;
      }
    }
    return effective;
  }

  // Bucket transactions by month (using effective_date as local date).
  interface DayChange {
    day: number;
    amount: number;
  }
  const dayChangesByMonth: Record<string, DayChange[]> = {};
  const interestPaidByMonth: Record<string, number> = {};

  for (const t of transactions) {
    const ymd = parseLocalYmd(t.effective_date);
    const key = `${ymd.year}-${ymd.month}`;

    // Net principal delta for balance tracking.
    let delta = 0;
    if (t.transaction_type === "advance") {
      delta = Math.abs(t.amount);
    } else if (PRINCIPAL_PAYMENT_TYPES.has(t.transaction_type)) {
      delta = -Math.abs(Number(t.to_principal ?? t.amount) || 0);
    } else if (t.transaction_type === "payoff") {
      delta = -Math.abs(t.amount);
    }
    if (delta !== 0) {
      if (!dayChangesByMonth[key]) dayChangesByMonth[key] = [];
      dayChangesByMonth[key].push({ day: ymd.day, amount: delta });
    }

    // Interest paid (either from the explicit split or inferred from type).
    let intPaid = 0;
    if ((t.to_interest ?? 0) !== 0) {
      intPaid = Math.abs(Number(t.to_interest));
    } else if (t.transaction_type === "interest_payment") {
      intPaid = Math.abs(t.amount);
    }
    if (intPaid > 0) {
      interestPaidByMonth[key] = (interestPaidByMonth[key] ?? 0) + intPaid;
    }
  }

  // Walk month by month from start_date through the target period.
  let cy = start.year;
  let cm = start.month;
  const safetyCap = 1200; // 100-year guardrail
  for (let i = 0; i < safetyCap; i++) {
    const key = `${cy}-${cm}`;
    const rate = rateFor(cy, cm);
    const totalDays = daysInMonth(cy, cm);
    const fullFactor = monthFactor(cy, cm, convention);

    // First period: interest starts the day AFTER start_date (so a 12/31
    // start → accrualDays = 0 in December). startDay is shifted by +1.
    const isFirstPeriod = i === 0;
    const startDay = isFirstPeriod ? start.day + 1 : 1;
    const accrualDays = Math.max(0, totalDays - startDay + 1);
    const factor = isFirstPeriod
      ? fullFactor * (accrualDays / totalDays)
      : fullFactor;

    // Day-weighted average balance when mid-month draws/paydowns exist
    // (or when the first period starts mid-month).
    const dayChanges = dayChangesByMonth[key] ?? [];
    let monthInterest: number;
    if (dayChanges.length > 0 || (isFirstPeriod && startDay > 1)) {
      const sorted = [...dayChanges].sort((a, b) => a.day - b.day);
      let runBal = balance;
      let weightedSum = 0;
      let prevDay = startDay;
      for (const dc of sorted) {
        if (dc.day < startDay) continue;
        const daysAtBal = Math.max(0, dc.day - prevDay);
        weightedSum += runBal * daysAtBal;
        runBal = Math.max(0, runBal + dc.amount);
        prevDay = dc.day;
      }
      weightedSum += runBal * Math.max(0, totalDays - prevDay + 1);
      const avgBalance = accrualDays > 0 ? weightedSum / accrualDays : 0;
      monthInterest = avgBalance * rate * factor;
    } else {
      monthInterest = balance * rate * factor;
    }

    // PIK: compound this period's accrual on the unpaid balance too, so
    // the user's "unpaid interest" column grows by interest on interest.
    // Unpaid isn't day-weighted (it only changes at month boundaries).
    if (instrument.is_pik && unpaid > 0) {
      monthInterest += unpaid * rate * factor;
    }

    const intPaid = interestPaidByMonth[key] ?? 0;
    unpaid = Math.max(0, unpaid + monthInterest - intPaid);

    // Apply net balance change for next month's opening balance.
    let netChange = 0;
    for (const dc of dayChanges) netChange += dc.amount;
    balance = Math.max(0, balance + netChange);

    if (cy === targetYear && cm === targetMonth) {
      return unpaid;
    }
    if (cy > targetYear || (cy === targetYear && cm > targetMonth)) {
      return unpaid;
    }

    if (cm >= 12) {
      cy += 1;
      cm = 1;
    } else {
      cm += 1;
    }
  }

  return unpaid;
}
