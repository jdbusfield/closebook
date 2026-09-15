/**
 * Cell writes for budget_amounts. One code path for the single-cell PUT,
 * the batch endpoint, imports and the recompute engine, so the owner
 * columns, the class key and the zero-means-delete rule stay consistent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VersionOwner } from "./access";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export type BudgetCellSource = "manual" | "build" | "import" | "spread" | "clone";

export interface BudgetCell {
  masterAccountId: string;
  classId?: string | null;
  periodYear: number;
  periodMonth: number;
  amount: number;
  source?: BudgetCellSource;
  note?: string | null;
}

export interface UpsertResult {
  upserted: number;
  deleted: number;
  error?: string;
}

const NIL_CLASS = "00000000-0000-0000-0000-000000000000";

/** Round to the 4 decimals the column stores. */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Writes cells for a version. Amount 0 deletes the row. Rows are upserted on
 * (version, master, class_key, year, month) in batches of 500.
 */
export async function upsertBudgetCells(
  admin: Admin,
  owner: VersionOwner,
  cells: BudgetCell[],
): Promise<UpsertResult> {
  const toDelete = cells.filter((c) => !c.amount || round4(c.amount) === 0);
  const toUpsert = cells.filter((c) => c.amount && round4(c.amount) !== 0);
  let deleted = 0;
  let upserted = 0;

  for (const c of toDelete) {
    let q = admin
      .from("budget_amounts")
      .delete({ count: "exact" })
      .eq("budget_version_id", owner.id)
      .eq("master_account_id", c.masterAccountId)
      .eq("period_year", c.periodYear)
      .eq("period_month", c.periodMonth);
    q = c.classId ? q.eq("qbo_class_id", c.classId) : q.eq("class_key", NIL_CLASS);
    const { error, count } = await q;
    if (error) return { upserted, deleted, error: error.message };
    deleted += count ?? 0;
  }

  const rows = toUpsert.map((c) => ({
    budget_version_id: owner.id,
    entity_id: owner.entityId,
    reporting_entity_id: owner.reportingEntityId,
    chart_id: owner.chartId,
    master_account_id: c.masterAccountId,
    qbo_class_id: c.classId ?? null,
    period_year: c.periodYear,
    period_month: c.periodMonth,
    amount: round4(c.amount),
    source: c.source ?? "manual",
    note: c.note ?? null,
  }));

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await admin.from("budget_amounts").upsert(batch, {
      onConflict: "budget_version_id,master_account_id,class_key,period_year,period_month",
    });
    if (error) return { upserted, deleted, error: error.message };
    upserted += batch.length;
  }

  return { upserted, deleted };
}
