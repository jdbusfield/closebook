import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getFleetioClientFromEnv,
  type FleetioServiceEntry,
  type FleetioWorkOrder,
  type FleetioMeterEntry,
} from "@/lib/fleetio/client";

/**
 * POST /api/fleetio/sync/maintenance
 *
 * Pulls service entries, work orders, and meter entries from Fleetio and
 * mirrors them into rental_asset_maintenance / rental_asset_meter_readings.
 * Incremental via the `updated_at` high-water mark stored per resource.
 *
 * READ-ONLY from Fleetio. Admin / controller only.
 *
 * Body: { organization_id, resources?: ["service_entries","work_orders","meter_entries"] }
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
  const requested: string[] = body.resources ?? [
    "service_entries",
    "work_orders",
    "meter_entries",
  ];
  if (!organizationId) {
    return NextResponse.json(
      { error: "organization_id required" },
      { status: 400 }
    );
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || !["admin", "controller"].includes(membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // New tables + columns not yet in generated types — use any-cast consistent
  // with the rest of this codebase.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const fleetio = getFleetioClientFromEnv();

  // Build Fleetio vehicle ID → fixed_asset_id map so every row lands on the
  // right asset without a second DB query per record.
  const { data: assetsRaw } = await admin
    .from("fixed_assets")
    .select("id, fleetio_vehicle_id")
    .not("fleetio_vehicle_id", "is", null);
  const fleetioToAsset = new Map<number, string>();
  for (const a of (assetsRaw ?? []) as Array<{
    id: string;
    fleetio_vehicle_id: number | null;
  }>) {
    if (a.fleetio_vehicle_id != null) {
      fleetioToAsset.set(a.fleetio_vehicle_id, a.id);
    }
  }

  const summary: Record<string, { fetched: number; upserted: number }> = {};

  for (const resource of requested) {
    summary[resource] = { fetched: 0, upserted: 0 };

    const { data: state } = await admin
      .from("fleetio_sync_state")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("resource", resource)
      .maybeSingle();
    const updatedAfter = state?.last_seen_updated_at ?? undefined;

    await admin.from("fleetio_sync_state").upsert(
      {
        organization_id: organizationId,
        resource,
        status: "running",
        last_error: null,
      },
      { onConflict: "organization_id,resource" }
    );

    try {
      let cursor: string | null = null;
      let high = updatedAfter ?? null;

      while (true) {
        let page;
        if (resource === "service_entries") {
          page = await fleetio.listServiceEntries({
            cursor,
            perPage: 100,
            updatedAfter,
          });
        } else if (resource === "work_orders") {
          page = await fleetio.listWorkOrders({
            cursor,
            perPage: 100,
            updatedAfter,
          });
        } else if (resource === "meter_entries") {
          page = await fleetio.listMeterEntries({
            cursor,
            perPage: 100,
            updatedAfter,
          });
        } else {
          break;
        }

        summary[resource].fetched += page.records.length;

        if (resource === "meter_entries") {
          const meterRows = (page.records as FleetioMeterEntry[]).map((m) => ({
            organization_id: organizationId,
            fixed_asset_id: fleetioToAsset.get(m.vehicle_id) ?? null,
            fleetio_vehicle_id: m.vehicle_id,
            fleetio_id: m.id,
            meter_value: Number(m.value),
            meter_unit: m.meter_unit ?? m.meter_type ?? "mi",
            reading_date: (m.meter_date || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
            source: m.source ?? null,
            raw: m as unknown as Record<string, unknown>,
            synced_at: new Date().toISOString(),
          }));
          if (meterRows.length) {
            const { error } = await admin
              .from("rental_asset_meter_readings")
              .upsert(meterRows, { onConflict: "organization_id,fleetio_id" });
            if (error) throw error;
            summary[resource].upserted += meterRows.length;
          }
          for (const r of page.records as FleetioMeterEntry[]) {
            if (r.updated_at && (!high || r.updated_at > high)) high = r.updated_at;
          }
        } else {
          const rows = (page.records as Array<FleetioServiceEntry | FleetioWorkOrder>).map(
            (e) => {
              const se = e as FleetioServiceEntry;
              const wo = e as FleetioWorkOrder;
              const isService = resource === "service_entries";
              const totalAmount = isService
                ? parseAmount(se.total_amount) ??
                  (se.total_amount_cents != null ? se.total_amount_cents / 100 : null)
                : parseAmount(wo.total_amount);
              return {
                organization_id: organizationId,
                fixed_asset_id: fleetioToAsset.get((e as { vehicle_id: number }).vehicle_id) ?? null,
                fleetio_vehicle_id: (e as { vehicle_id: number }).vehicle_id,
                fleetio_id: e.id,
                source: isService ? "service_entry" : "work_order",
                status: e.status ?? null,
                started_at: e.started_at ?? null,
                completed_at: e.completed_at ?? null,
                reference: isService ? se.reference ?? null : wo.reference ?? null,
                general_notes: isService ? se.general_notes ?? null : null,
                vendor_name: null,
                total_amount: totalAmount,
                labor_amount: isService ? parseAmount(se.labor_subtotal) : null,
                parts_amount: isService ? parseAmount(se.parts_subtotal) : null,
                tax_amount: isService ? parseAmount(se.tax_subtotal) : null,
                meter_value_at_service: isService
                  ? Number(
                      se.primary_meter_entry?.value ?? se.meter_entry?.value ?? 0
                    ) || null
                  : null,
                primary_meter_unit: isService
                  ? se.primary_meter_entry?.meter_type ??
                    se.meter_entry?.meter_type ??
                    null
                  : null,
                line_items: null,
                raw: e as unknown as Record<string, unknown>,
                fleetio_updated_at: e.updated_at ?? null,
                synced_at: new Date().toISOString(),
              };
            }
          );
          if (rows.length) {
            const { error } = await admin
              .from("rental_asset_maintenance")
              .upsert(rows, { onConflict: "organization_id,source,fleetio_id" });
            if (error) throw error;
            summary[resource].upserted += rows.length;
          }
          for (const r of page.records) {
            if (r.updated_at && (!high || r.updated_at > high)) high = r.updated_at;
          }
        }

        if (!page.next_cursor || page.records.length === 0) break;
        cursor = page.next_cursor;
      }

      await admin.from("fleetio_sync_state").upsert(
        {
          organization_id: organizationId,
          resource,
          status: "idle",
          last_incremental_sync_at: new Date().toISOString(),
          last_seen_updated_at: high,
          last_error: null,
        },
        { onConflict: "organization_id,resource" }
      );
    } catch (err) {
      const msg = serializeError(err);
      console.error(`[fleetio/sync/maintenance:${resource}]`, err);
      await admin.from("fleetio_sync_state").upsert(
        {
          organization_id: organizationId,
          resource,
          status: "error",
          last_error: msg,
        },
        { onConflict: "organization_id,resource" }
      );
      return NextResponse.json(
        { error: `Sync failed on ${resource}: ${msg}`, summary },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ summary });
}

function parseAmount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
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
