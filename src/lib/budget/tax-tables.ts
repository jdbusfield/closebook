/**
 * Employer payroll tax tables by year and Paylocity company.
 *
 * Every rate lives here (or in budget_assumptions, which overrides these
 * defaults per version) instead of in code constants. CA SDI is employee
 * paid and is deliberately absent from employer cost.
 *
 * Sources
 *   Social Security wage base: SSA press release each October
 *     2025 = 176,100; 2026 = 184,500; 2027 = announced Oct 2026 (placeholder
 *     carries the 2026 base until the notice lands).
 *   FUTA: 0.6% net rate on the first 7,000 (assumes the California credit
 *     reduction is not in effect; confirm each November).
 *   CA SUI: employer experience rate from the EDD DE 2088 notice each
 *     December, on the first 7,000. 3.4% is the new-employer rate and the
 *     default until the notice is entered as an assumption.
 *   CA ETT: 0.1% on the first 7,000.
 */

export interface TaxComponent {
  key: "FICA_SS" | "MEDICARE" | "FUTA" | "CA_SUI" | "CA_ETT";
  label: string;
  rate: number;
  /** Wage base per employee per year; Infinity = no cap */
  cap: number;
}

export type EmployerTaxTable = TaxComponent[];

const BASE_TABLES: Record<number, { ssWageBase: number; suiRate: number }> = {
  2025: { ssWageBase: 176100, suiRate: 0.034 },
  2026: { ssWageBase: 184500, suiRate: 0.034 },
  2027: { ssWageBase: 184500, suiRate: 0.034 },
};

/** Per-company SUI experience rates, when known. company id -> year -> rate */
const COMPANY_SUI: Record<string, Record<number, number>> = {};

export interface TaxTableOverrides {
  ssWageBase?: number;
  ssRate?: number;
  medicareRate?: number;
  futaRate?: number;
  futaCap?: number;
  suiRate?: number;
  suiCap?: number;
  ettRate?: number;
  ettCap?: number;
}

export function getEmployerTaxTable(
  year: number,
  companyId?: string | null,
  overrides: TaxTableOverrides = {},
): EmployerTaxTable {
  const known = Object.keys(BASE_TABLES).map(Number);
  const nearest = known.includes(year) ? year : Math.max(...known.filter((y) => y <= year), Math.min(...known));
  const base = BASE_TABLES[nearest];
  const companySui = companyId ? COMPANY_SUI[companyId]?.[year] : undefined;
  return [
    { key: "FICA_SS", label: "FICA Social Security", rate: overrides.ssRate ?? 0.062, cap: overrides.ssWageBase ?? base.ssWageBase },
    { key: "MEDICARE", label: "Medicare", rate: overrides.medicareRate ?? 0.0145, cap: Infinity },
    { key: "FUTA", label: "FUTA", rate: overrides.futaRate ?? 0.006, cap: overrides.futaCap ?? 7000 },
    { key: "CA_SUI", label: "CA SUI", rate: overrides.suiRate ?? companySui ?? base.suiRate, cap: overrides.suiCap ?? 7000 },
    { key: "CA_ETT", label: "CA ETT", rate: overrides.ettRate ?? 0.001, cap: overrides.ettCap ?? 7000 },
  ];
}

/** Assumption keys that map onto TaxTableOverrides (see assumption-keys.ts). */
export function overridesFromAssumptions(values: Record<string, number | undefined>): TaxTableOverrides {
  return {
    ssWageBase: values.fica_wage_base,
    ssRate: values.fica_rate,
    medicareRate: values.medicare_rate,
    futaRate: values.futa_rate,
    futaCap: values.futa_cap,
    suiRate: values.sui_rate,
    suiCap: values.sui_cap,
    ettRate: values.ett_rate,
    ettCap: values.ett_cap,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Employer taxes on `wageAmount` given wages already paid this calendar year.
 * Caps are applied per component on cumulative wages.
 */
export function employerTaxesOnWages(
  wageAmount: number,
  ytdGrossWages: number,
  table: EmployerTaxTable,
): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const c of table) {
    const taxable = c.cap === Infinity
      ? wageAmount
      : Math.min(wageAmount, Math.max(0, c.cap - ytdGrossWages));
    const tax = round(Math.max(0, taxable) * c.rate);
    breakdown[c.key] = tax;
    total += tax;
  }
  return { total: round(total), breakdown };
}
