// Shared types + helpers for the Avon Trucks fleet rate card — the day/week/
// month rates and a photo per vehicle that trucks.avonrents.com reads live.
// Photos reuse the same PUBLIC inquiry-resources bucket as the resource
// library (see resources.ts), just under a fleet-photos/ prefix, so they get
// the same stable, unsigned public URL.

export const FLEET_PHOTO_PREFIX = "fleet-photos";

export interface FleetRateRow {
  id: string;
  vehicle_id: string;
  vehicle_name: string;
  class_slug: string;
  class_name: string;
  /** Real fleet class code from VEHICLE_CLASSIFICATIONS, e.g. "15" — accounting/RentalWorks, not the marketing grouping above. */
  class_code: string | null;
  /** Real reporting group, e.g. "Stakebed" — see src/lib/utils/vehicle-classification.ts. */
  reporting_group: string | null;
  day_rate: number | null;
  week_rate: number | null;
  month_rate: number | null;
  photo_path: string | null;
  sort_order: number;
  updated_at: string;
}

// Public CDN URL for a fleet photo — same shape as resources.ts's
// publicResourceUrl, kept separate so this file has no dependency on the
// resource library (different table, same bucket).
export function publicFleetPhotoUrl(photoPath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return `${base}/storage/v1/object/public/inquiry-resources/${photoPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

// Group rows by class, preserving class + row sort_order — the same grouping
// trucks.avonrents.com uses for its fleet.json classes.
export function groupByClass(rows: FleetRateRow[]): { slug: string; name: string; rows: FleetRateRow[] }[] {
  const order: string[] = [];
  const byClass = new Map<string, { slug: string; name: string; rows: FleetRateRow[] }>();
  for (const r of [...rows].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!byClass.has(r.class_slug)) {
      byClass.set(r.class_slug, { slug: r.class_slug, name: r.class_name, rows: [] });
      order.push(r.class_slug);
    }
    byClass.get(r.class_slug)!.rows.push(r);
  }
  return order.map((slug) => byClass.get(slug)!);
}
