import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFleetioClientFromEnv, type FleetioVehicle } from "@/lib/fleetio/client";

/**
 * POST /api/fleetio/sync/vehicles
 *
 * Pulls every vehicle from Fleetio (active only — Fleetio's archived endpoint
 * is not exposed on the public v1 surface), matches each one to a row in
 * `fixed_assets` by VIN, and caches `fleetio_vehicle_id`, `fleetio_group_name`,
 * and the current odometer on the asset row.
 *
 * Admin / controller only. READ-ONLY from Fleetio.
 *
 * Request body:  { organization_id: string, incremental?: boolean }
 * Response:      { synced: number, linked: number, already_linked: number, not_in_register: number }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const organizationId: string | undefined = body.organization_id;
  const incremental: boolean = Boolean(body.incremental);
  if (!organizationId) {
    return NextResponse.json({ error: "organization_id required" }, { status: 400 });
  }

  // Authorise: must be admin or controller on the org.
  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || !["admin", "controller"].includes(membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // New tables not yet in generated types — use any-cast pattern consistent
  // with the rest of this codebase until `database.types.ts` is regenerated.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const fleetio = getFleetioClientFromEnv();

  // Track sync state to support incremental runs.
  const { data: stateRow } = await admin
    .from("fleetio_sync_state")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("resource", "vehicles")
    .maybeSingle();

  const updatedAfter =
    incremental && stateRow?.last_seen_updated_at
      ? stateRow.last_seen_updated_at
      : undefined;

  await admin.from("fleetio_sync_state").upsert(
    {
      organization_id: organizationId,
      resource: "vehicles",
      status: "running",
      last_error: null,
    },
    { onConflict: "organization_id,resource" }
  );

  try {
    // Pull vehicles paginated
    const vehicles: FleetioVehicle[] = [];
    let cursor: string | null = null;
    while (true) {
      const page = await fleetio.listVehicles({
        cursor,
        perPage: 100,
        updatedAfter,
      });
      vehicles.push(...page.records);
      if (!page.next_cursor || page.records.length === 0) break;
      cursor = page.next_cursor;
    }

    // Pull closebook assets once. Service role bypasses RLS.
    const { data: assetsRaw, error: assetsErr } = await admin
      .from("fixed_assets")
      .select(
        "id, vin, fleetio_vehicle_id, fleetio_group_name, status, disposed_date"
      )
      .not("vin", "is", null);
    if (assetsErr) throw assetsErr;
    const assets = (assetsRaw ?? []) as Array<{
      id: string;
      vin: string;
      fleetio_vehicle_id: number | null;
      fleetio_group_name: string | null;
      status: string;
      disposed_date: string | null;
    }>;

    // Same-VIN duplicates exist (NCNT Holdings + Two Family hold the same
    // trailers). Per product rule: pick ONE primary asset to own the
    // Fleetio link (active > disposed, then already-linked > not-linked).
    const assetsByVin = new Map<string, typeof assets>();
    for (const a of assets) {
      const vin = a.vin.toUpperCase().replace(/\s/g, "");
      if (!assetsByVin.has(vin)) assetsByVin.set(vin, []);
      assetsByVin.get(vin)!.push(a);
    }
    function pickPrimary(rows: typeof assets) {
      return [...rows].sort((a, b) => {
        const aActive = a.status !== "disposed" ? 0 : 1;
        const bActive = b.status !== "disposed" ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        const aLinked = a.fleetio_vehicle_id != null ? 0 : 1;
        const bLinked = b.fleetio_vehicle_id != null ? 0 : 1;
        if (aLinked !== bLinked) return aLinked - bLinked;
        return a.id.localeCompare(b.id);
      })[0];
    }
    const primaryByVin = new Map<string, string>();
    for (const [vin, rows] of assetsByVin) {
      primaryByVin.set(vin, pickPrimary(rows).id);
    }

    let linked = 0;
    let alreadyLinked = 0;
    let notInRegister = 0;
    let latestUpdatedAt = stateRow?.last_seen_updated_at ?? null;

    for (const v of vehicles) {
      if (
        !latestUpdatedAt ||
        (v.updated_at && v.updated_at > latestUpdatedAt)
      ) {
        latestUpdatedAt = v.updated_at;
      }

      const vin = v.vin?.toUpperCase().replace(/\s/g, "");
      if (!vin) {
        notInRegister++;
        continue;
      }
      const siblings = assetsByVin.get(vin);
      if (!siblings || siblings.length === 0) {
        notInRegister++;
        continue;
      }
      const primaryId = primaryByVin.get(vin);
      const primary = siblings.find((a) => a.id === primaryId)!;

      // Clear any sibling rows that wrongly hold this Fleetio id.
      for (const s of siblings) {
        if (s.id !== primary.id && s.fleetio_vehicle_id != null) {
          await admin
            .from("fixed_assets")
            .update({ fleetio_vehicle_id: null, fleetio_group_name: null })
            .eq("id", s.id);
        }
      }

      const needsUpdate =
        primary.fleetio_vehicle_id !== v.id ||
        primary.fleetio_group_name !== v.group_name;
      if (!needsUpdate) {
        alreadyLinked++;
        continue;
      }

      const { error: updErr } = await admin
        .from("fixed_assets")
        .update({
          fleetio_vehicle_id: v.id,
          fleetio_group_name: v.group_name,
          fleetio_last_synced_at: new Date().toISOString(),
          odometer_current: v.primary_meter_value
            ? Number(v.primary_meter_value)
            : null,
          odometer_current_as_of: v.primary_meter_date,
        })
        .eq("id", primary.id);
      if (updErr) throw updErr;
      linked++;
    }

    await admin.from("fleetio_sync_state").upsert(
      {
        organization_id: organizationId,
        resource: "vehicles",
        status: "idle",
        last_full_sync_at: incremental ? stateRow?.last_full_sync_at ?? new Date().toISOString() : new Date().toISOString(),
        last_incremental_sync_at: new Date().toISOString(),
        last_seen_updated_at: latestUpdatedAt,
        last_error: null,
      },
      { onConflict: "organization_id,resource" }
    );

    return NextResponse.json({
      synced: vehicles.length,
      linked,
      already_linked: alreadyLinked,
      not_in_register: notInRegister,
    });
  } catch (err) {
    const msg = serializeError(err);
    console.error("[fleetio/sync/vehicles]", err);
    await admin.from("fleetio_sync_state").upsert(
      {
        organization_id: organizationId,
        resource: "vehicles",
        status: "error",
        last_error: msg,
      },
      { onConflict: "organization_id,resource" }
    );
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const msg = e.message ?? e.error ?? e.details ?? e.hint;
    if (msg) return `${msg}${e.code ? ` (${e.code})` : ""}`;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}
