// Maps QBO account_type values to financial statement sections.
// Used by the financial statements API to group accounts into
// standard Income Statement, Balance Sheet, and Cash Flow sections.

export interface StatementSectionConfig {
  id: string;
  title: string;
  accountTypes: string[];
  classification: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
}

export interface ComputedLineConfig {
  id: string;
  label: string;
  /** Insert after this section id */
  afterSection: string;
  /** How to compute: array of { sectionId, sign } */
  formula: Array<{ sectionId: string; sign: 1 | -1 }>;
  isGrandTotal?: boolean;
}

// ---------------------------------------------------------------------------
// INCOME STATEMENT SECTIONS
// ---------------------------------------------------------------------------

export const INCOME_STATEMENT_SECTIONS: StatementSectionConfig[] = [
  {
    id: "revenue",
    title: "Revenue",
    accountTypes: ["Income"],
    classification: "Revenue",
  },
  {
    id: "direct_operating_costs",
    title: "Direct Operating Costs",
    accountTypes: ["Cost of Goods Sold"],
    classification: "Expense",
  },
  {
    id: "other_operating_costs",
    title: "Other Operating Costs",
    accountTypes: ["Expense"],
    classification: "Expense",
  },
  {
    id: "other_expense",
    title: "",
    accountTypes: ["Other Expense"],
    classification: "Expense",
  },
  {
    id: "other_income",
    title: "",
    accountTypes: ["Other Income"],
    classification: "Revenue",
  },
];

export const INCOME_STATEMENT_COMPUTED: ComputedLineConfig[] = [
  {
    id: "gross_margin",
    label: "Gross Margin",
    afterSection: "direct_operating_costs",
    formula: [
      { sectionId: "revenue", sign: 1 },
      { sectionId: "direct_operating_costs", sign: -1 },
    ],
  },
  {
    id: "operating_margin",
    label: "Total Operating Margin",
    afterSection: "other_operating_costs",
    formula: [
      { sectionId: "revenue", sign: 1 },
      { sectionId: "direct_operating_costs", sign: -1 },
      { sectionId: "other_operating_costs", sign: -1 },
    ],
  },
  {
    id: "net_income",
    label: "Net Income",
    afterSection: "other_income",
    formula: [
      { sectionId: "revenue", sign: 1 },
      { sectionId: "direct_operating_costs", sign: -1 },
      { sectionId: "other_operating_costs", sign: -1 },
      { sectionId: "other_income", sign: 1 },
      { sectionId: "other_expense", sign: -1 },
    ],
    isGrandTotal: true,
  },
];

// ---------------------------------------------------------------------------
// BALANCE SHEET SECTIONS
// ---------------------------------------------------------------------------

export const BALANCE_SHEET_SECTIONS: StatementSectionConfig[] = [
  {
    id: "current_assets",
    title: "CURRENT ASSETS",
    accountTypes: ["Bank", "Accounts Receivable", "Other Current Asset"],
    classification: "Asset",
  },
  {
    id: "fixed_assets",
    title: "PROPERTY AND EQUIPMENT, NET",
    accountTypes: ["Fixed Asset"],
    classification: "Asset",
  },
  {
    id: "other_assets",
    title: "OTHER ASSETS",
    accountTypes: ["Other Asset"],
    classification: "Asset",
  },
  {
    id: "current_liabilities",
    title: "CURRENT LIABILITIES",
    accountTypes: ["Accounts Payable", "Credit Card", "Other Current Liability"],
    classification: "Liability",
  },
  {
    id: "long_term_liabilities",
    title: "LONG-TERM LIABILITIES",
    accountTypes: ["Long Term Liability"],
    classification: "Liability",
  },
  {
    id: "equity",
    title: "STOCKHOLDERS' EQUITY",
    accountTypes: ["Equity"],
    classification: "Equity",
  },
];

export const BALANCE_SHEET_COMPUTED: ComputedLineConfig[] = [
  {
    id: "total_current_assets",
    label: "Total current assets",
    afterSection: "current_assets",
    formula: [{ sectionId: "current_assets", sign: 1 }],
  },
  {
    id: "total_assets",
    label: "TOTAL ASSETS",
    afterSection: "other_assets",
    formula: [
      { sectionId: "current_assets", sign: 1 },
      { sectionId: "fixed_assets", sign: 1 },
      { sectionId: "other_assets", sign: 1 },
    ],
    isGrandTotal: true,
  },
  {
    id: "total_current_liabilities",
    label: "Total current liabilities",
    afterSection: "current_liabilities",
    formula: [{ sectionId: "current_liabilities", sign: 1 }],
  },
  {
    id: "total_liabilities",
    label: "Total liabilities",
    afterSection: "long_term_liabilities",
    formula: [
      { sectionId: "current_liabilities", sign: 1 },
      { sectionId: "long_term_liabilities", sign: 1 },
    ],
  },
  {
    id: "total_equity",
    label: "Total stockholders' equity",
    afterSection: "equity",
    formula: [{ sectionId: "equity", sign: 1 }],
  },
  {
    id: "total_liabilities_and_equity",
    label: "TOTAL LIABILITIES AND STOCKHOLDERS' EQUITY",
    afterSection: "equity",
    formula: [
      { sectionId: "current_liabilities", sign: 1 },
      { sectionId: "long_term_liabilities", sign: 1 },
      { sectionId: "equity", sign: 1 },
    ],
    isGrandTotal: true,
  },
];

// ---------------------------------------------------------------------------
// CASH FLOW — account type classification for derivation
// ---------------------------------------------------------------------------

export const CASH_ACCOUNT_TYPES = ["Bank"];

export const OPERATING_CURRENT_ASSET_TYPES = [
  "Accounts Receivable",
  "Other Current Asset",
];

export const OPERATING_CURRENT_LIABILITY_TYPES = [
  "Accounts Payable",
  "Credit Card",
  "Other Current Liability",
];

export const INVESTING_ACCOUNT_TYPES = ["Fixed Asset", "Other Asset"];

export const FINANCING_LIABILITY_TYPES = ["Long Term Liability"];

export const FINANCING_EQUITY_TYPES = ["Equity"];

// ---------------------------------------------------------------------------
// ROU LEASE — name patterns for reclassifying non-cash ASC 842 entries
// ---------------------------------------------------------------------------
// Under ASC 842 / GAAP, ROU asset recognition and lease liability recognition
// are non-cash transactions. Their balance changes should NOT appear in
// Investing or Financing respectively.  Instead, they are reclassified to
// Operating so that:
//   • ROU asset amortization (non-cash) is effectively added back like D&A
//   • Lease liability reductions (cash payments) appear as operating outflows
// Patterns are matched case-insensitively against master account names.
// ---------------------------------------------------------------------------

export const ROU_ASSET_NAME_PATTERNS = [
  "right of use",
  "rou lease asset",
  "rou asset",
];

export const ROU_LIABILITY_NAME_PATTERNS = [
  "right of use lease",
  "rou lease liab",
];

// ---------------------------------------------------------------------------
// CASH FLOW — line-of-credit / short-term debt reclassification
// ---------------------------------------------------------------------------
// Revolving lines of credit and short-term borrowings are classified by QBO as
// "Other Current Liability", which would route their movement through Operating
// activities.  Under ASC 230-10-45-14/15, borrowings and repayments of debt
// (including revolving lines) are FINANCING activities.  Master accounts whose
// names match these patterns are moved from Operating working-capital changes
// into the Financing section of the statement of cash flows.
// Patterns are matched case-insensitively against master account names.
// ---------------------------------------------------------------------------

export const LINE_OF_CREDIT_NAME_PATTERNS = [
  "line of credit",
  "short term line",
  "short-term line",
  "revolv",
];

// ---------------------------------------------------------------------------
// CASH FLOW — intangible / goodwill non-cash amortization
// ---------------------------------------------------------------------------
// Goodwill and other intangible assets are classified as "Other Asset" and
// would otherwise flow through Investing activities as their carrying value
// declines.  That decline is non-cash amortization (ASC 230-10-45-28) and
// belongs in the Operating add-back instead.  Master accounts whose names match
// these patterns are excluded from Investing and their period decline is added
// back to "Depreciation and amortization" in Operating activities.
// Patterns are matched case-insensitively against master account names.
// ---------------------------------------------------------------------------

export const INTANGIBLE_ASSET_NAME_PATTERNS = [
  "goodwill",
  "intangible",
  "amortizable",
];

// ---------------------------------------------------------------------------
// ENTITY-LEVEL RECLASSIFICATION
// ---------------------------------------------------------------------------
// QBO classifies all expense accounts as "Expense", but the financial model
// needs certain non-operating items separated into "Other Expense".
// These case-insensitive name patterns mirror the master GL template rules.
// Only applied to accounts with classification="Expense" & accountType="Expense".
// ---------------------------------------------------------------------------

export const OTHER_EXPENSE_NAME_PATTERNS: string[] = [
  "vehicle depreciation",
  "interest expense",
  "interest",
  "tax",
  "amortization",
  "goodwill",
  "gain",
  "loss on sale",
  "loss on disposal",
  "fixed asset depreciation",
  "depreciation",
];
