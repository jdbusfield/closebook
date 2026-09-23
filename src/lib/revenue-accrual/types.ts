/**
 * Month-end revenue accrual / deferral for quote-driven rental businesses
 * (built for Hollywood Depot Rentals / Walk & Talk).
 *
 * Inputs are the Quotes Report (one row per quote, rental dates + pre-tax
 * total) and QuickBooks sales documents (invoices, sales receipts, credit
 * memos, refunds) with their lines, classes and create times.
 */

/** YYYY-MM-DD */
export type IsoDate = string;

export interface Quote {
  id: string;
  project: string;
  start: IsoDate;
  end: IsoDate;
  /** Pre-tax quote total (the "Column8" value). */
  amount: number;
  status: string;
  salesRep?: string | null;
  path?: string | null;
  version?: number | null;
}

export interface DocLine {
  amount: number;
  description: string;
  /** e.g. "49006" */
  accountNumber: string | null;
  /** Fully qualified QuickBooks account name, e.g. "Production Supplies:Production Supplies Rental:Power and Lighting" */
  accountName: string;
  className: string | null;
}

export type DocType = "Invoice" | "SalesReceipt" | "CreditMemo" | "RefundReceipt";

export interface Doc {
  /** Unique: type + QuickBooks id */
  key: string;
  num: string;
  type: DocType;
  date: IsoDate;
  /** ISO timestamp the document was created in QuickBooks */
  created: string | null;
  /** Fully qualified customer name, e.g. "20th Television:911:911 S10 (HDR Location)" */
  customer: string;
  lines: DocLine[];
  /** Parsed "Rental Period" custom field, when present */
  rentalPeriod?: { start: IsoDate; end: IsoDate } | null;
}

export interface BookedJournal {
  num: string;
  date: IsoDate;
  created: string | null;
  /** Net credit to revenue accounts (positive = revenue up) */
  revenueCredit: number;
}

export interface AccountRef {
  number: string | null;
  name: string;
}

export interface TypeRule {
  /** Case-insensitive substring matched against the quote file path and project */
  match: string;
  account: AccountRef;
  className: string;
}

export interface AccrualSettings {
  accruedAccount: AccountRef;
  deferredAccount: AccountRef;
  /** Account number prefixes that never accrue or defer (sublease rent, ticket resales, sales tax) */
  excludeAccountPrefixes: string[];
  /** Quote project key → QuickBooks customer key (both normalized) */
  aliases: Record<string, string>;
  /** Used for quote-only accruals when the job has no invoice history */
  typeRules: TypeRule[];
  defaultAccount: AccountRef;
  defaultClass: string;
  /** Quote statuses that count as booked work */
  approvedStatuses: string[];
}

export type ItemKind = "accrual" | "deferral";
export type ItemTier = "confirmed" | "job" | "quote" | "review";

export interface Allocation {
  account: AccountRef;
  className: string | null;
  amount: number;
}

export interface AccrualItem {
  /** Stable id so review decisions survive a re-run */
  id: string;
  kind: ItemKind;
  tier: ItemTier;
  source: string;
  reason: string;
  amount: number;
  defaultInclude: boolean;
  allocation: Allocation[];
  allocationSource: string;
  quoteId?: string | null;
  project?: string | null;
  quoteStart?: IsoDate | null;
  quoteEnd?: IsoDate | null;
  quoteAmount?: number | null;
  docNum?: string | null;
  docType?: DocType | null;
  docDate?: IsoDate | null;
  docCreated?: string | null;
  docAmount?: number | null;
  customer?: string | null;
  memo?: string | null;
}

export interface MonthRef {
  year: number;
  month: number;
}

export interface RunResult {
  period: MonthRef;
  periodEnd: IsoDate;
  items: AccrualItem[];
  stats: {
    quotes: number;
    quotesInWindow: number;
    docs: number;
    docsMatched: number;
    docsMatchedAmount: number;
    docsAmount: number;
  };
  unmatchedDocs: { num: string; type: DocType; date: IsoDate; customer: string; amount: number }[];
}
