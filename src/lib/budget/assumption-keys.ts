/**
 * Catalog of budget assumption keys. Every rate, cap or growth figure a build
 * uses is one of these, stored per version in budget_assumptions (scope org,
 * reporting_entity, class, employee, asset_group or company) and resolved
 * most-specific-first by AssumptionSet.
 */

export interface AssumptionKeyDef {
  key: string;
  label: string;
  group: "payroll_tax" | "benefits" | "personnel" | "revenue" | "cost" | "capex" | "general";
  unit: "pct" | "usd" | "rate_per_100" | "hours" | "month" | "count" | "ratio";
  /** Default when no row exists for the version. */
  defaultValue: number;
  description: string;
  /** Scopes where an override makes sense. */
  scopes: Array<"org" | "reporting_entity" | "class" | "employee" | "asset_group" | "company">;
}

export const ASSUMPTION_KEYS: AssumptionKeyDef[] = [
  // Payroll taxes (defaults come from tax-tables.ts for the budget year)
  { key: "fica_wage_base", label: "Social Security wage base", group: "payroll_tax", unit: "usd", defaultValue: 184500, description: "Per employee per calendar year. SSA announces each October.", scopes: ["org"] },
  { key: "fica_rate", label: "Social Security rate (ER)", group: "payroll_tax", unit: "pct", defaultValue: 6.2, description: "Employer share.", scopes: ["org"] },
  { key: "medicare_rate", label: "Medicare rate (ER)", group: "payroll_tax", unit: "pct", defaultValue: 1.45, description: "Employer share, no cap.", scopes: ["org"] },
  { key: "futa_rate", label: "FUTA rate", group: "payroll_tax", unit: "pct", defaultValue: 0.6, description: "Net federal rate after state credit.", scopes: ["org"] },
  { key: "futa_cap", label: "FUTA wage base", group: "payroll_tax", unit: "usd", defaultValue: 7000, description: "", scopes: ["org"] },
  { key: "sui_rate", label: "CA SUI rate", group: "payroll_tax", unit: "pct", defaultValue: 3.4, description: "Experience rate per employer from the EDD notice. Override per Paylocity company.", scopes: ["org", "company"] },
  { key: "sui_cap", label: "CA SUI wage base", group: "payroll_tax", unit: "usd", defaultValue: 7000, description: "", scopes: ["org"] },
  { key: "ett_rate", label: "CA ETT rate", group: "payroll_tax", unit: "pct", defaultValue: 0.1, description: "", scopes: ["org"] },
  { key: "ett_cap", label: "CA ETT wage base", group: "payroll_tax", unit: "usd", defaultValue: 7000, description: "", scopes: ["org"] },

  // Benefits and other soft costs
  { key: "benefit_renewal_pct", label: "Benefit renewal increase", group: "benefits", unit: "pct", defaultValue: 0, description: "Applied to medical, dental and vision employer cost from the renewal month.", scopes: ["org", "reporting_entity", "company"] },
  { key: "benefit_renewal_month", label: "Benefit renewal month", group: "benefits", unit: "month", defaultValue: 1, description: "Month the renewal takes effect.", scopes: ["org", "company"] },
  { key: "new_hire_benefits_monthly", label: "New hire benefits per month", group: "benefits", unit: "usd", defaultValue: 0, description: "Employer medical, dental and vision for a requisition after the waiting period.", scopes: ["org", "reporting_entity"] },
  { key: "benefits_waiting_months", label: "Benefits waiting period", group: "benefits", unit: "month", defaultValue: 2, description: "Months after start before benefits cost begins.", scopes: ["org"] },
  { key: "wc_rate_default", label: "Workers comp rate (default)", group: "benefits", unit: "rate_per_100", defaultValue: 0, description: "Per 100 of wages when no class-code rate is set.", scopes: ["org", "reporting_entity"] },
  { key: "wc_rate", label: "Workers comp rate by class code", group: "benefits", unit: "rate_per_100", defaultValue: 0, description: "Scope id = workers comp class code (e.g. 8810).", scopes: ["org"] },
  { key: "wc_experience_mod", label: "Workers comp experience modifier", group: "benefits", unit: "ratio", defaultValue: 1, description: "Multiplies the class rate.", scopes: ["org", "company"] },
  { key: "payroll_fee_per_check", label: "Payroll fee per check", group: "personnel", unit: "usd", defaultValue: 0, description: "Paylocity per-check fee.", scopes: ["org", "company"] },
  { key: "payroll_fee_per_employee_month", label: "Payroll fee per employee per month", group: "personnel", unit: "usd", defaultValue: 0, description: "Paylocity per-employee fees (HR, time, benefits admin).", scopes: ["org", "company"] },
  { key: "pay_periods_per_year", label: "Pay periods per year", group: "personnel", unit: "count", defaultValue: 26, description: "26 biweekly, 24 semi-monthly, 52 weekly.", scopes: ["org", "company"] },
  { key: "pto_accrual_hours_per_period", label: "PTO accrual hours per period (default)", group: "personnel", unit: "hours", defaultValue: 0, description: "Used when a headcount row has no PTO accrual set.", scopes: ["org", "reporting_entity"] },
  { key: "merit_pct_default", label: "Merit increase (default)", group: "personnel", unit: "pct", defaultValue: 0, description: "Applied to rows with no merit set.", scopes: ["org", "reporting_entity"] },
  { key: "merit_month_default", label: "Merit month (default)", group: "personnel", unit: "month", defaultValue: 1, description: "", scopes: ["org", "reporting_entity"] },
  { key: "bonus_accrual", label: "Bonus accrual", group: "personnel", unit: "ratio", defaultValue: 1, description: "1 = accrue bonus target evenly across the year (JD decision); 0 = land in payout month.", scopes: ["org"] },
  { key: "bonus_payout_month", label: "Bonus payout month", group: "personnel", unit: "month", defaultValue: 12, description: "Only used when bonus_accrual = 0.", scopes: ["org"] },
  { key: "recruiting_cost_per_hire", label: "Recruiting cost per hire", group: "personnel", unit: "usd", defaultValue: 0, description: "Lands in a requisition's start month.", scopes: ["org", "reporting_entity"] },

  // Revenue drivers
  { key: "revenue_growth_pct", label: "Revenue growth", group: "revenue", unit: "pct", defaultValue: 0, description: "Applied to trend builds of revenue lines.", scopes: ["org", "reporting_entity"] },
  { key: "utilization_change_pts", label: "Utilization change (points)", group: "revenue", unit: "pct", defaultValue: 0, description: "Added to trailing utilization in the fleet driver.", scopes: ["org", "reporting_entity", "asset_group"] },
  { key: "day_rate_change_pct", label: "Day rate change", group: "revenue", unit: "pct", defaultValue: 0, description: "Applied to trailing charged rate in the fleet driver.", scopes: ["org", "reporting_entity", "asset_group"] },

  // Costs
  { key: "inflation_pct", label: "Inflation", group: "cost", unit: "pct", defaultValue: 3, description: "Applied to trend builds of expense lines.", scopes: ["org", "reporting_entity"] },
  { key: "maintenance_cost_per_unit_month", label: "Maintenance cost per unit per month", group: "cost", unit: "usd", defaultValue: 0, description: "Driver for maintenance lines when set; otherwise trend.", scopes: ["org", "reporting_entity", "asset_group"] },
  { key: "insurance_renewal_pct", label: "Insurance renewal increase", group: "cost", unit: "pct", defaultValue: 0, description: "Applied to policies renewing inside the budget year.", scopes: ["org", "reporting_entity"] },
  { key: "floating_rate_index", label: "Floating rate index", group: "cost", unit: "pct", defaultValue: 0, description: "Index used to reprice floating-rate debt; 0 keeps the schedule rate.", scopes: ["org"] },

  // Capex
  { key: "disposal_proceeds_pct_of_nbv", label: "Disposal proceeds as % of NBV", group: "capex", unit: "pct", defaultValue: 100, description: "Default when a disposal plan item has no expected proceeds.", scopes: ["org", "asset_group"] },
];

export const ASSUMPTION_KEY_MAP = new Map(ASSUMPTION_KEYS.map((k) => [k.key, k]));

export interface AssumptionRow {
  scope: string;
  scope_id: string | null;
  key: string;
  value: number | null;
  effective_from?: string | null;
  effective_to?: string | null;
}

/**
 * Resolves assumption values most-specific-first. `get(key, scopes)` looks up
 * each (scope, scopeId) pair in order and falls back to the org row, then the
 * catalog default.
 */
export class AssumptionSet {
  private rows = new Map<string, number>();

  constructor(rows: AssumptionRow[]) {
    for (const r of rows) {
      if (r.value === null || r.value === undefined) continue;
      this.rows.set(`${r.scope}|${r.scope_id ?? ""}|${r.key}`, Number(r.value));
    }
  }

  get(key: string, scopes: Array<{ scope: string; scopeId: string | null | undefined }> = []): number {
    for (const s of scopes) {
      const v = this.rows.get(`${s.scope}|${s.scopeId ?? ""}|${key}`);
      if (v !== undefined) return v;
    }
    const org = this.rows.get(`org||${key}`);
    if (org !== undefined) return org;
    return ASSUMPTION_KEY_MAP.get(key)?.defaultValue ?? 0;
  }

  has(key: string, scope = "org", scopeId: string | null = null): boolean {
    return this.rows.has(`${scope}|${scopeId ?? ""}|${key}`);
  }

  /** Every key referenced when pricing personnel; stored on the builds. */
  static personnelKeys(): string[] {
    return ASSUMPTION_KEYS.filter((k) => k.group === "payroll_tax" || k.group === "benefits" || k.group === "personnel").map((k) => k.key);
  }
}
