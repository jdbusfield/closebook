/**
 * "Use my own number" on a budget line: the fleet driver and the schedules
 * (allocations, leases, insurance, debt, capex) stop building that line in this
 * version, so it is only the items typed or built under it (e.g. a base from
 * last year's budget). Stored as a version assumption, so a Recompute keeps it.
 */
import type { VersionOwner } from "./access";
import type { Admin } from "./build-types";

export const OVERRIDE_KEY = "line_override";
/** Build types a line override switches off */
export const FED_BUILD_TYPES = ["driver", "schedule", "capex"] as const;

export async function loadOverriddenMasters(admin: Admin, versionId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("budget_assumptions")
    .select("scope_id, value")
    .eq("budget_version_id", versionId)
    .eq("scope", "org")
    .eq("key", OVERRIDE_KEY);
  if (error) throw new Error(`Could not read line overrides: ${error.message}`);
  return new Set(((data ?? []) as Array<{ scope_id: string | null; value: number | null }>).filter((r) => r.scope_id && Number(r.value) === 1).map((r) => r.scope_id!));
}

/**
 * Turn the override on (removing the line's driver and schedule items now) or off.
 * lineMasterIds is the line and its sub-masters, whose builds roll up into it.
 */
export async function setLineOverride(admin: Admin, owner: VersionOwner, masterId: string, lineMasterIds: string[], on: boolean, userId: string | null): Promise<void> {
  const { error: delError } = await admin
    .from("budget_assumptions")
    .delete()
    .eq("budget_version_id", owner.id)
    .eq("scope", "org")
    .eq("scope_id", masterId)
    .eq("key", OVERRIDE_KEY);
  if (delError) throw new Error(`Could not update the line override: ${delError.message}`);
  if (!on) return;
  const { error } = await admin.from("budget_assumptions").insert({
    budget_version_id: owner.id,
    scope: "org",
    scope_id: masterId,
    key: OVERRIDE_KEY,
    value: 1,
    source_note: "Use my own number: fleet driver and schedules off for this line",
    created_by: userId,
  });
  if (error) throw new Error(`Could not save the line override: ${error.message}`);
  const { error: buildsError } = await admin
    .from("budget_builds")
    .delete()
    .eq("budget_version_id", owner.id)
    .in("master_account_id", lineMasterIds)
    .in("build_type", [...FED_BUILD_TYPES]);
  if (buildsError) throw new Error(`Could not remove the line's driver and schedule items: ${buildsError.message}`);
}

/** Drop builds that land on an overridden line (directly or through a sub-master) */
export function withoutOverridden<T extends { master_account_id: string }>(builds: T[], overridden: Set<string>, parentOf: Map<string, string>): T[] {
  if (overridden.size === 0) return builds;
  return builds.filter((b) => !overridden.has(b.master_account_id) && !overridden.has(parentOf.get(b.master_account_id) ?? ""));
}
