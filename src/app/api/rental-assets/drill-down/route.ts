import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/rental-assets/drill-down
 *
 * Returns individual asset-level KPI rows for a given period bucket, joined
 * to fixed_assets identity info. Used by the Trends tab drill-down Sheet.
 *
 * Params:
 *   organization_id   (required)
 *   period            "YYYY-MM", "YYYY-QN", or "YYYY"
 *   group             Optional — reporting group or master-type label to filter to
 *   group_by          "reporting_group" | "master_type" — how `group` is interpreted
 *   include_service   "true"/"false"
 *   entity_id         Optional — limit to one entity
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const organizationId = sp.get("organization_id");
  const period = sp.get("period");
  if (!organizationId || !period) {
    return NextResponse.json(
      { error: "organization_id and period required" },
      { status: 400 }
    );
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const group = sp.get("group");
  const groupBy = (sp.get("group_by") ?? "reporting_group") as
    | "reporting_group"
    | "master_type";
  const includeService = sp.get("include_service") === "true";
  const entityId = sp.get("entity_id");
  // Optional class filter — mirrors the one on /api/rental-assets/trends
  // so drilling into a class-filtered chart shows only that class, not
  // every asset in the reporting group.
  const classesParam = sp.get("classes");
  const classFilter = classesParam
    ? new Set(
        classesParam
          .split(",")
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean)
      )
    : null;

  // Parse period into month range
  const months: { year: number; month: number }[] = [];
  const yearly = /^\d{4}$/.exec(period);
  const quarterly = /^(\d{4})-Q([1-4])$/.exec(period);
  const monthly = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (yearly) {
    const y = Number(yearly[0]);
    for (let m = 1; m <= 12; m++) months.push({ year: y, month: m });
  } else if (quarterly) {
    const y = Number(quarterly[1]);
    const q = Number(quarterly[2]);
    for (let i = 0; i < 3; i++) months.push({ year: y, month: (q - 1) * 3 + i + 1 });
  } else if (monthly) {
    months.push({ year: Number(monthly[1]), month: Number(monthly[2]) });
  } else {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Load asset dictionary (for identity + rental_category + vehicle_class)
  const categoriesAllowed = includeService
    ? ["rental", "service"]
    : ["rental"];
  const { data: assetsRaw } = await admin
    .from("fixed_assets")
    .select(
      "id, entity_id, asset_tag, vin, vehicle_year, vehicle_make, vehicle_model, vehicle_class, rental_category, acquisition_cost, fleetio_vehicle_id"
    )
    .in("rental_category", categoriesAllowed);
  const assets = (assetsRaw ?? []) as Array<{
    id: string;
    entity_id: string;
    asset_tag: string | null;
    vin: string | null;
    vehicle_year: number | null;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_class: string | null;
    rental_category: string;
    acquisition_cost: number | string | null;
    fleetio_vehicle_id: number | null;
  }>;
  const assetById = new Map(assets.map((a) => [a.id, a]));

  // Entities for display
  const { data: entitiesRaw } = await admin
    .from("entities")
    .select("id, name")
    .eq("organization_id", organizationId);
  const entityMap = new Map(
    (entitiesRaw ?? []).map((e: { id: string; name: string }) => [e.id, e.name])
  );

  // Pull KPI rows for the bucket, paginated
  const kpiRows: Array<{
    period_year: number;
    period_month: number;
    grain: string;
    fixed_asset_id: string | null;
    reporting_group: string | null;
    orphan_bridge_vin: string | null;
    orphan_veh_number: string | null;
    dbr_status: string | null;
    sale_date: string | null;
    fleet_days: number | null;
    rental_dbr_days: number | null;
    rental_act_days: number | null;
    total_revenue: number | null;
    standard_rate: number | null;
    dbr_util_pct: number | null;
  }> = [];

  // (Already selecting rental_act_days below for ADR computation.)

  for (const { year, month } of months) {
    let offset = 0;
    const batch = 1000;
    while (true) {
      const { data, error } = await admin
        .from("rental_asset_kpis")
        .select(
          "period_year, period_month, grain, fixed_asset_id, reporting_group, orphan_bridge_vin, orphan_veh_number, dbr_status, sale_date, fleet_days, rental_dbr_days, rental_act_days, total_revenue, standard_rate, dbr_util_pct"
        )
        .eq("organization_id", organizationId)
        .eq("period_year", year)
        .eq("period_month", month)
        .range(offset, offset + batch - 1);
      if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });
      const rows = (data ?? []) as typeof kpiRows;
      kpiRows.push(...rows);
      if (rows.length < batch) break;
      offset += batch;
    }
  }

  // Master-type mapping
  const GROUP_TO_MASTER: Record<string, "Vehicle" | "Trailer" | "Other"> = {
    Car: "Vehicle",
    "Cargo Van": "Vehicle",
    "Passenger Van": "Vehicle",
    "Box Truck": "Vehicle",
    "Studio Box Truck": "Vehicle",
    Stakebed: "Vehicle",
    "Cast Trailer": "Trailer",
    "Makeup Trailer": "Trailer",
  };
  function masterTypeOf(g: string | null | undefined): string {
    if (!g) return "Other";
    return GROUP_TO_MASTER[g] ?? "Other";
  }

  // Reduce to per-asset rows (sum across months for quarterly/yearly buckets).
  type Row = {
    key: string;
    kind: "asset" | "orphan";
    asset_id: string | null;
    asset_tag: string | null;
    veh_number: string | null;
    vin: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    entity_name: string | null;
    reporting_group: string;
    master_type: string;
    acquisition_cost: number;
    fleet_days: number;
    rental_days: number;
    actual_rental_days: number;
    revenue: number;
    months: number;
    fleetio_vehicle_id: number | null;
  };
  const byKey = new Map<string, Row>();

  for (const k of kpiRows) {
    if (k.grain !== "asset") continue;

    const isOrphan = !k.fixed_asset_id;
    let reportingGroup = k.reporting_group ?? "";
    let asset: (typeof assets)[number] | undefined;
    if (k.fixed_asset_id) {
      asset = assetById.get(k.fixed_asset_id);
      if (!asset) continue; // rental_category filter excluded it
      if (entityId && asset.entity_id !== entityId) continue;
    } else {
      if (entityId) continue; // orphans have no entity
    }
    // Class filter — when active, skip rows whose asset's class isn't in
    // the set. Orphans are excluded since they have no class to compare.
    if (classFilter) {
      if (!asset) continue;
      if (
        !asset.vehicle_class ||
        !classFilter.has(String(asset.vehicle_class).trim().toUpperCase())
      ) {
        continue;
      }
    }
    if (!reportingGroup && asset) reportingGroup = "Unclassified";
    const master = masterTypeOf(reportingGroup);

    // Apply group filter
    if (group) {
      if (groupBy === "master_type") {
        if (master !== group) continue;
      } else {
        if (reportingGroup !== group) continue;
      }
    }

    const key = isOrphan
      ? `orphan:${k.orphan_veh_number ?? k.orphan_bridge_vin ?? ""}`
      : `asset:${k.fixed_asset_id}`;

    let row = byKey.get(key);
    if (!row) {
      row = {
        key,
        kind: isOrphan ? "orphan" : "asset",
        asset_id: k.fixed_asset_id,
        asset_tag: asset?.asset_tag ?? null,
        veh_number: k.orphan_veh_number ?? asset?.asset_tag ?? null,
        vin: asset?.vin ?? k.orphan_bridge_vin ?? null,
        year: asset?.vehicle_year ?? null,
        make: asset?.vehicle_make ?? null,
        model: asset?.vehicle_model ?? null,
        entity_name: asset ? (entityMap.get(asset.entity_id) as string | null) ?? null : null,
        reporting_group: reportingGroup || "Unclassified",
        master_type: master,
        acquisition_cost: Number(asset?.acquisition_cost ?? 0),
        fleet_days: 0,
        rental_days: 0,
        actual_rental_days: 0,
        revenue: 0,
        months: 0,
        fleetio_vehicle_id: asset?.fleetio_vehicle_id ?? null,
      };
      byKey.set(key, row);
    }
    row.fleet_days += Number(k.fleet_days ?? 0);
    row.rental_days += Number(k.rental_dbr_days ?? 0);
    row.actual_rental_days += Number(k.rental_act_days ?? 0);
    row.revenue += Number(k.total_revenue ?? 0);
    row.months += 1;
  }

  const rows = [...byKey.values()].map((r) => ({
    ...r,
    utilization_pct:
      r.fleet_days > 0 ? (r.rental_days / r.fleet_days) * 100 : 0,
    financial_util_pct:
      r.acquisition_cost > 0 ? (r.revenue / r.acquisition_cost) * 100 : 0,
    avg_daily_rate:
      r.actual_rental_days > 0 ? r.revenue / r.actual_rental_days : 0,
  }));

  // Sort by revenue descending as the sensible default
  rows.sort((a, b) => b.revenue - a.revenue);

  // Build top-line summary
  const summary = rows.reduce(
    (acc, r) => {
      acc.fleet_days += r.fleet_days;
      acc.rental_days += r.rental_days;
      acc.actual_rental_days += r.actual_rental_days;
      acc.revenue += r.revenue;
      if (r.kind === "asset") {
        if (!acc._costedAssets.has(r.asset_id!)) {
          acc._costedAssets.add(r.asset_id!);
          acc.acquisition_cost += r.acquisition_cost;
        }
      }
      return acc;
    },
    {
      fleet_days: 0,
      rental_days: 0,
      actual_rental_days: 0,
      revenue: 0,
      acquisition_cost: 0,
      _costedAssets: new Set<string>(),
    }
  );
  const summaryOut = {
    asset_count: rows.length,
    fleet_days: summary.fleet_days,
    rental_days: summary.rental_days,
    actual_rental_days: summary.actual_rental_days,
    revenue: summary.revenue,
    acquisition_cost: summary.acquisition_cost,
    utilization_pct:
      summary.fleet_days > 0
        ? (summary.rental_days / summary.fleet_days) * 100
        : 0,
    financial_util_pct:
      summary.acquisition_cost > 0
        ? (summary.revenue / summary.acquisition_cost) * 100
        : 0,
    avg_daily_rate:
      summary.actual_rental_days > 0
        ? summary.revenue / summary.actual_rental_days
        : 0,
  };

  return NextResponse.json({ period, group, rows, summary: summaryOut });
}
