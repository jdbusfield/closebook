/**
 * Centralized operating-entity metadata for payroll views.
 *
 * Consolidates the entity id → code / name / display-order / color maps that
 * were previously duplicated across the payroll pages. Built on ENTITY_IDS
 * from cost-center-config so there is a single source of truth for the ids.
 */

import { ENTITY_IDS } from "./cost-center-config";

export interface OperatingEntityMeta {
  entityId: string;
  code: string;
  name: string;
  /** Brand color used in charts / badges */
  color: string;
}

/** Operating entities keyed by entity id. */
export const OPERATING_ENTITIES: Record<string, OperatingEntityMeta> = {
  [ENTITY_IDS.SILVERCO]: {
    entityId: ENTITY_IDS.SILVERCO,
    code: "AVON",
    name: "Silverco Enterprises",
    color: "#2563eb",
  },
  [ENTITY_IDS.ARH]: {
    entityId: ENTITY_IDS.ARH,
    code: "ARH",
    name: "Avon Rental Holdings",
    color: "#16a34a",
  },
  [ENTITY_IDS.VS]: {
    entityId: ENTITY_IDS.VS,
    code: "VS",
    name: "Versatile Studios",
    color: "#ea580c",
  },
  [ENTITY_IDS.HDR]: {
    entityId: ENTITY_IDS.HDR,
    code: "HDR",
    name: "Hollywood Depot Rentals",
    color: "#9333ea",
  },
  [ENTITY_IDS.HSS]: {
    entityId: ENTITY_IDS.HSS,
    code: "HSS",
    name: "Hollywood Site Services",
    color: "#dc2626",
  },
};

/** Canonical display order for entity rows/columns. */
export const ENTITY_ORDER: string[] = [
  ENTITY_IDS.SILVERCO,
  ENTITY_IDS.ARH,
  ENTITY_IDS.VS,
  ENTITY_IDS.HDR,
  ENTITY_IDS.HSS,
];

/** Entity id → short code (e.g. for allocation overrides). */
export const ENTITY_ID_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.values(OPERATING_ENTITIES).map((e) => [e.entityId, e.code])
);

/** Entity code → brand color. */
export const ENTITY_COLORS: Record<string, string> = Object.fromEntries(
  Object.values(OPERATING_ENTITIES).map((e) => [e.code, e.color])
);

/** Look up entity metadata, tolerating an unknown id. */
export function getEntityMeta(entityId: string): OperatingEntityMeta {
  return (
    OPERATING_ENTITIES[entityId] ?? {
      entityId,
      code: "???",
      name: "Unknown Entity",
      color: "#6b7280",
    }
  );
}
