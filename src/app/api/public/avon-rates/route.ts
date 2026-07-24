import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SILVERCO_ENTITY_ID } from "@/lib/inquiries/shared";
import { publicFleetPhotoUrl } from "@/lib/inquiries/fleet-rates";

export const runtime = "nodejs";

/**
 * GET /api/public/avon-rates
 *
 * Unauthenticated, read-only feed of the Avon fleet rate card, for
 * trucks.avonrents.com to merge over its static src/data/fleet.json at
 * request time. No secret, no session — day/week/month rates and a public
 * photo URL aren't sensitive, and JD edits them from Closebook's Inquiries →
 * Rate Card view (or the embedded version inside avon-trucks' own /admin).
 * Hard-scoped to the Silverco entity: this route only ever serves Avon data,
 * regardless of anything in the request.
 */
export async function GET() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("rental_inquiry_fleet_rates")
    .select("vehicle_id, day_rate, week_rate, month_rate, photo_path, updated_at")
    .eq("entity_id", SILVERCO_ENTITY_ID);

  if (error) {
    // Pre-migration (table not created yet) or transient DB trouble: serve an
    // empty rate card instead of a 500. The site merges nothing and falls back
    // to "Call for today's rate" — same behavior as blank rows, no error state.
    console.error("[avon-rates] read failed:", error.message);
    return NextResponse.json(
      { vehicles: [] },
      { headers: { "Cache-Control": "public, s-maxage=60" } }
    );
  }

  const vehicles = (data ?? []).map((r) => ({
    vehicleId: r.vehicle_id,
    day: r.day_rate,
    week: r.week_rate,
    month: r.month_rate,
    photoUrl: r.photo_path ? publicFleetPhotoUrl(r.photo_path) : null,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json(
    { vehicles },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } }
  );
}
