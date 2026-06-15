// Subrented vehicles on the DBR utilization spreadsheet (column T,
// `subrental_flag` on rental_asset_kpis) are units HDR rents from a third
// party and re-rents — they are NOT owned fleet. The source marks them with a
// non-blank value (e.g. "X", "Y", "YES", "SUBRENTAL"); owned vehicles leave
// the cell blank, which the importer stores as null.
//
// Treat any non-blank value that isn't an explicit negative marker as
// subrented. Kept in one place so the dashboard hook and the trends /
// trailing-12 API routes all classify identically.
const NEGATIVE_MARKERS = new Set(["0", "n", "no", "false", "-", "owned"]);

export function isSubrental(flag: string | null | undefined): boolean {
  if (flag == null) return false;
  const v = String(flag).trim().toLowerCase();
  if (!v) return false;
  return !NEGATIVE_MARKERS.has(v);
}
