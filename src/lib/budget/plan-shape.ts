import type { createAdminClient } from "@/lib/supabase/admin";

export interface PlanEntity {
  id: string;
  name: string;
  code: string;
  reportingEntityId: string | null;
  reportingEntityName: string | null;
}

/** Entities with their reporting group, for the allocation picker and the company totals. */
export async function planShape(admin: ReturnType<typeof createAdminClient>, organizationId: string) {
  const [{ data: entities }, { data: groups }, { data: members }] = await Promise.all([
    admin.from("entities").select("id, name, code, is_active").eq("organization_id", organizationId).order("name"),
    admin
      .from("reporting_entities")
      .select("id, name, code, is_active, exclude_from_breakdown")
      .eq("organization_id", organizationId)
      .order("name")
      // Views such as "Avon Accountant View" repeat a group's members; only real groups get a share
      .then((res) => ({ ...res, data: (res.data ?? []).filter((g) => !g.exclude_from_breakdown) })),
    admin.from("reporting_entity_members").select("reporting_entity_id, entity_id"),
  ]);
  const groupIds = new Set((groups ?? []).map((g) => g.id));
  const groupOfEntity = new Map<string, string>();
  for (const m of members ?? []) {
    if (groupIds.has(m.reporting_entity_id) && !groupOfEntity.has(m.entity_id)) groupOfEntity.set(m.entity_id, m.reporting_entity_id);
  }
  const groupName = new Map((groups ?? []).map((g) => [g.id, g.name]));
  const list: PlanEntity[] = (entities ?? [])
    .filter((e) => e.is_active !== false)
    .map((e) => ({
      id: e.id,
      name: e.name,
      code: e.code,
      reportingEntityId: groupOfEntity.get(e.id) ?? null,
      reportingEntityName: groupName.get(groupOfEntity.get(e.id) ?? "") ?? null,
    }));
  return {
    entities: list,
    reportingEntities: (groups ?? []).filter((g) => g.is_active !== false).map((g) => ({ id: g.id, name: g.name, code: g.code })),
    /** reporting entity id -> its member entity ids */
    membersByGroup: Object.fromEntries(
      (groups ?? []).map((g) => [g.id, (members ?? []).filter((m) => m.reporting_entity_id === g.id).map((m) => m.entity_id)]),
    ) as Record<string, string[]>,
  };
}
