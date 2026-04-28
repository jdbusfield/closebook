// TypeScript interfaces for the three-statement financial model

export type Granularity = "monthly" | "quarterly" | "yearly";
export type Scope = "entity" | "organization" | "reporting_entity";
export type StatementTab = "income-statement" | "balance-sheet" | "cash-flow" | "pro-forma" | "allocations" | "entity-breakdown" | "re-breakdown" | "all";
export type VarianceDisplayMode = "dollars" | "percentage";

/** A single time period column in the statements */
export interface Period {
  key: string;          // Unique key for lookups, e.g. "2025-12", "2025-Q4", "FY2025"
  label: string;        // Display label, e.g. "Dec 2025", "Q4 2025", "FY 2025"
  year: number;
  startMonth: number;   // First month in the period (1-12)
  endMonth: number;     // Last month in the period (1-12)
  endYear: number;      // Year of the last month (may differ from year for fiscal years)
  isTotal?: boolean;    // True for the synthetic "Total" column
}

/** Metadata enabling cell drill-down to entity/account detail */
export type DrillDownLineType = "account" | "section_total" | "computed" | "percentage" | "none";

export interface DrillDownMeta {
  type: DrillDownLineType;
  /** For 'account': the single master_account_id this line represents */
  masterAccountIds?: string[];
  /** For 'section_total': the section config IDs to resolve */
  sectionIds?: string[];
  /** For 'computed': the formula with signed section references */
  formula?: Array<{ sectionId: string; sign: 1 | -1 }>;
  /** Which statement type (determines net_change vs ending_balance) */
  statementType?: "income_statement" | "balance_sheet" | "cash_flow";
}

/** A single row in a financial statement */
export interface LineItem {
  id: string;
  label: string;
  accountNumber?: string;
  /** Amounts keyed by Period.key */
  amounts: Record<string, number>;
  /** Budget amounts keyed by Period.key */
  budgetAmounts?: Record<string, number>;
  /** Prior year amounts keyed by Period.key */
  priorYearAmounts?: Record<string, number>;
  indent: number;           // 0=section header, 1=line item, 2=sub-line
  isTotal: boolean;         // Subtotal row (single underline)
  isGrandTotal: boolean;    // Grand total row (double underline)
  isHeader: boolean;        // Section header (bold, no amounts)
  isSeparator: boolean;     // Blank separator row
  showDollarSign: boolean;  // Show $ on this row
  varianceInvertColor?: boolean;  // When true, positive variance is unfavorable (expense items)
  drillDownMeta?: DrillDownMeta;
}

/** A group of line items under a section header */
export interface StatementSection {
  id: string;
  title: string;            // "REVENUE", "COST OF GOODS SOLD", etc.
  lines: LineItem[];
  subtotalLine?: LineItem;
}

/** A complete financial statement (IS, BS, or CFS) */
export interface StatementData {
  id: string;               // "income_statement", "balance_sheet", "cash_flow"
  title: string;            // "Income Statement", "Balance Sheet", etc.
  sections: StatementSection[];
}

/** A pro forma adjustment detail for display in the detail schedule */
export interface ProFormaAdjustmentDetail {
  id: string;
  entityCode: string;
  entityName: string;
  accountNumber: string;
  accountName: string;
  offsetAccountNumber: string | null;
  offsetAccountName: string | null;
  description: string;
  notes: string | null;
  periodYear: number;
  periodMonth: number;
  amount: number;
  /** Period bucket key this adjustment falls into (matches Period.key) */
  bucketKey: string;
}

/** Full response from the financial statements API */
/** Diagnostic info returned by the API to verify data completeness. */
export interface DataDiagnostics {
  /** Number of master accounts (or entity accounts for entity scope) loaded */
  masterAccountsLoaded: number;
  /** Number of master_account_mappings loaded (org/RE scope only) */
  mappingsLoaded: number;
  /** Number of raw GL balance rows fetched from the database (before filtering) */
  glRowsFetchedRaw: number;
  /** Number of GL balance rows after filtering to requested period/accounts */
  glRowsAfterFilter: number;
  /** Number of unique entity accounts with at least one GL balance row */
  uniqueAccountsWithData: number;
  /** Number of entities contributing data */
  entityCount: number;
  /** Whether any pagination errors occurred (data may be incomplete) */
  paginationErrors: boolean;
  /** Balance sheet check: Assets - (Liabilities + Equity) per period. All zeros = balanced. */
  bsCheck: Record<string, number>;
}

export interface FinancialStatementsResponse {
  periods: Period[];
  incomeStatement: StatementData;
  balanceSheet: StatementData;
  cashFlowStatement: StatementData;
  metadata: {
    entityName?: string;
    organizationName?: string;
    reportingEntityName?: string;
    generatedAt: string;
    scope: Scope;
    granularity: Granularity;
    startPeriod: string;
    endPeriod: string;
  };
  /** Optional data-completeness diagnostics (always present when data is returned) */
  diagnostics?: DataDiagnostics;
  /** Pro forma adjustment details when includeProForma is true (for detail schedule display) */
  proFormaAdjustments?: ProFormaAdjustmentDetail[];
}

/** Config object passed to the API and shared between components */
export interface FinancialModelConfig {
  scope: Scope;
  entityId?: string;
  organizationId?: string;
  reportingEntityId?: string;
  /**
   * Master GL chart to roll up by. Omit to use the organization's
   * default (management) chart.
   */
  chartId?: string;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: Granularity;
  includeBudget: boolean;
  includeYoY: boolean;
  includeProForma: boolean;
  includeAllocations: boolean;
  includeTotal: boolean;
}

/** A pro forma adjustment row from the database */
export interface ProFormaAdjustment {
  id: string;
  organization_id: string;
  entity_id: string;
  master_account_id: string;
  offset_master_account_id: string | null;
  period_year: number;
  period_month: number;
  amount: number;
  description: string;
  notes: string | null;
  is_excluded: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields for display
  entity_name?: string;
  entity_code?: string;
  master_account_name?: string;
  master_account_number?: string;
  offset_master_account_name?: string;
  offset_master_account_number?: string;
}

/** An allocation adjustment row from the database */
export interface AllocationAdjustment {
  id: string;
  organization_id: string;
  source_entity_id: string;
  destination_entity_id: string;
  master_account_id: string;
  destination_master_account_id: string | null;
  amount: number;
  description: string;
  notes: string | null;
  is_excluded: boolean;
  schedule_type: "single_month" | "monthly_spread";
  period_year: number | null;
  period_month: number | null;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  is_repeating: boolean;
  repeat_end_year: number | null;
  repeat_end_month: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields for display
  source_entity_name?: string;
  source_entity_code?: string;
  destination_entity_name?: string;
  destination_entity_code?: string;
  master_account_name?: string;
  master_account_number?: string;
  destination_master_account_name?: string;
  destination_master_account_number?: string;
}

/** A column in the entity-breakdown view */
export interface EntityColumn {
  key: string;       // entity ID or "consolidated"
  label: string;     // entity code or "Consolidated"
  fullName: string;  // entity full name
}

/** Response from the entity-breakdown API */
export interface EntityBreakdownResponse {
  columns: EntityColumn[];
  incomeStatement: StatementData;
  balanceSheet: StatementData;
  metadata: {
    organizationName?: string;
    generatedAt: string;
    startPeriod: string;
    endPeriod: string;
  };
}

// ---------------------------------------------------------------------------
// Drill-down types
// ---------------------------------------------------------------------------

/** A single entity+account row in the drill-down detail */
export interface DrillDownEntityRow {
  entityId: string;
  entityCode: string;
  entityName: string;
  accountId: string;
  accountName: string;
  accountNumber: string | null;
  amount: number;
}

/** A group of entity rows for one master account */
export interface DrillDownGroup {
  masterAccountId: string;
  masterAccountName: string;
  masterAccountNumber: string | null;
  /** Section label for computed-line grouping (e.g. "Revenue", "Direct Operating Costs") */
  sectionLabel?: string;
  /** Sign applied to this group in computed formulas (+1 or -1) */
  sign: 1 | -1;
  subtotal: number;
  rows: DrillDownEntityRow[];
}

/** An adjustment row (pro forma or allocation) in the drill-down */
export interface DrillDownAdjustmentRow {
  type: "pro_forma" | "allocation";
  entityName: string;
  entityCode: string;
  description: string;
  amount: number;
  sourceEntityName?: string;
  destinationEntityName?: string;
}

/** Full response from the drill-down API */
export interface DrillDownResponse {
  lineLabel: string;
  periodLabel: string;
  total: number;
  groups: DrillDownGroup[];
  adjustments: DrillDownAdjustmentRow[];
}

// ---------------------------------------------------------------------------
// Intercompany Eliminations types
// ---------------------------------------------------------------------------

/** A counterparty balance within an entity's intercompany section */
export interface ICCounterpartyBalance {
  counterpartyName: string;
  /** Matched entity ID for the counterparty (if resolvable) */
  counterpartyEntityId?: string;
  counterpartyCode?: string;
  /** Receivable: what this entity is owed BY the counterparty */
  dueFromBalance: number;
  /** Payable: what this entity owes TO the counterparty (positive = liability) */
  dueToBalance: number;
  /** dueFromBalance - dueToBalance */
  netPosition: number;
}

/** Per-entity intercompany summary */
export interface ICEntityDetail {
  entityId: string;
  entityCode: string;
  entityName: string;
  counterparties: ICCounterpartyBalance[];
  totalDueFrom: number;
  totalDueTo: number;
  totalNet: number;
}

/** A cross-entity elimination pair – net-zero check.
 *  For any two entities A and B, the net of ALL intercompany accounts
 *  between them must cancel: (A's net with B) + (B's net with A) = 0.
 */
export interface ICEliminationPair {
  entityAId: string;
  entityACode: string;
  entityAName: string;
  entityBId: string;
  entityBCode: string;
  entityBName: string;
  /** Entity A's receivable from B */
  aDueFromB: number;
  /** Entity A's payable to B */
  aDueToB: number;
  /** A's net position with B  = Due From B − Due To B */
  aNetWithB: number;
  /** Entity B's receivable from A */
  bDueFromA: number;
  /** Entity B's payable to A */
  bDueToA: number;
  /** B's net position with A  = Due From A − Due To A */
  bNetWithA: number;
  /** aNetWithB + bNetWithA — should be 0 when balanced */
  netEffect: number;
}

/** Response from the intercompany-eliminations API */
export interface ICEliminationsResponse {
  entityDetails: ICEntityDetail[];
  eliminationPairs: ICEliminationPair[];
  metadata: {
    organizationName?: string;
    generatedAt: string;
    periodLabel: string;
  };
}
