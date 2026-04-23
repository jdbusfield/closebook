"use client";

/**
 * Build the multi-sheet Debt Roll-Forward workbook.
 *
 * Sheets:
 *   1. Summary         — by debt type, roll-forward buckets, grand total
 *   2. By Entity       — by entity, roll-forward buckets
 *   3. By Instrument   — full detail grouped Entity → Type, with subtotals
 *   4. Monthly Detail  — matrix sheet, instruments as rows, months as columns
 *   5. Transactions    — audit appendix, every source transaction in window
 *
 * Styling is driven by the shared excel.ts helpers — navy title block,
 * frozen panes, zebra rows, currency formats, totals with double underline.
 */

import {
  addMatrixSheet,
  addSheet,
  createWorkbook,
  downloadWorkbook,
  formatLongDate,
  NUMBER_FORMATS,
  parseIsoDate,
  type ColumnDef,
  type MatrixRow,
} from "@/lib/utils/excel";
import {
  BUCKET_LABELS,
  DEBT_TYPE_LABELS,
  TRANSACTION_TYPE_TO_BUCKET,
  type DebtInstrumentInput,
  type DebtTransactionInput,
  type DebtTransactionType,
  type EntityRef,
  type GroupedRollForward,
  type InstrumentRollForward,
  type MonthlyBalancePoint,
} from "@/lib/utils/debt-rollforward";

export interface ExportOptions {
  organizationName: string;
  scopeLabel: string;
  startIso: string;
  endIso: string;
  asOfIso: string;
  includeSummary: boolean;
  includeByEntity: boolean;
  includeByInstrument: boolean;
  includeMonthlyDetail: boolean;
  includeTransactions: boolean;
}

interface BuildInput {
  rollForward: GroupedRollForward;
  trend: MonthlyBalancePoint[];
  instruments: DebtInstrumentInput[];
  transactions: DebtTransactionInput[];
  entities: EntityRef[];
  options: ExportOptions;
}

export async function exportDebtWorkbook(input: BuildInput): Promise<void> {
  const { rollForward, trend, instruments, transactions, entities, options } = input;

  const wb = createWorkbook({
    company: options.organizationName,
    title: `${options.scopeLabel} — Debt Roll-Forward`,
  });

  const periodPhrase = `${formatLongDate(options.startIso)} through ${formatLongDate(options.endIso)}`;
  const titleBase = {
    entityName: options.organizationName,
    reportTitle: "Debt Roll-Forward",
    subtitle: `${options.scopeLabel} · Supplemental to Consolidated Financial Statements`,
    period: periodPhrase,
    asOf: `Generated ${formatLongDate(new Date().toISOString().slice(0, 10))}`,
  };

  if (options.includeSummary) addSummarySheet(wb, rollForward, titleBase);
  if (options.includeByEntity) addByEntitySheet(wb, rollForward, titleBase);
  if (options.includeByInstrument)
    addByInstrumentSheet(wb, rollForward, titleBase);
  if (options.includeMonthlyDetail)
    addMonthlyDetailSheet(wb, trend, instruments, titleBase);
  if (options.includeTransactions)
    addTransactionsSheet(
      wb,
      transactions,
      instruments,
      entities,
      options,
      titleBase
    );

  const safe = options.scopeLabel.replace(/[^a-zA-Z0-9_-]/g, "_");
  await downloadWorkbook(
    wb,
    `debt-roll-forward-${safe}-${options.startIso}-to-${options.endIso}`
  );
}

// ─── Sheet 1: Summary (by debt type) ───────────────────────────────────────

interface TypeSummaryRow {
  debtType: string;
  debtTypeLabel: string;
  beginning: number;
  draws: number;
  principal: number;
  vehiclePayoff: number;
  payoff: number;
  adjustments: number;
  reversals: number;
  noteRenewals: number;
  ending: number;
  interestPaid: number;
  fees: number;
  instrumentCount: number;
}

function buildTypeSummary(rf: GroupedRollForward): TypeSummaryRow[] {
  const byType = new Map<string, TypeSummaryRow>();
  for (const eg of rf.entities) {
    for (const tg of eg.debtTypes) {
      let existing = byType.get(tg.debtType);
      if (!existing) {
        existing = {
          debtType: tg.debtType,
          debtTypeLabel: tg.debtTypeLabel,
          beginning: 0,
          draws: 0,
          principal: 0,
          vehiclePayoff: 0,
          payoff: 0,
          adjustments: 0,
          reversals: 0,
          noteRenewals: 0,
          ending: 0,
          interestPaid: 0,
          fees: 0,
          instrumentCount: 0,
        };
        byType.set(tg.debtType, existing);
      }
      existing.beginning += tg.totals.beginningBalance;
      existing.draws += tg.totals.draws;
      existing.principal += tg.totals.principalPayments;
      existing.vehiclePayoff += tg.totals.vehiclePayoffs;
      existing.payoff += tg.totals.payoffs;
      existing.adjustments += tg.totals.adjustments;
      existing.reversals += tg.totals.reversals;
      existing.noteRenewals += tg.totals.noteRenewals;
      existing.ending += tg.totals.endingBalance;
      existing.interestPaid += tg.totals.interestPayments;
      existing.fees += tg.totals.fees;
      existing.instrumentCount += tg.totals.instrumentCount;
    }
  }
  return Array.from(byType.values()).sort((a, b) => b.ending - a.ending);
}

function addSummarySheet(
  wb: ReturnType<typeof createWorkbook>,
  rf: GroupedRollForward,
  titleBase: { entityName: string; reportTitle: string; subtitle: string; period: string; asOf: string }
) {
  const rows = buildTypeSummary(rf);
  const cols: ColumnDef<TypeSummaryRow>[] = [
    { header: "Debt Type", width: 22, value: (r) => r.debtTypeLabel },
    {
      header: "Instruments",
      width: 12,
      align: "center",
      value: (r) => r.instrumentCount,
      total: "sum",
    },
    {
      header: "Beginning Balance",
      width: 18,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => r.beginning,
    },
    {
      header: "+ Draws",
      width: 14,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => r.draws,
    },
    {
      header: "− Principal",
      width: 14,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => -r.principal,
    },
    {
      header: "− Vehicle Payoff",
      width: 16,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => -r.vehiclePayoff,
    },
    {
      header: "− Payoff",
      width: 14,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => -r.payoff,
    },
    {
      header: "Adj / Rev / Renewal",
      width: 18,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => r.adjustments + r.reversals + r.noteRenewals,
    },
    {
      header: "Ending Balance",
      width: 18,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => r.ending,
    },
    {
      header: "Net Δ",
      width: 14,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => r.ending - r.beginning,
    },
    {
      header: "Interest Paid",
      width: 14,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => r.interestPaid,
    },
    {
      header: "Fees",
      width: 12,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => r.fees,
    },
  ];
  addSheet(wb, {
    name: "Summary",
    columns: cols,
    rows,
    title: titleBase,
    grandTotal: true,
    footnote:
      "Paydown buckets are shown as negatives to preserve arithmetic: Beginning + Draws − Paydowns ± Adj = Ending.",
  });
}

// ─── Sheet 2: By Entity ────────────────────────────────────────────────────

interface EntityRow {
  entityName: string;
  entityCode: string;
  beginning: number;
  draws: number;
  principal: number;
  vehiclePayoff: number;
  payoff: number;
  adjustments: number;
  ending: number;
  interestPaid: number;
  fees: number;
  instrumentCount: number;
  weightedRate: number;
}

function addByEntitySheet(
  wb: ReturnType<typeof createWorkbook>,
  rf: GroupedRollForward,
  titleBase: { entityName: string; reportTitle: string; subtitle: string; period: string; asOf: string }
) {
  const rows: EntityRow[] = rf.entities.map((eg) => ({
    entityName: eg.entity.name,
    entityCode: eg.entity.code,
    beginning: eg.totals.beginningBalance,
    draws: eg.totals.draws,
    principal: eg.totals.principalPayments,
    vehiclePayoff: eg.totals.vehiclePayoffs,
    payoff: eg.totals.payoffs,
    adjustments: eg.totals.adjustments + eg.totals.reversals + eg.totals.noteRenewals,
    ending: eg.totals.endingBalance,
    interestPaid: eg.totals.interestPayments,
    fees: eg.totals.fees,
    instrumentCount: eg.totals.instrumentCount,
    weightedRate: eg.totals.weightedAvgRate,
  }));
  const cols: ColumnDef<EntityRow>[] = [
    { header: "Entity", width: 26, value: (r) => r.entityName },
    { header: "Code", width: 10, value: (r) => r.entityCode },
    {
      header: "Instruments",
      width: 12,
      align: "center",
      value: (r) => r.instrumentCount,
      total: "sum",
    },
    {
      header: "Beginning",
      width: 16,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => r.beginning,
    },
    { header: "+ Draws", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.draws },
    { header: "− Principal", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => -r.principal },
    {
      header: "− Vehicle Payoff",
      width: 16,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => -r.vehiclePayoff,
    },
    { header: "− Payoff", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => -r.payoff },
    {
      header: "Adj / Rev / Renewal",
      width: 18,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => r.adjustments,
    },
    { header: "Ending", width: 16, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.ending },
    { header: "Interest", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.interestPaid },
    { header: "Fees", width: 12, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.fees },
    {
      header: "Wtd Rate",
      width: 10,
      format: NUMBER_FORMATS.percent,
      value: (r) => r.weightedRate,
    },
  ];
  addSheet(wb, {
    name: "By Entity",
    columns: cols,
    rows,
    title: { ...titleBase, reportTitle: "Debt Roll-Forward — By Entity" },
    grandTotal: true,
  });
}

// ─── Sheet 3: By Instrument (grouped Entity → Debt Type) ───────────────────

interface InstrumentRow {
  entityName: string;
  debtTypeLabel: string;
  instrumentName: string;
  lender: string;
  loanNumber: string;
  startDate: Date | "";
  maturityDate: Date | "";
  rate: number;
  beginning: number;
  draws: number;
  principal: number;
  vehiclePayoff: number;
  payoff: number;
  adjustments: number;
  ending: number;
  netDelta: number;
  interestPaid: number;
  fees: number;
  reconciled: string;
}

function addByInstrumentSheet(
  wb: ReturnType<typeof createWorkbook>,
  rf: GroupedRollForward,
  titleBase: { entityName: string; reportTitle: string; subtitle: string; period: string; asOf: string }
) {
  const flat: InstrumentRow[] = [];
  for (const eg of rf.entities) {
    for (const tg of eg.debtTypes) {
      for (const row of tg.instruments) {
        flat.push({
          entityName: eg.entity.name,
          debtTypeLabel: tg.debtTypeLabel,
          instrumentName: row.instrument.instrument_name,
          lender: row.instrument.lender_name ?? "",
          loanNumber: row.instrument.loan_number ?? "",
          startDate: parseIsoDate(row.instrument.start_date) ?? "",
          maturityDate: parseIsoDate(row.instrument.maturity_date) ?? "",
          rate: row.instrument.interest_rate,
          beginning: row.beginningBalance,
          draws: row.draws,
          principal: row.principalPayments,
          vehiclePayoff: row.vehiclePayoffs,
          payoff: row.payoffs,
          adjustments: row.adjustments + row.reversals + row.noteRenewals,
          ending: row.endingBalance,
          netDelta: row.endingBalance - row.beginningBalance,
          interestPaid: row.interestPayments,
          fees: row.fees,
          reconciled: formatReconBadge(row),
        });
      }
    }
  }
  const cols: ColumnDef<InstrumentRow>[] = [
    { header: "Debt Type", width: 20, value: (r) => r.debtTypeLabel },
    { header: "Instrument", width: 28, value: (r) => r.instrumentName },
    { header: "Lender", width: 22, value: (r) => r.lender },
    { header: "Loan #", width: 14, value: (r) => r.loanNumber },
    { header: "Start", width: 12, format: NUMBER_FORMATS.date, value: (r) => r.startDate },
    { header: "Maturity", width: 12, format: NUMBER_FORMATS.date, value: (r) => r.maturityDate },
    { header: "Rate", width: 10, format: NUMBER_FORMATS.percent, value: (r) => r.rate },
    { header: "Beginning", width: 16, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.beginning },
    { header: "+ Draws", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.draws },
    { header: "− Principal", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => -r.principal },
    {
      header: "− Vehicle Payoff",
      width: 16,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => -r.vehiclePayoff,
    },
    { header: "− Payoff", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => -r.payoff },
    {
      header: "Adj / Rev / Renewal",
      width: 18,
      format: NUMBER_FORMATS.currency,
      total: "sum",
      value: (r) => r.adjustments,
    },
    { header: "Ending", width: 16, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.ending },
    { header: "Net Δ", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.netDelta },
    { header: "Interest Paid", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.interestPaid },
    { header: "Fees", width: 12, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.fees },
    { header: "Reconciled", width: 14, value: (r) => r.reconciled },
  ];
  addSheet(wb, {
    name: "By Instrument",
    columns: cols,
    rows: flat,
    title: { ...titleBase, reportTitle: "Debt Roll-Forward — By Instrument" },
    groupBy: (r) => r.entityName,
    grandTotal: true,
  });
}

function formatReconBadge(r: InstrumentRollForward): string {
  if (r.reconciled === null) return "";
  if (r.reconciled) return "Reconciled";
  if (r.variance != null && Math.abs(r.variance) > 0.005) {
    return `Variance: ${r.variance.toFixed(2)}`;
  }
  return "Unreconciled";
}

// ─── Sheet 4: Monthly Detail (matrix) ──────────────────────────────────────

function addMonthlyDetailSheet(
  wb: ReturnType<typeof createWorkbook>,
  trend: MonthlyBalancePoint[],
  instruments: DebtInstrumentInput[],
  titleBase: { entityName: string; reportTitle: string; subtitle: string; period: string; asOf: string }
) {
  // Build ending-balance per instrument per month from the trend's underlying
  // shape. We don't have per-instrument per-month in `trend`, so compute a
  // simplified total-row view: rows are debt types, columns are months,
  // values are ending balance for that type in that month. Plus a grand
  // total row.
  const debtTypes = new Set<string>();
  for (const p of trend) {
    for (const t of Object.keys(p.byDebtType)) debtTypes.add(t);
  }
  const types = Array.from(debtTypes).sort();

  const matrixRows: MatrixRow[] = types.map((t) => ({
    label: DEBT_TYPE_LABELS[t] ?? t,
    values: trend.map((p) => p.byDebtType[t] ?? 0),
  }));
  matrixRows.push({
    label: "Grand Total",
    values: trend.map((p) => p.endingBalance),
    totalStyle: true,
    bold: true,
  });

  addMatrixSheet(wb, {
    name: "Monthly Detail",
    title: {
      ...titleBase,
      reportTitle: "Debt Outstanding — 24-Month Trend",
    },
    labelColumn: { header: "Debt Type", width: 24 },
    periodColumns: trend.map((p) => ({
      header: p.label,
      width: 14,
      format: NUMBER_FORMATS.currency,
    })),
    rows: matrixRows,
  });

  // Void unused instruments arg (reserved for future per-instrument matrix).
  void instruments;
}

// ─── Sheet 5: Transactions (audit appendix) ────────────────────────────────

interface TxnRow {
  date: Date | "";
  entity: string;
  instrument: string;
  lender: string;
  type: string;
  bucket: string;
  amount: number;
  toPrincipal: number;
  toInterest: number;
  toFees: number;
  reference: string;
  description: string;
  reconciled: string;
}

function addTransactionsSheet(
  wb: ReturnType<typeof createWorkbook>,
  transactions: DebtTransactionInput[],
  instruments: DebtInstrumentInput[],
  entities: EntityRef[],
  options: ExportOptions,
  titleBase: { entityName: string; reportTitle: string; subtitle: string; period: string; asOf: string }
) {
  const instrMap = new Map(instruments.map((i) => [i.id, i]));
  const entMap = new Map(entities.map((e) => [e.id, e]));

  const rows: TxnRow[] = transactions
    .filter((t) => {
      const d = t.effective_date.slice(0, 10);
      return d >= options.startIso && d <= options.endIso;
    })
    .sort((a, b) => a.effective_date.localeCompare(b.effective_date))
    .map((t) => {
      const instr = instrMap.get(t.debt_instrument_id);
      const entity = instr ? entMap.get(instr.entity_id) : undefined;
      const bucket =
        TRANSACTION_TYPE_TO_BUCKET[t.transaction_type as DebtTransactionType];
      return {
        date: parseIsoDate(t.effective_date) ?? "",
        entity: entity?.name ?? "",
        instrument: instr?.instrument_name ?? "",
        lender: instr?.lender_name ?? "",
        type: t.transaction_type,
        bucket: bucket ? BUCKET_LABELS[bucket] : "",
        amount: t.amount,
        toPrincipal: t.to_principal,
        toInterest: t.to_interest,
        toFees: t.to_fees,
        reference: t.reference_number ?? "",
        description: t.description ?? "",
        reconciled: t.is_reconciled ? "Yes" : "No",
      };
    });

  const cols: ColumnDef<TxnRow>[] = [
    { header: "Date", width: 12, format: NUMBER_FORMATS.date, value: (r) => r.date },
    { header: "Entity", width: 22, value: (r) => r.entity },
    { header: "Instrument", width: 26, value: (r) => r.instrument },
    { header: "Lender", width: 20, value: (r) => r.lender },
    { header: "Type", width: 18, value: (r) => r.type },
    { header: "Methodology", width: 18, value: (r) => r.bucket },
    { header: "Amount", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.amount },
    { header: "To Principal", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.toPrincipal },
    { header: "To Interest", width: 14, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.toInterest },
    { header: "To Fees", width: 12, format: NUMBER_FORMATS.currency, total: "sum", value: (r) => r.toFees },
    { header: "Reference", width: 16, value: (r) => r.reference },
    { header: "Description", width: 32, value: (r) => r.description },
    { header: "Reconciled", width: 12, align: "center", value: (r) => r.reconciled },
  ];
  addSheet(wb, {
    name: "Transactions",
    columns: cols,
    rows,
    title: { ...titleBase, reportTitle: "Debt Transactions — Audit Appendix" },
    grandTotal: true,
  });
}
