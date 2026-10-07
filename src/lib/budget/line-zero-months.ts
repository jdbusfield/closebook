/**
 * Zero months on a budget line: the line is $0 in the chosen months whatever its
 * items say (fleet driver, schedules, typed items). Stored as a version assumption,
 * so a Recompute keeps it; applied when lines are written from builds.
 */
import type { VersionOwner } from "./access";
import type { Admin } from "./build-types";

export const ZERO_MONTHS_KEY = "line_zero_months";

/** "3,4,12" -> [3, 4, 12]; anything outside 1-12 is dropped */
export function parseMonths(text: string | null | undefined): number[] {
  return [...new Set(String(text ?? "").split(",").map((s) => Number(s.trim())).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12))].sort((a, b) => a - b);
}

/** Months (1-12) zeroed per line master */
export async function loadZeroMonths(admin: Admin, versionId: string): Promise<Map<string, number[]>> {
  const { data, error } = await admin
    .from("budget_assumptions")
    .select("scope_id, text_value")
    .eq("budget_version_id", versionId)
    .eq("scope", "org")
    .eq("key", ZERO_MONTHS_KEY);
  if (error) throw new Error(`Could not read zeroed months: ${error.message}`);
  const out = new Map<string, number[]>();
  for (const r of (data ?? []) as Array<{ scope_id: string | null; text_value: string | null }>) {
    const months = parseMonths(r.text_value);
    if (r.scope_id && months.length) out.set(r.scope_id, months);
  }
  return out;
}

export async function setZeroMonths(admin: Admin, owner: VersionOwner, masterId: string, months: number[], userId: string | null): Promise<number[]> {
  const clean = parseMonths(months.join(","));
  const { error: delError } = await admin
    .from("budget_assumptions")
    .delete()
    .eq("budget_version_id", owner.id)
    .eq("scope", "org")
    .eq("scope_id", masterId)
    .eq("key", ZERO_MONTHS_KEY);
  if (delError) throw new Error(`Could not update zeroed months: ${delError.message}`);
  if (!clean.length) return clean;
  const { error } = await admin.from("budget_assumptions").insert({
    budget_version_id: owner.id,
    scope: "org",
    scope_id: masterId,
    key: ZERO_MONTHS_KEY,
    text_value: clean.join(","),
    source_note: "Zero months: the line is $0 in these months",
    created_by: userId,
  });
  if (error) throw new Error(`Could not save zeroed months: ${error.message}`);
  return clean;
}

/** Copy of months (January first) with the zeroed months set to 0 */
export function applyZeroMonths(months: number[], zero: number[] | undefined): number[] {
  if (!zero?.length) return months;
  const z = new Set(zero);
  return months.map((v, i) => (z.has(i + 1) ? 0 : v));
}
