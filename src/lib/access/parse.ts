import { isModuleKey, type MemberAccess } from "./modules";

/**
 * Turn an organization_members row into a MemberAccess. Tolerates the
 * modules/entity_ids columns being absent (pre-migration) by treating them
 * as unrestricted. Admins are never restricted.
 */
export function parseAccessRow(row: Record<string, unknown>): MemberAccess {
  const role = String(row.role ?? "viewer");
  if (role === "admin") {
    return { role, modules: null, entityIds: null };
  }

  const rawModules = row.modules;
  const modules = Array.isArray(rawModules)
    ? rawModules.filter(isModuleKey)
    : null;

  const rawEntities = row.entity_ids;
  const entityIds = Array.isArray(rawEntities)
    ? rawEntities.filter((v): v is string => typeof v === "string")
    : null;

  return { role, modules, entityIds };
}
