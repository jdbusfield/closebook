// RentalWorks class-revenue supplements.
//
// Fleet revenue is split across two billing systems: the CARSPLUS DBR
// (per-vehicle rows) and RentalWorks (per inventory item, no per-vehicle
// attribution). "MMM YYYY RW" tabs are ingested by summing RentalWorks
// revenue per vehicle class into one supplemental asset-grain KPI row per
// class, keyed by a synthetic Veh_number "RW-<CLASS>". Day counts stay with
// the DBR rows — the DBR tracks unit status regardless of which system
// billed the rental — so utilization and fleet counts are untouched and
// ADR = (DBR revenue + RW revenue) ÷ DBR rental days, matching the
// projection-model workbook.

export const RW_SUPPLEMENT_PREFIX = "RW-";

// RentalWorks equipment revenue (straps, pads, dollies, …) has no vehicle
// class — it lands in the equipment-pool grain under this key.
export const RW_EQUIPMENT_POOL_KEY = "RW-EQUIP";

/** Class code carried by an RW supplement row ("RW-13" → "13"), else null. */
export function rwSupplementClass(
  vehNumber: string | null | undefined
): string | null {
  if (!vehNumber) return null;
  const v = String(vehNumber).trim().toUpperCase();
  if (!v.startsWith(RW_SUPPLEMENT_PREFIX)) return null;
  const cls = v.slice(RW_SUPPLEMENT_PREFIX.length);
  return cls || null;
}
