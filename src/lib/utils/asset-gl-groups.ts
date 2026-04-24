import {
  getEffectiveMasterType,
  type VehicleClassification,
} from "./vehicle-classification";

export type ReconLineType = "cost" | "accum_depr" | "gain_on_sale";

export interface GLAccountGroup {
  key: string;
  displayName: string;
  masterType: "Vehicle" | "Trailer";
}

export interface ReconGroup extends GLAccountGroup {
  lineType: ReconLineType;
  /** The parent GL group key this recon line belongs to */
  parentKey: string;
}

/**
 * Two master-type groups — used by the roll-forward tab and anywhere
 * assets are grouped by Vehicle vs Trailer at the NBV level.
 */
export const GL_ACCOUNT_GROUPS: GLAccountGroup[] = [
  {
    key: "vehicles_net",
    displayName: "Vehicles (Net)",
    masterType: "Vehicle",
  },
  {
    key: "trailers_net",
    displayName: "Trailers (Net)",
    masterType: "Trailer",
  },
];

/**
 * Four reconciliation groups: cost and accumulated depreciation for each master type.
 * Each group is independently linked to entity GL accounts via asset_recon_gl_links.
 */
export const RECON_GROUPS: ReconGroup[] = [
  {
    key: "vehicles_cost",
    displayName: "Vehicles — Cost",
    masterType: "Vehicle",
    lineType: "cost",
    parentKey: "vehicles_net",
  },
  {
    key: "vehicles_accum_depr",
    displayName: "Vehicles — Accumulated Depreciation",
    masterType: "Vehicle",
    lineType: "accum_depr",
    parentKey: "vehicles_net",
  },
  {
    key: "trailers_cost",
    displayName: "Trailers — Cost",
    masterType: "Trailer",
    lineType: "cost",
    parentKey: "trailers_net",
  },
  {
    key: "trailers_accum_depr",
    displayName: "Trailers — Accumulated Depreciation",
    masterType: "Trailer",
    lineType: "accum_depr",
    parentKey: "trailers_net",
  },
  {
    key: "vehicles_gain_on_sale",
    displayName: "Vehicles — Gain on Sale",
    masterType: "Vehicle",
    lineType: "gain_on_sale",
    parentKey: "vehicles_net",
  },
  {
    key: "trailers_gain_on_sale",
    displayName: "Trailers — Gain on Sale",
    masterType: "Trailer",
    lineType: "gain_on_sale",
    parentKey: "trailers_net",
  },
];

/**
 * Combined Fleet accumulated depreciation group. Covers both Vehicle and Trailer
 * assets — used when the entity's GL has a single shared Accum. Depreciation
 * account so the subledger can't be split by master type. Opt-in per entity via
 * `entities.combine_fleet_accum_depr`.
 */
export const FLEET_ACCUM_DEPR_GROUP: ReconGroup = {
  key: "fleet_accum_depr",
  displayName: "Fleet — Accumulated Depreciation",
  masterType: "Vehicle",
  lineType: "accum_depr",
  parentKey: "fleet_net",
};

/**
 * Every recon group key that may appear on a link row, regardless of entity
 * combine settings. Consumers resolving `recon_group` text back to a group
 * object should search this list so the fleet key resolves cleanly.
 */
export const ALL_RECON_GROUPS: ReconGroup[] = [
  ...RECON_GROUPS,
  FLEET_ACCUM_DEPR_GROUP,
];

export interface ReconCombineSettings {
  combine_fleet_accum_depr?: boolean;
}

/**
 * Return the recon groups that should render and drive subledger routing for
 * an entity given its combine settings. When accum depr is combined, the
 * vehicle/trailer accum groups are replaced by a single Fleet group.
 */
export function getEffectiveReconGroups(
  settings?: ReconCombineSettings
): ReconGroup[] {
  const costGroups = RECON_GROUPS.filter((g) => g.lineType === "cost");
  const accumGroups = settings?.combine_fleet_accum_depr
    ? [FLEET_ACCUM_DEPR_GROUP]
    : RECON_GROUPS.filter((g) => g.lineType === "accum_depr");
  const gainGroups = RECON_GROUPS.filter((g) => g.lineType === "gain_on_sale");
  return [...costGroups, ...accumGroups, ...gainGroups];
}

/** True when the group spans both Vehicle and Trailer master types. */
export function isFleetReconGroup(group: ReconGroup): boolean {
  return group.key.startsWith("fleet_");
}

/** Key used for assets that have no vehicle_class or an unrecognised class */
export const UNALLOCATED_KEY = "unallocated";

/**
 * Get the GL account group key for an asset. Prefers master_type_override
 * (intended for Accounting Adjustment assets where the class has no inherent
 * master type) before falling back to the class-derived master type.
 * Returns "vehicles_net" for Vehicle, "trailers_net" for Trailer.
 */
export function getAssetGLGroup(
  vehicleClass: string | null,
  masterTypeOverride?: string | null,
  customClasses?: VehicleClassification[]
): string | null {
  const mt = getEffectiveMasterType(
    vehicleClass,
    masterTypeOverride,
    customClasses
  );
  if (!mt) return null;
  const group = GL_ACCOUNT_GROUPS.find((g) => g.masterType === mt);
  return group?.key ?? null;
}
