import type { SupabaseClient } from "@supabase/supabase-js";
import { isModuleKey } from "./modules";

export interface ScopeInput {
  modules?: unknown;
  entityIds?: unknown;
}

export interface ScopeColumns {
  modules: string[] | null;
  entity_ids: string[] | null;
}

/**
 * Validate an access-scope payload from the Members UI.
 * - `undefined` leaves a column untouched (returned as absent)
 * - `null` or an empty array clears the restriction (everything)
 * - arrays are checked against the module registry / the org's entities
 */
export async function validateScopes(
  admin: SupabaseClient,
  orgId: string,
  input: ScopeInput
): Promise<{ ok: true; columns: Partial<ScopeColumns> } | { ok: false; error: string }> {
  const columns: Partial<ScopeColumns> = {};

  if (input.modules !== undefined) {
    if (input.modules === null) {
      columns.modules = null;
    } else if (Array.isArray(input.modules)) {
      const bad = input.modules.filter((m) => !isModuleKey(m));
      if (bad.length > 0) {
        return { ok: false, error: `Unknown module: ${bad.join(", ")}` };
      }
      columns.modules = input.modules.length > 0 ? (input.modules as string[]) : null;
    } else {
      return { ok: false, error: "modules must be an array or null" };
    }
  }

  if (input.entityIds !== undefined) {
    if (input.entityIds === null) {
      columns.entity_ids = null;
    } else if (Array.isArray(input.entityIds)) {
      const ids = input.entityIds.filter((v): v is string => typeof v === "string");
      if (ids.length !== input.entityIds.length) {
        return { ok: false, error: "entityIds must be strings" };
      }
      if (ids.length > 0) {
        const { data: orgEntities } = await admin
          .from("entities")
          .select("id")
          .eq("organization_id", orgId)
          .in("id", ids);
        const found = new Set((orgEntities ?? []).map((e) => e.id as string));
        const missing = ids.filter((id) => !found.has(id));
        if (missing.length > 0) {
          return { ok: false, error: "One or more entities are not in this organization" };
        }
      }
      columns.entity_ids = ids.length > 0 ? ids : null;
    } else {
      return { ok: false, error: "entityIds must be an array or null" };
    }
  }

  return { ok: true, columns };
}
