// Helpers for resolving the "exclude_from_breakdown" flag on reporting
// entities into a concrete set of entity IDs that should be left out of
// consolidated dashboard / breakdown calculations.
//
// Semantics: an entity is treated as excluded only when every reporting
// entity it belongs to is excluded. An entity that is also a member of any
// non-excluded RE remains in the consolidated total (it has a non-excluded
// "home" that the user wants to see). Entities not assigned to any RE are
// always retained — they land in the "Other" column on the RE breakdown
// and the user has not asked us to drop them.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

interface ReRow {
  id: string;
  exclude_from_breakdown: boolean | null;
}

interface ReMemberRow {
  reporting_entity_id: string;
  entity_id: string;
}

export async function getExcludedFromBreakdownEntityIds(
  admin: AdminClient,
  organizationId: string,
): Promise<Set<string>> {
  const { data: reRows } = await admin
    .from("reporting_entities")
    .select("id, exclude_from_breakdown")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  const allRes: ReRow[] = (reRows ?? []) as ReRow[];
  if (allRes.length === 0) return new Set();

  const excludedReIds = new Set(
    allRes.filter((r) => r.exclude_from_breakdown === true).map((r) => r.id),
  );
  if (excludedReIds.size === 0) return new Set();

  const allReIds = allRes.map((r) => r.id);

  const { data: memberRows } = await admin
    .from("reporting_entity_members")
    .select("reporting_entity_id, entity_id")
    .in("reporting_entity_id", allReIds);

  const members: ReMemberRow[] = (memberRows ?? []) as ReMemberRow[];

  // Build entity_id -> set of RE ids it belongs to
  const entityToReSet = new Map<string, Set<string>>();
  for (const m of members) {
    const set = entityToReSet.get(m.entity_id) ?? new Set<string>();
    set.add(m.reporting_entity_id);
    entityToReSet.set(m.entity_id, set);
  }

  // An entity is "excluded" iff every RE it belongs to is excluded.
  const excludedEntityIds = new Set<string>();
  for (const [entityId, reSet] of entityToReSet) {
    let allExcluded = true;
    for (const reId of reSet) {
      if (!excludedReIds.has(reId)) {
        allExcluded = false;
        break;
      }
    }
    if (allExcluded) excludedEntityIds.add(entityId);
  }

  return excludedEntityIds;
}
