/**
 * The three tags every person carries, from the Tagging Cheat Sheet:
 * Location (which site), Class (what we rent with it) and Function (what
 * kind of job). Each is a split list [{ key, pct }] summing to 100; a
 * split is 75/25 or 50/50, nothing finer. Class names must match QBO
 * class names so the lines route to the right class.
 */

export interface TagSplit {
  key: string;
  pct: number;
}

export const LOCATIONS = ["Saticoy", "Cahuenga", "Southeast", "Overhead"] as const;

export const CLASS_GROUPS: Array<{ group: string; classes: string[] }> = [
  { group: "Avon", classes: ["Vehicle Rental", "Trailer Rental"] },
  { group: "HDR", classes: ["Bathrooms", "Locations", "Production Supplies", "A/C", "Grip & Lighting"] },
  { group: "Versatile", classes: ["Production Supplies", "Studio Rental"] },
  { group: "Company", classes: ["Overhead"] },
];

export const CLASSES: string[] = [...new Set(CLASS_GROUPS.flatMap((g) => g.classes))];

export const FUNCTIONS = ["Executive", "Administrative", "Sales", "Operations", "Fleet & Maintenance"] as const;

/** Geography rolls the sites up: the two Los Angeles yards against the Southeast. */
export const GEOGRAPHY_BY_LOCATION: Record<string, string> = {
  Saticoy: "Los Angeles",
  Cahuenga: "Los Angeles",
  Southeast: "Southeast",
  Overhead: "Overhead",
};

export const SPLIT_OPTIONS = [
  { label: "75 / 25", pct: 75 },
  { label: "50 / 50", pct: 50 },
] as const;

/** Reads a stored split list, tolerating the older { class, pct } shape. */
export function readSplits(raw: unknown, legacyKey = "key"): TagSplit[] {
  if (!Array.isArray(raw)) return [];
  const out: TagSplit[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    if (!item || typeof item !== "object") continue;
    const key = String(item.key ?? item[legacyKey] ?? "").trim();
    const pct = Number(item.pct ?? 0);
    if (!key || !(pct > 0)) continue;
    out.push({ key, pct });
  }
  return out;
}

/** "Saticoy" or "Saticoy 75 / Cahuenga 25"; empty string when unset. */
export function splitLabel(splits: TagSplit[]): string {
  if (splits.length === 0) return "";
  if (splits.length === 1) return splits[0].key;
  return splits.map((s) => `${s.key} ${Math.round(s.pct)}`).join(" / ");
}

/** The biggest share, for grouping and sorting. */
export function primaryKey(splits: TagSplit[]): string {
  if (splits.length === 0) return "";
  return [...splits].sort((a, b) => b.pct - a.pct)[0].key;
}

/** Function from a Paylocity department, for the seed and the backfill. Null when unsure. */
export function functionFromDepartment(department: string | null | undefined): string | null {
  const d = (department ?? "").toLowerCase();
  if (!d) return null;
  if (d.includes("officer") || d.includes("executive")) return "Executive";
  if (d.includes("admin") || d.includes("account") || d.includes("finance") || d.includes("hr")) return "Administrative";
  if (d.includes("sales")) return "Sales";
  if (d.includes("fleet") || d.includes("maint") || d.includes("mechanic") || d.includes("shop")) return "Fleet & Maintenance";
  if (d.includes("operation") || d.includes("lot") || d.includes("warehouse") || d.includes("dispatch") || d.includes("driver")) return "Operations";
  return null;
}

/** Location from a Paylocity department when the name says which yard. Null when it does not. */
export function locationFromDepartment(department: string | null | undefined): string | null {
  const d = (department ?? "").toLowerCase();
  if (d.includes("versatile") || d.includes("cahuenga")) return "Cahuenga";
  if (d.includes("avon lot") || d.includes("saticoy")) return "Saticoy";
  if (d.includes("southeast") || d.includes("east coast")) return "Southeast";
  return null;
}
