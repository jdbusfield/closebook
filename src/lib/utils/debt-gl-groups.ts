export interface DebtGLAccountGroup {
  key: string;
  displayName: string;
  description: string;
}

/**
 * GL account groups for debt reconciliation.
 * Each group maps to one or more entity-level GL accounts
 * configured in debt_reconciliation_accounts.
 *
 * Subledger balances = original_amount + actual transactions through
 * end of period (NOT amortization schedule assumptions).
 */
export const DEBT_GL_ACCOUNT_GROUPS: DebtGLAccountGroup[] = [
  {
    key: "notes_payable_long_term",
    displayName: "Notes Payable",
    description: "Total outstanding balance on term debt instruments at end of period",
  },
  {
    key: "loc_payable",
    displayName: "Line of Credit",
    description: "Total outstanding balance on revolving lines of credit at end of period",
  },
  {
    key: "interest_payable",
    displayName: "Interest Payable",
    description: "Accrued interest expense for the period",
  },
  {
    key: "interest_expense",
    displayName: "Interest Expense",
    description: "YTD interest expense per amortization schedules",
  },
];

const LOC_TYPES = new Set(["line_of_credit", "revolving_credit", "investor_loc"]);

/**
 * Determine which GL account group a debt instrument belongs to.
 */
export function getDebtGLGroup(debtType: string): string {
  if (LOC_TYPES.has(debtType)) return "loc_payable";
  return "notes_payable_long_term";
}
