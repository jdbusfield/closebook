/**
 * The baseline a row's Change is measured against: the values it was seeded
 * with (kept in seeded_from.fields), priced without any comp adjustment.
 * Rows added by hand have no baseline and count as all-new cost.
 */
import type { HeadcountDbRow } from "./recompute";

export const BASELINE_FIELDS = [
  "pay_type", "base_rate", "annual_salary", "amount_monthly", "std_hours_week", "fte_pct",
  "start_month", "end_month", "bonus_target", "commission_annual", "ot_pct", "dt_pct", "meal_pct",
  "benefits_monthly", "match_pct", "life_disability_monthly", "pto_hours_per_period", "other_costs_monthly",
] as const;

export type BaselineField = (typeof BASELINE_FIELDS)[number];
export type BaselineFields = Partial<Record<BaselineField, string | number | null>>;

/** The current values of the baseline fields, for a seed snapshot. */
export function snapshotFields(row: Record<string, unknown>): BaselineFields {
  const out: BaselineFields = {};
  for (const k of BASELINE_FIELDS) out[k] = (row[k] as string | number | null | undefined) ?? null;
  return out;
}

export function readBaselineFields(seededFrom: unknown): BaselineFields | null {
  if (!seededFrom || typeof seededFrom !== "object") return null;
  const f = (seededFrom as { fields?: unknown }).fields;
  if (!f || typeof f !== "object") return null;
  return f as BaselineFields;
}

/**
 * The row as it was seeded, with no comp adjustment: what to price for the
 * baseline. Null when the row was added by hand (no baseline: all new cost).
 */
export function baselineRow(row: HeadcountDbRow): HeadcountDbRow | null {
  const fields = readBaselineFields(row.seeded_from);
  if (!fields) {
    if (row.is_requisition || !row.employee_id) return null;
    // Seeded before snapshots existed: today's values are the baseline
    return { ...row, comp_adj_kind: null, comp_adj_value: null, comp_adj_month: null, merit_pct: 0, merit_month: null };
  }
  return { ...row, ...fields, comp_adj_kind: null, comp_adj_value: null, comp_adj_month: null, merit_pct: 0, merit_month: null } as HeadcountDbRow;
}
