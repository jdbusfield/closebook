/**
 * Pure roll-forward computation for the org-level debt dashboard.
 *
 * Given the set of debt instruments in scope and the transactions that touch
 * them, produce a typed breakdown of activity for a [start, end] window:
 *
 *   beginning balance
 *    + draws / advances
 *    − principal paid (scheduled)
 *    − vehicle payoffs  (unit sold, proceeds paid down the LOC)
 *    − payoffs          (instrument fully closed)
 *    ± adjustments / reversals / note renewals
 *   = ending balance
 *
 *   plus cash paid: interest + fees
 *
 * Every methodology corresponds 1:1 to a transaction_type value so the
 * dashboard vocabulary matches the Add Transaction dropdown exactly.
 *
 * This file is pure (no Supabase / React / DOM). That keeps the math
 * unit-testable and reusable between the screen, Excel, and PDF outputs.
 */

export type DebtTransactionType =
  | "advance"
  | "principal_payment"
  | "interest_payment"
  | "fee_payment"
  | "late_fee"
  | "misc_fee"
  | "origination_fee"
  | "annual_fee"
  | "payment_reversal"
  | "note_renewal"
  | "vehicle_payoff"
  | "payoff"
  | "adjustment";

export type DebtStatus = "active" | "paid_off" | "inactive";

export type MethodologyBucket =
  | "draws"
  | "principal_payments"
  | "vehicle_payoffs"
  | "payoffs"
  | "interest_payments"
  | "fees"
  | "adjustments"
  | "reversals"
  | "note_renewals";

/** Maps each transaction_type to the methodology bucket it rolls up into. */
export const TRANSACTION_TYPE_TO_BUCKET: Record<
  DebtTransactionType,
  MethodologyBucket
> = {
  advance: "draws",
  principal_payment: "principal_payments",
  vehicle_payoff: "vehicle_payoffs",
  payoff: "payoffs",
  interest_payment: "interest_payments",
  fee_payment: "fees",
  late_fee: "fees",
  misc_fee: "fees",
  origination_fee: "fees",
  annual_fee: "fees",
  adjustment: "adjustments",
  payment_reversal: "reversals",
  note_renewal: "note_renewals",
};

/** Human-readable labels matching the Add Transaction dropdown. */
export const BUCKET_LABELS: Record<MethodologyBucket, string> = {
  draws: "Advances / Draws",
  principal_payments: "Principal Payments",
  vehicle_payoffs: "Vehicle Payoffs",
  payoffs: "Payoffs",
  interest_payments: "Interest Payments",
  fees: "Fees",
  adjustments: "Adjustments",
  reversals: "Payment Reversals",
  note_renewals: "Note Renewals",
};

export const DEBT_TYPE_LABELS: Record<string, string> = {
  term_loan: "Term Loan",
  line_of_credit: "Line of Credit",
  revolving_credit: "Revolving Credit",
  mortgage: "Mortgage",
  equipment_loan: "Equipment Loan",
  balloon_loan: "Balloon Loan",
  bridge_loan: "Bridge Loan",
  sba_loan: "SBA Loan",
  other: "Other",
};

// ─── Minimal input shapes (subset of the DB rows we care about) ────────────

export interface DebtInstrumentInput {
  id: string;
  entity_id: string;
  instrument_name: string;
  lender_name: string | null;
  loan_number?: string | null;
  debt_type: string;
  original_amount: number;
  interest_rate: number;
  credit_limit: number | null;
  current_draw: number | null;
  payment_amount: number | null;
  payment_frequency: string;
  start_date: string; // ISO yyyy-mm-dd
  maturity_date: string | null;
  status: string;
}

export interface DebtTransactionInput {
  id: string;
  debt_instrument_id: string;
  transaction_date: string;
  effective_date: string; // drives which period it lands in
  transaction_type: string;
  amount: number;
  to_principal: number;
  to_interest: number;
  to_fees: number;
  reference_number: string | null;
  description: string | null;
  is_reconciled: boolean;
}

export interface EntityRef {
  id: string;
  name: string;
  code: string;
}

/** Reconciliation status per instrument for the as-of date (optional). */
export interface ReconciliationStatusInput {
  debt_instrument_id: string;
  is_reconciled: boolean;
  variance: number | null;
}

// ─── Output types ──────────────────────────────────────────────────────────

/** Roll-forward numbers for one instrument over the selected window. */
export interface InstrumentRollForward {
  instrument: DebtInstrumentInput;
  entity: EntityRef;
  beginningBalance: number;
  draws: number;
  principalPayments: number;
  vehiclePayoffs: number;
  payoffs: number;
  interestPayments: number;
  fees: number;
  adjustments: number;
  reversals: number;
  noteRenewals: number;
  endingBalance: number;
  /** Principal paid net of reversals (Σ to_principal for paydown-type txns). */
  netPrincipalPaid: number;
  /** Reconciliation state for display badge (null if unknown). */
  reconciled: boolean | null;
  variance: number | null;
  /** Transaction count in the window — for the activity feed / audit. */
  transactionCount: number;
}

export interface GroupedRollForward {
  /** One group per entity, in the order encountered. */
  entities: EntityGroup[];
  totals: RollForwardTotals;
}

export interface EntityGroup {
  entity: EntityRef;
  totals: RollForwardTotals;
  /** One inner group per debt type active for this entity. */
  debtTypes: DebtTypeGroup[];
}

export interface DebtTypeGroup {
  debtType: string;
  debtTypeLabel: string;
  totals: RollForwardTotals;
  instruments: InstrumentRollForward[];
}

export interface RollForwardTotals {
  beginningBalance: number;
  draws: number;
  principalPayments: number;
  vehiclePayoffs: number;
  payoffs: number;
  interestPayments: number;
  fees: number;
  adjustments: number;
  reversals: number;
  noteRenewals: number;
  endingBalance: number;
  netPrincipalPaid: number;
  /** Weighted-average rate for the period: Σ(rate × avg balance). */
  weightedAvgRate: number;
  instrumentCount: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function emptyTotals(): RollForwardTotals {
  return {
    beginningBalance: 0,
    draws: 0,
    principalPayments: 0,
    vehiclePayoffs: 0,
    payoffs: 0,
    interestPayments: 0,
    fees: 0,
    adjustments: 0,
    reversals: 0,
    noteRenewals: 0,
    endingBalance: 0,
    netPrincipalPaid: 0,
    weightedAvgRate: 0,
    instrumentCount: 0,
  };
}

function addToTotals(t: RollForwardTotals, r: InstrumentRollForward): void {
  t.beginningBalance += r.beginningBalance;
  t.draws += r.draws;
  t.principalPayments += r.principalPayments;
  t.vehiclePayoffs += r.vehiclePayoffs;
  t.payoffs += r.payoffs;
  t.interestPayments += r.interestPayments;
  t.fees += r.fees;
  t.adjustments += r.adjustments;
  t.reversals += r.reversals;
  t.noteRenewals += r.noteRenewals;
  t.endingBalance += r.endingBalance;
  t.netPrincipalPaid += r.netPrincipalPaid;
  t.instrumentCount += 1;
}

/** Finalize weighted-average rate from a running accumulator. */
function finalizeWeightedRate(t: RollForwardTotals, weightedRateNumerator: number, weightedRateDenominator: number): void {
  t.weightedAvgRate =
    weightedRateDenominator > 0 ? weightedRateNumerator / weightedRateDenominator : 0;
}

/** True if the transaction's effective_date is strictly before `startIso`. */
function isBefore(effectiveDate: string, startIso: string): boolean {
  return effectiveDate.slice(0, 10) < startIso;
}

/** True if the transaction falls in [startIso, endIso], inclusive on both. */
function isInWindow(effectiveDate: string, startIso: string, endIso: string): boolean {
  const d = effectiveDate.slice(0, 10);
  return d >= startIso && d <= endIso;
}

/**
 * Declared opening balance for a loan at its `start_date`, net of any ledger
 * advances that already represent origination draws. Most term loans don't
 * record their origination as a ledger transaction — the loan simply
 * "begins" at `original_amount`. LOCs, by contrast, usually record each
 * draw as an `advance` transaction, so the ledger already covers their
 * activity from day one.
 *
 * Heuristic: seed = max(declared, 0) − Σ(ledger advances at or before
 * start_date). If the ledger already shows advances that meet or exceed
 * the declared opening, we trust the ledger entirely (seed = 0). Otherwise
 * the shortfall is added as an implicit opening at start_date.
 *
 * This matches the convention used by the instrument-level amortization
 * page (`[entityId]/debt/[debtId]/page.tsx`) which seeds balance from
 * `original_amount` (or `current_draw` for LOCs) at start_date before
 * replaying transactions.
 */
function computeOpeningSeed(
  instrument: DebtInstrumentInput,
  txnsForInstrument: DebtTransactionInput[]
): number {
  const startDate = instrument.start_date?.slice(0, 10) ?? "";
  if (!startDate) return 0;

  const declaredOpening = Math.max(
    Number(instrument.original_amount) || 0,
    Number(instrument.current_draw) || 0
  );
  if (declaredOpening <= 0) return 0;

  const ledgerAdvancesAtOrBeforeStart = txnsForInstrument
    .filter(
      (t) =>
        t.transaction_type === "advance" &&
        t.effective_date.slice(0, 10) <= startDate
    )
    .reduce(
      (s, t) =>
        s +
        Math.max(
          Number(t.to_principal) || 0,
          Number(t.amount) || 0
        ),
      0
    );

  return Math.max(0, declaredOpening - ledgerAdvancesAtOrBeforeStart);
}

/**
 * Transaction sign for rolling the principal balance forward.
 *
 *   +advance        → increases principal (new draw on the LOC)
 *   −principal_payment / vehicle_payoff / payoff → decreases principal
 *   adjustment      → follows to_principal sign stored on the row
 *   payment_reversal → reverses a prior payment (to_principal comes back)
 *   note_renewal    → typically net zero, but honor to_principal if set
 *
 * Returns the principal-movement delta (positive = balance goes up, negative = down).
 */
function principalDelta(txn: DebtTransactionInput): number {
  const type = txn.transaction_type as DebtTransactionType;
  const toPrincipal = Number(txn.to_principal) || 0;
  switch (type) {
    case "advance":
      // Draws increase the outstanding balance. Stored amount may be on the
      // row's amount field (when to_principal is not set); fall back gracefully.
      return toPrincipal > 0 ? toPrincipal : Number(txn.amount) || 0;
    case "principal_payment":
    case "vehicle_payoff":
    case "payoff":
      return -(toPrincipal || Number(txn.amount) || 0);
    case "payment_reversal":
      // Reversal undoes a prior payment — principal comes BACK up.
      return toPrincipal > 0 ? toPrincipal : Number(txn.amount) || 0;
    case "adjustment":
    case "note_renewal":
      return toPrincipal; // honor sign as stored
    case "interest_payment":
    case "fee_payment":
    case "late_fee":
    case "misc_fee":
    case "origination_fee":
    case "annual_fee":
      return 0; // these don't touch principal by definition
  }
  return 0;
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface RollForwardInput {
  instruments: DebtInstrumentInput[];
  transactions: DebtTransactionInput[];
  entities: EntityRef[];
  /** Inclusive window boundaries, ISO yyyy-mm-dd. */
  startIso: string;
  endIso: string;
  /** Optional reconciliation snapshot for the as-of date. */
  reconciliation?: ReconciliationStatusInput[];
}

/**
 * Compute per-instrument roll-forwards and grouped totals.
 *
 * - Instruments with no activity in the window and a zero beginning balance
 *   are excluded (they don't roll forward anything and would just pad the
 *   report). Instruments that opened in-window keep their row even if the
 *   entity had no prior history.
 * - Weighted-average rate uses the average of (beginning + ending) × rate
 *   over the window — a first-order approximation that's fine for a monthly
 *   supplemental report. We can refine to day-weighted if auditors ask.
 */
export function computeDebtRollForward(input: RollForwardInput): GroupedRollForward {
  const { instruments, transactions, entities, startIso, endIso, reconciliation } = input;

  const entityMap = new Map(entities.map((e) => [e.id, e]));
  const reconMap = new Map(
    (reconciliation ?? []).map((r) => [r.debt_instrument_id, r])
  );

  // Bucket transactions per instrument for efficient processing.
  const txByInstrument = new Map<string, DebtTransactionInput[]>();
  for (const t of transactions) {
    const list = txByInstrument.get(t.debt_instrument_id);
    if (list) list.push(t);
    else txByInstrument.set(t.debt_instrument_id, [t]);
  }

  const rows: InstrumentRollForward[] = [];

  for (const instr of instruments) {
    const entity = entityMap.get(instr.entity_id) ?? {
      id: instr.entity_id,
      name: "Unknown Entity",
      code: "",
    };
    const txns = txByInstrument.get(instr.id) ?? [];
    const startDate = instr.start_date?.slice(0, 10) ?? "";

    // Skip loans that haven't started by the end of the window.
    if (startDate && startDate > endIso) continue;

    // Opening seed = declared opening at start_date net of ledger advances
    // that already represent origination. Most term loans don't record
    // origination in the ledger; this seeds that "day one" principal.
    const openingSeed = computeOpeningSeed(instr, txns);

    // Beginning balance = opening seed (if loan predates window) plus net
    // principal movement from all pre-window transactions.
    let beginning = 0;
    if (startDate && startDate < startIso) {
      beginning += openingSeed;
    }
    const inWindow: DebtTransactionInput[] = [];
    for (const t of txns) {
      if (isBefore(t.effective_date, startIso)) {
        beginning += principalDelta(t);
      } else if (isInWindow(t.effective_date, startIso, endIso)) {
        inWindow.push(t);
      }
    }

    const buckets: Record<MethodologyBucket, number> = {
      draws: 0,
      principal_payments: 0,
      vehicle_payoffs: 0,
      payoffs: 0,
      interest_payments: 0,
      fees: 0,
      adjustments: 0,
      reversals: 0,
      note_renewals: 0,
    };
    let interestPaid = 0;
    let feesPaid = 0;
    let netPrincipalPaid = 0;
    let runningBalance = beginning;

    // Loans that originate inside the window surface their opening as an
    // implicit advance on start_date — the origination shows up in the
    // Draws bucket so the rollforward math (beginning + draws − paydowns
    // = ending) still ties.
    if (
      startDate &&
      startDate >= startIso &&
      startDate <= endIso &&
      openingSeed > 0
    ) {
      runningBalance += openingSeed;
      buckets.draws += openingSeed;
    }

    for (const t of inWindow) {
      const bucket =
        TRANSACTION_TYPE_TO_BUCKET[t.transaction_type as DebtTransactionType];
      const principalMoved = principalDelta(t);
      runningBalance += principalMoved;

      // Bucket amounts — these are displayed as-is on the dashboard. Sign
      // follows intuitive "money movement" rules: draws positive, paydowns
      // positive (they're displayed in a "− Principal" column), adjustments
      // keep their native sign so users see exactly what posted.
      switch (bucket) {
        case "draws":
          buckets.draws += principalMoved; // positive
          break;
        case "principal_payments":
          buckets.principal_payments += Math.abs(principalMoved);
          netPrincipalPaid += Math.abs(principalMoved);
          break;
        case "vehicle_payoffs":
          buckets.vehicle_payoffs += Math.abs(principalMoved);
          netPrincipalPaid += Math.abs(principalMoved);
          break;
        case "payoffs":
          buckets.payoffs += Math.abs(principalMoved);
          netPrincipalPaid += Math.abs(principalMoved);
          break;
        case "interest_payments":
          interestPaid += Number(t.to_interest) || Number(t.amount) || 0;
          buckets.interest_payments +=
            Number(t.to_interest) || Number(t.amount) || 0;
          break;
        case "fees":
          feesPaid += Number(t.to_fees) || Number(t.amount) || 0;
          buckets.fees += Number(t.to_fees) || Number(t.amount) || 0;
          break;
        case "adjustments":
          buckets.adjustments += principalMoved; // keep sign
          break;
        case "reversals":
          buckets.reversals += principalMoved;
          netPrincipalPaid -= principalMoved; // reversal undoes paid amount
          break;
        case "note_renewals":
          buckets.note_renewals += principalMoved;
          break;
      }

      // Any transaction may carry interest or fee splits alongside its primary
      // purpose (e.g. a combined principal+interest payment). Count those
      // cross-bucket pieces into interest/fees paid so the cash totals tie.
      if (bucket !== "interest_payments" && Number(t.to_interest) !== 0) {
        interestPaid += Number(t.to_interest);
      }
      if (bucket !== "fees" && Number(t.to_fees) !== 0) {
        feesPaid += Number(t.to_fees);
      }
    }

    const ending = runningBalance;

    // Skip rows with no window activity AND zero running balance — not useful
    // for the investor/bank report and cuts noise.
    if (
      inWindow.length === 0 &&
      Math.abs(beginning) < 0.005 &&
      Math.abs(ending) < 0.005
    ) {
      continue;
    }

    const recon = reconMap.get(instr.id);
    rows.push({
      instrument: instr,
      entity,
      beginningBalance: beginning,
      draws: buckets.draws,
      principalPayments: buckets.principal_payments,
      vehiclePayoffs: buckets.vehicle_payoffs,
      payoffs: buckets.payoffs,
      interestPayments: interestPaid,
      fees: feesPaid,
      adjustments: buckets.adjustments,
      reversals: buckets.reversals,
      noteRenewals: buckets.note_renewals,
      endingBalance: ending,
      netPrincipalPaid,
      reconciled: recon ? recon.is_reconciled : null,
      variance: recon ? recon.variance : null,
      transactionCount: inWindow.length,
    });
  }

  // Group Entity → Debt Type → Instrument
  const entityGroups = new Map<string, EntityGroup>();

  // Weighted rate running accumulators (per entity and per type).
  const rateNumByEntity = new Map<string, number>();
  const rateDenByEntity = new Map<string, number>();
  const rateNumByType = new Map<string, Map<string, number>>(); // entity → type → num
  const rateDenByType = new Map<string, Map<string, number>>();

  const overallRateNum = { v: 0 };
  const overallRateDen = { v: 0 };

  for (const row of rows) {
    let eg = entityGroups.get(row.entity.id);
    if (!eg) {
      eg = {
        entity: row.entity,
        totals: emptyTotals(),
        debtTypes: [],
      };
      entityGroups.set(row.entity.id, eg);
    }

    let tg = eg.debtTypes.find((x) => x.debtType === row.instrument.debt_type);
    if (!tg) {
      tg = {
        debtType: row.instrument.debt_type,
        debtTypeLabel:
          DEBT_TYPE_LABELS[row.instrument.debt_type] ?? row.instrument.debt_type,
        totals: emptyTotals(),
        instruments: [],
      };
      eg.debtTypes.push(tg);
    }

    tg.instruments.push(row);
    addToTotals(tg.totals, row);
    addToTotals(eg.totals, row);

    // Average balance × rate weights the rate by exposure.
    const avgBalance = (row.beginningBalance + row.endingBalance) / 2;
    const weight = Math.max(avgBalance, 0);
    const rateNum = weight * Number(row.instrument.interest_rate);
    rateNumByEntity.set(
      row.entity.id,
      (rateNumByEntity.get(row.entity.id) ?? 0) + rateNum
    );
    rateDenByEntity.set(
      row.entity.id,
      (rateDenByEntity.get(row.entity.id) ?? 0) + weight
    );

    let typeNum = rateNumByType.get(row.entity.id);
    if (!typeNum) {
      typeNum = new Map();
      rateNumByType.set(row.entity.id, typeNum);
    }
    let typeDen = rateDenByType.get(row.entity.id);
    if (!typeDen) {
      typeDen = new Map();
      rateDenByType.set(row.entity.id, typeDen);
    }
    typeNum.set(
      row.instrument.debt_type,
      (typeNum.get(row.instrument.debt_type) ?? 0) + rateNum
    );
    typeDen.set(
      row.instrument.debt_type,
      (typeDen.get(row.instrument.debt_type) ?? 0) + weight
    );

    overallRateNum.v += rateNum;
    overallRateDen.v += weight;
  }

  // Finalize weighted rates on each grouping layer.
  for (const eg of entityGroups.values()) {
    finalizeWeightedRate(
      eg.totals,
      rateNumByEntity.get(eg.entity.id) ?? 0,
      rateDenByEntity.get(eg.entity.id) ?? 0
    );
    const typeNum = rateNumByType.get(eg.entity.id);
    const typeDen = rateDenByType.get(eg.entity.id);
    for (const tg of eg.debtTypes) {
      finalizeWeightedRate(
        tg.totals,
        typeNum?.get(tg.debtType) ?? 0,
        typeDen?.get(tg.debtType) ?? 0
      );
      tg.instruments.sort((a, b) =>
        a.instrument.instrument_name.localeCompare(b.instrument.instrument_name)
      );
    }
    // Sort debt types by descending ending balance for investor-friendly layout.
    eg.debtTypes.sort((a, b) => b.totals.endingBalance - a.totals.endingBalance);
  }

  const grand = emptyTotals();
  for (const eg of entityGroups.values()) {
    grand.beginningBalance += eg.totals.beginningBalance;
    grand.draws += eg.totals.draws;
    grand.principalPayments += eg.totals.principalPayments;
    grand.vehiclePayoffs += eg.totals.vehiclePayoffs;
    grand.payoffs += eg.totals.payoffs;
    grand.interestPayments += eg.totals.interestPayments;
    grand.fees += eg.totals.fees;
    grand.adjustments += eg.totals.adjustments;
    grand.reversals += eg.totals.reversals;
    grand.noteRenewals += eg.totals.noteRenewals;
    grand.endingBalance += eg.totals.endingBalance;
    grand.netPrincipalPaid += eg.totals.netPrincipalPaid;
    grand.instrumentCount += eg.totals.instrumentCount;
  }
  finalizeWeightedRate(grand, overallRateNum.v, overallRateDen.v);

  const entitiesOrdered = Array.from(entityGroups.values()).sort((a, b) =>
    a.entity.name.localeCompare(b.entity.name)
  );

  return { entities: entitiesOrdered, totals: grand };
}

// ─── Convenience: monthly series for trend chart ───────────────────────────

export interface MonthlyBalancePoint {
  year: number;
  month: number;
  label: string; // "Mar 2026"
  endingBalance: number;
  byDebtType: Record<string, number>;
  /** Activity for the month, for the draws-vs-payments toggle. */
  draws: number;
  paydowns: number;
}

/**
 * Build a monthly series of ending balances between the start and end
 * of a window (both inclusive, month-rounded).
 *
 * Each instrument's balance at a given month-end =
 *   opening-seed (applied when start_date ≤ month-end) + Σ principalDelta
 *   for that instrument's transactions with effective_date ≤ month-end.
 *
 * The opening seed is `original_amount` (term loans) or `current_draw`
 * (LOCs), net of any ledger advances that already represent origination,
 * matching the convention used in the main roll-forward.
 *
 * Safety cap: if a caller passes an absurd multi-decade range we only
 * emit the last 120 months (10 years) to keep charts sane.
 */
export function computeMonthlyBalanceSeries(
  instruments: DebtInstrumentInput[],
  transactions: DebtTransactionInput[],
  startIso: string,
  endIso: string
): MonthlyBalancePoint[] {
  const [sY, sM] = startIso.split("T")[0].split("-").map(Number);
  const [eY, eM] = endIso.split("T")[0].split("-").map(Number);
  const series: MonthlyBalancePoint[] = [];

  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  // Walk forward month-by-month from start through end, inclusive.
  const months: Array<{ y: number; m: number }> = [];
  let y = sY;
  let m = sM;
  while (y < eY || (y === eY && m <= eM)) {
    months.push({ y, m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (months.length >= 120) break;
  }

  const typeByInstrument = new Map(
    instruments.map((i) => [i.id, i.debt_type] as const)
  );

  // Pre-compute opening seed per instrument (one pass over transactions).
  const txByInstrument = new Map<string, DebtTransactionInput[]>();
  for (const t of transactions) {
    const list = txByInstrument.get(t.debt_instrument_id);
    if (list) list.push(t);
    else txByInstrument.set(t.debt_instrument_id, [t]);
  }
  const openingByInstrument = new Map<string, number>();
  const startDateByInstrument = new Map<string, string>();
  for (const instr of instruments) {
    openingByInstrument.set(
      instr.id,
      computeOpeningSeed(instr, txByInstrument.get(instr.id) ?? [])
    );
    startDateByInstrument.set(instr.id, instr.start_date?.slice(0, 10) ?? "");
  }

  for (const { y: py, m: pm } of months) {
    // End-of-month ISO date
    const endIso = `${py}-${String(pm).padStart(2, "0")}-${String(
      new Date(py, pm, 0).getDate()
    ).padStart(2, "0")}`;
    const monthStartIso = `${py}-${String(pm).padStart(2, "0")}-01`;

    let ending = 0;
    let draws = 0;
    let paydowns = 0;
    const byType: Record<string, number> = {};

    // Running balance per instrument — initialize from opening seed so
    // term loans originated before this month start with their declared
    // principal, not $0.
    const balByInstrument = new Map<string, number>();
    for (const instr of instruments) {
      const startDate = startDateByInstrument.get(instr.id) ?? "";
      if (!startDate || startDate > endIso) continue; // not yet originated
      const seed = openingByInstrument.get(instr.id) ?? 0;
      if (seed > 0) balByInstrument.set(instr.id, seed);
      // If origination happened inside this month, count the seed as a
      // draw for the draws-vs-paydowns view.
      if (seed > 0 && startDate >= monthStartIso && startDate <= endIso) {
        draws += seed;
      }
    }
    for (const t of transactions) {
      if (t.effective_date.slice(0, 10) > endIso) continue;
      const delta = principalDelta(t);
      balByInstrument.set(
        t.debt_instrument_id,
        (balByInstrument.get(t.debt_instrument_id) ?? 0) + delta
      );
      if (t.effective_date.slice(0, 10) >= monthStartIso) {
        if (delta > 0) draws += delta;
        else if (delta < 0) paydowns += -delta;
      }
    }
    for (const [instrId, bal] of balByInstrument) {
      if (Math.abs(bal) < 0.005) continue;
      ending += bal;
      const t = typeByInstrument.get(instrId) ?? "other";
      byType[t] = (byType[t] ?? 0) + bal;
    }

    series.push({
      year: py,
      month: pm,
      label: `${MONTHS[pm - 1]} ${py}`,
      endingBalance: ending,
      byDebtType: byType,
      draws,
      paydowns,
    });
  }

  return series;
}
