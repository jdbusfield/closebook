/**
 * Personnel Costs on the management chart: master 6100 plus the 61x0
 * sub-masters created by scripts/budget-personnel-submasters.mjs. The
 * statements engine rolls the children into 6100; budgets, payroll preview
 * and drill-down work at the child level.
 */

export const PERSONNEL_PARENT_NUMBER = "6100";

export type PersonnelComponent =
  | "wages"
  | "overtime"
  | "bonus_commission"
  | "payroll_taxes"
  | "benefits"
  | "workers_comp"
  | "pto"
  | "fees_other";

export const PERSONNEL_SUB_MASTERS: Array<{
  number: string;
  name: string;
  component: PersonnelComponent;
}> = [
  { number: "6110", name: "Wages & Salaries", component: "wages" },
  { number: "6120", name: "Overtime & Premiums", component: "overtime" },
  { number: "6130", name: "Bonus & Commissions", component: "bonus_commission" },
  { number: "6140", name: "Employer Payroll Taxes", component: "payroll_taxes" },
  { number: "6150", name: "Employee Benefits", component: "benefits" },
  { number: "6160", name: "Workers Comp", component: "workers_comp" },
  { number: "6170", name: "PTO", component: "pto" },
  { number: "6180", name: "Payroll Fees & Other Personnel", component: "fees_other" },
];

export const PERSONNEL_NUMBERS = new Set([
  PERSONNEL_PARENT_NUMBER,
  ...PERSONNEL_SUB_MASTERS.map((s) => s.number),
]);

/** Name fallback for charts that do not use the 61x0 numbering. */
const PERSONNEL_NAME = /personnel|payroll|salar|wage/i;

export function isPersonnelMaster(account: {
  account_number?: string | null;
  name?: string | null;
  parent_account_id?: string | null;
}, parentIds?: Set<string>): boolean {
  if (account.account_number && PERSONNEL_NUMBERS.has(account.account_number)) return true;
  if (parentIds && account.parent_account_id && parentIds.has(account.parent_account_id)) return true;
  return PERSONNEL_NAME.test(account.name ?? "");
}

export function subMasterNumberForComponent(component: PersonnelComponent): string {
  return PERSONNEL_SUB_MASTERS.find((s) => s.component === component)!.number;
}
