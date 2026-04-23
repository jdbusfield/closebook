/**
 * Per-GL-account revenue accrual calculation.
 *
 * Wraps `calculateLine` from revenue-calc.ts and applies it to each revenue
 * account on an invoice's GL Distribution. Uses rental dates for earned
 * revenue (pro-rata by calendar days) and invoice date for billed amount —
 * matching the existing accrual methodology, but split per GL account so the
 * resulting JE debits/credits the same accounts RW posts to.
 */

import { calculateLine, type RentalRow, type CalculatedLine } from "./revenue-calc";

export interface GLDistLine {
  glAccountNo: string;
  glAccountDescription: string;
  glAccountId: string;
  groupHeading: string; // "INCOME", "ASSETS", etc.
  debit: number;
  credit: number;
}

export interface InvoiceForAccrual {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date;
  rentalStart: Date;
  rentalEnd: Date;
  customerName: string;
  orderDescription: string;
  glLines: GLDistLine[];
}

export interface AccountAccrualLine extends CalculatedLine {
  glAccountNo: string;
  glAccountDescription: string;
  glAccountId: string;
  groupHeading: string;
  invoiceNumber: string;
  invoiceDate: string;
}

/**
 * Pro-rate a single invoice's revenue across its GL accounts for a target period.
 *
 * Assumes all RentalWorks invoices flow through to QuickBooks on InvoiceDate,
 * so revenue is already recognized in QB in the month of InvoiceDate. The
 * month-end adjustment is simply: (earned in period by rental dates) −
 * (booked in period by invoice date). Positive = accrual (move revenue IN),
 * negative = deferral (move revenue OUT).
 *
 * Revenue filter: GL account number must start with "4" (standard US chart
 * of accounts revenue range). Excludes AR (11xxx), inventory (17xxx), tax
 * payable (21xxx), COGS/expenses (5xxxx+) even when RW tags them INCOME.
 */
export function accrueInvoiceByAccount(
  inv: InvoiceForAccrual,
  periodYear: number,
  periodMonth: number,
): AccountAccrualLine[] {
  const invMonth = inv.invoiceDate.getUTCMonth() + 1;
  const invYear = inv.invoiceDate.getUTCFullYear();
  const billedInPeriod = invYear === periodYear && invMonth === periodMonth;

  const results: AccountAccrualLine[] = [];

  for (const line of inv.glLines) {
    if (!isRevenueAccount(line.glAccountNo, line.groupHeading)) continue;
    const netCredit = (line.credit ?? 0) - (line.debit ?? 0);
    if (netCredit === 0) continue;

    const row: RentalRow = {
      contractId: `${inv.invoiceId}:${line.glAccountNo}`,
      customerName: inv.customerName,
      description: `${inv.invoiceNumber} — ${line.glAccountDescription}`,
      rentalStart: inv.rentalStart,
      rentalEnd: inv.rentalEnd,
      totalContractValue: netCredit,
      billedAmount: billedInPeriod ? netCredit : 0,
    };

    const calc = calculateLine(row, periodYear, periodMonth);

    results.push({
      ...calc,
      glAccountNo: line.glAccountNo,
      glAccountDescription: line.glAccountDescription,
      glAccountId: line.glAccountId,
      groupHeading: line.groupHeading,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate.toISOString().split("T")[0],
    });
  }

  return results;
}

/**
 * Aggregate per-invoice, per-account lines into totals by GL account for the JE.
 */
export interface AccountAccrualTotal {
  glAccountNo: string;
  glAccountDescription: string;
  glAccountId: string;
  earnedRevenue: number;
  billedAmount: number;
  accrualAmount: number; // earned > billed
  deferralAmount: number; // billed > earned
  lineCount: number;
}

export function aggregateByAccount(
  lines: AccountAccrualLine[],
): AccountAccrualTotal[] {
  const map = new Map<string, AccountAccrualTotal>();

  for (const l of lines) {
    const key = l.glAccountNo;
    const existing = map.get(key);
    if (existing) {
      existing.earnedRevenue = round2(existing.earnedRevenue + l.earnedRevenue);
      existing.billedAmount = round2(existing.billedAmount + l.billedAmount);
      existing.lineCount += 1;
    } else {
      map.set(key, {
        glAccountNo: l.glAccountNo,
        glAccountDescription: l.glAccountDescription,
        glAccountId: l.glAccountId,
        earnedRevenue: round2(l.earnedRevenue),
        billedAmount: round2(l.billedAmount),
        accrualAmount: 0,
        deferralAmount: 0,
        lineCount: 1,
      });
    }
  }

  // Compute accrual/deferral at the aggregate level (not line level) so that
  // an over-billed line on one invoice can offset an under-billed line on
  // another within the same account.
  for (const total of map.values()) {
    const diff = total.earnedRevenue - total.billedAmount;
    total.accrualAmount = diff > 0 ? round2(diff) : 0;
    total.deferralAmount = diff < 0 ? round2(Math.abs(diff)) : 0;
  }

  return Array.from(map.values()).sort((a, b) =>
    a.glAccountNo.localeCompare(b.glAccountNo),
  );
}

/**
 * Proposed JE with DR Unbilled AR / CR each revenue account for the net
 * accrual, and the inverse for deferrals.
 */
export interface ProposedJELine {
  lineNo: number;
  accountNumber: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string;
}

/**
 * Total unbilled-earned exposure for the period. The unbilled JE collapses
 * to a single revenue credit because RentalWorks doesn't expose per-I-code
 * GL data on uninvoiced orders — the actual GL coding flows through the
 * invoice GL Distribution next month, so there's no point pretending to
 * know it now.
 */
export interface UnbilledTotals {
  grossAmount: number;
  /** grossAmount × realizationRate. */
  netAmount: number;
}

/**
 * Build three separate proposed JEs for the period:
 *
 *   - `timingAccrual` — accrual from invoices that were invoiced in a period
 *     other than the target month but whose rental period overlaps the
 *     target month. Recognized at 100% (no realization discount needed —
 *     the actual invoice amount is known). DR Accrued Revenue / CR revenue
 *     GLs, split per account.
 *
 *   - `unbilledAccrual` — accrual from active orders whose rental period
 *     overlaps but which haven't been invoiced at all. Recognized at the
 *     realization rate (variable-consideration estimate per ASC 606). Three
 *     lines: DR Unbilled Receivables (gross) / CR Unbilled Revenue catch-all
 *     (net) / CR Allowance for Discounts (discount portion).
 *
 *   - `deferral` — invoices dated in-period whose rental period is outside
 *     the target month. DR revenue GLs per account / CR Deferred Revenue.
 */
export function buildSplitProposedJEs(
  invoiceTotals: AccountAccrualTotal[],
  unbilledTotals: UnbilledTotals,
  periodYear: number,
  periodMonth: number,
  opts: {
    realizationRate: number;
    accruedRevAccount?: { number: string; name: string };
    unbilledArAccount?: { number: string; name: string };
    unbilledRevenueAccount?: { number: string; name: string };
    deferredRevAccount?: { number: string; name: string };
    allowanceAccount?: { number: string; name: string };
  },
): {
  timingAccrual: ProposedJELine[];
  unbilledAccrual: ProposedJELine[];
  deferral: ProposedJELine[];
} {
  const periodLabel = `${String(periodMonth).padStart(2, "0")}/${periodYear}`;
  const accruedRevAccount = opts.accruedRevAccount ?? {
    number: "",
    name: "Accrued Revenue (Asset)",
  };
  const unbilledArAccount = opts.unbilledArAccount ?? {
    number: "",
    name: "Unbilled Receivables (Asset)",
  };
  const unbilledRevenueAccount = opts.unbilledRevenueAccount ?? {
    number: "",
    name: "Unbilled Revenue (Catch-All Income)",
  };
  const deferredRevAccount = opts.deferredRevAccount ?? {
    number: "",
    name: "Deferred Revenue (Liability)",
  };
  const allowanceAccount = opts.allowanceAccount ?? {
    number: "",
    name: "Allowance for Discounts (Contra-Revenue)",
  };

  // 1. Timing accrual — from invoices (100%)
  const timingLines: ProposedJELine[] = [];
  const totalTimingAccrual = round2(
    invoiceTotals.reduce((s, t) => s + t.accrualAmount, 0),
  );
  if (totalTimingAccrual > 0) {
    let n = 0;
    timingLines.push({
      lineNo: ++n,
      accountNumber: accruedRevAccount.number,
      accountName: accruedRevAccount.name,
      debit: totalTimingAccrual,
      credit: 0,
      memo: `Timing accrual — invoiced in a different period — ${periodLabel}`,
    });
    for (const t of invoiceTotals) {
      if (t.accrualAmount > 0) {
        timingLines.push({
          lineNo: ++n,
          accountNumber: t.glAccountNo,
          accountName: t.glAccountDescription,
          debit: 0,
          credit: t.accrualAmount,
          memo: `Earned this period, invoice dated elsewhere — ${periodLabel}`,
        });
      }
    }
  }

  // 2. Unbilled accrual — from active orders (rate-adjusted), credited as a
  //    single catch-all bucket. Per-I-code GL coding lands when the invoice
  //    actually gets cut next month.
  const unbilledLines: ProposedJELine[] = [];
  const totalUnbilledGross = round2(unbilledTotals.grossAmount);
  const totalUnbilledNet = round2(unbilledTotals.netAmount);
  const allowance = round2(totalUnbilledGross - totalUnbilledNet);
  const ratePct = Math.round(opts.realizationRate * 1000) / 10;
  if (totalUnbilledGross > 0) {
    let n = 0;
    unbilledLines.push({
      lineNo: ++n,
      accountNumber: unbilledArAccount.number,
      accountName: unbilledArAccount.name,
      debit: totalUnbilledGross,
      credit: 0,
      memo: `Unbilled earned revenue (gross) — ${periodLabel}`,
    });
    if (totalUnbilledNet > 0) {
      unbilledLines.push({
        lineNo: ++n,
        accountNumber: unbilledRevenueAccount.number,
        accountName: unbilledRevenueAccount.name,
        debit: 0,
        credit: totalUnbilledNet,
        memo: `Projected revenue @ ${ratePct}% realization — ${periodLabel}`,
      });
    }
    if (allowance > 0) {
      unbilledLines.push({
        lineNo: ++n,
        accountNumber: allowanceAccount.number,
        accountName: allowanceAccount.name,
        debit: 0,
        credit: allowance,
        memo: `Expected discount (${(100 - ratePct).toFixed(1)}%) — ${periodLabel}`,
      });
    }
  }

  // 3. Deferral — unchanged, from invoices
  const deferralLines: ProposedJELine[] = [];
  const totalDeferral = round2(
    invoiceTotals.reduce((s, t) => s + t.deferralAmount, 0),
  );
  if (totalDeferral > 0) {
    let n = 0;
    for (const t of invoiceTotals) {
      if (t.deferralAmount > 0) {
        deferralLines.push({
          lineNo: ++n,
          accountNumber: t.glAccountNo,
          accountName: t.glAccountDescription,
          debit: t.deferralAmount,
          credit: 0,
          memo: `Billed but not yet earned — ${periodLabel}`,
        });
      }
    }
    deferralLines.push({
      lineNo: ++n,
      accountNumber: deferredRevAccount.number,
      accountName: deferredRevAccount.name,
      debit: 0,
      credit: totalDeferral,
      memo: `Deferred revenue — ${periodLabel}`,
    });
  }

  return {
    timingAccrual: timingLines,
    unbilledAccrual: unbilledLines,
    deferral: deferralLines,
  };
}

/**
 * Legacy single-accrual shape. Retained for backward compatibility but the
 * new callers should use `buildSplitProposedJEs` which separates invoice
 * timing accruals from unbilled-order accruals.
 */
export function buildProposedJE(
  totals: AccountAccrualTotal[],
  periodYear: number,
  periodMonth: number,
  unbilledArAccount = { number: "", name: "Unbilled Receivables (Asset)" },
  deferredRevAccount = { number: "", name: "Deferred Revenue (Liability)" },
): { accrual: ProposedJELine[]; deferral: ProposedJELine[]; netByAccount: AccountAccrualTotal[] } {
  const periodLabel = `${String(periodMonth).padStart(2, "0")}/${periodYear}`;
  const accrualLines: ProposedJELine[] = [];
  const deferralLines: ProposedJELine[] = [];
  let n = 0;

  const totalAccrual = round2(totals.reduce((s, t) => s + t.accrualAmount, 0));
  const totalDeferral = round2(totals.reduce((s, t) => s + t.deferralAmount, 0));

  if (totalAccrual > 0) {
    accrualLines.push({
      lineNo: ++n,
      accountNumber: unbilledArAccount.number,
      accountName: unbilledArAccount.name,
      debit: totalAccrual,
      credit: 0,
      memo: `Unbilled earned revenue — ${periodLabel}`,
    });
    for (const t of totals) {
      if (t.accrualAmount > 0) {
        accrualLines.push({
          lineNo: ++n,
          accountNumber: t.glAccountNo,
          accountName: t.glAccountDescription,
          debit: 0,
          credit: t.accrualAmount,
          memo: `Earned but not yet billed in QBO — ${periodLabel}`,
        });
      }
    }
  }

  n = 0;
  if (totalDeferral > 0) {
    for (const t of totals) {
      if (t.deferralAmount > 0) {
        deferralLines.push({
          lineNo: ++n,
          accountNumber: t.glAccountNo,
          accountName: t.glAccountDescription,
          debit: t.deferralAmount,
          credit: 0,
          memo: `Billed but not yet earned — ${periodLabel}`,
        });
      }
    }
    deferralLines.push({
      lineNo: ++n,
      accountNumber: deferredRevAccount.number,
      accountName: deferredRevAccount.name,
      debit: 0,
      credit: totalDeferral,
      memo: `Deferred revenue — ${periodLabel}`,
    });
  }

  return { accrual: accrualLines, deferral: deferralLines, netByAccount: totals };
}

/**
 * Determine whether a GL line is an actual revenue account.
 *
 * Primary signal: GL account number starts with "4" (standard US COA
 * convention for revenue). This correctly excludes AR (11xxx), inventory
 * assets (17xxx), tax payable (21xxx), COGS (5xxxx), and expenses (6xxxx+)
 * even when RentalWorks tags them all as GroupHeading="INCOME".
 *
 * Secondary signal (fallback for non-standard charts): explicit
 * "REVENUE"/"SALES" group heading.
 */
function isRevenueAccount(glAccountNo: string, groupHeading: string): boolean {
  const acctNo = String(glAccountNo ?? "");
  // Balance sheet accounts (1xxx assets, 2xxx liabilities, 3xxx equity) always skipped.
  if (/^[123]/.test(acctNo)) return false;
  // Expense accounts (5xxx–9xxx) always skipped.
  if (/^[5-9]/.test(acctNo)) return false;
  // 4xxxx = revenue.
  if (/^4/.test(acctNo)) return true;
  // Non-numeric or non-standard prefixes — fall back to group heading.
  const g = (groupHeading ?? "").toUpperCase();
  return g === "REVENUE" || g === "SALES";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
