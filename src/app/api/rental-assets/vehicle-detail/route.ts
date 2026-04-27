import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/rental-assets/vehicle-detail
 *
 * Dual-purpose endpoint backing the Vehicle Lookup feature on the Rental
 * Assets dashboard.
 *
 *   ?q=<text>                  → search: returns up to 20 matching vehicles.
 *   ?fixed_asset_id=<uuid>     → detail: returns all-time totals + monthly
 *                                series for charting.
 *
 * Query params:
 *   organization_id (required)
 *   q               (optional) search across asset_tag / vin / year / make /
 *                   model. Case-insensitive substring match.
 *   fixed_asset_id  (optional) uuid of a single fixed_assets row; returns
 *                   the full detail payload.
 *
 * One of `q` or `fixed_asset_id` must be provided.
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
  const q = sp.get("q");
  const fixedAssetId = sp.get("fixed_asset_id");
  if (!organizationId) {
    return NextResponse.json(
      { error: "organization_id required" },
      { status: 400 }
    );
  }
  if (!q && !fixedAssetId) {
    return NextResponse.json(
      { error: "q or fixed_asset_id required" },
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

  // Tables not in the generated Supabase types yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ────────── Search branch ──────────
  if (q && !fixedAssetId) {
    const term = q.trim();
    if (term.length < 1) {
      return NextResponse.json({ matches: [] });
    }
    // Scope the search to the caller's org by joining through `entities`.
    // fixed_assets has `entity_id`, entities has `organization_id`. We filter
    // `entity_id` against the org's entity ids first, then apply ILIKE on
    // identity columns. vehicle_year is numeric — include it if the term
    // parses as an integer.
    const { data: entityRows } = await admin
      .from("entities")
      .select("id, name")
      .eq("organization_id", organizationId);
    const entityIds = (entityRows ?? []).map(
      (e: { id: string }) => e.id
    ) as string[];
    const entityNameById = new Map<string, string>(
      (entityRows ?? []).map((e: { id: string; name: string }) => [
        e.id,
        e.name,
      ])
    );
    if (entityIds.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    const escaped = term.replace(/[%_]/g, (c) => `\\${c}`);
    const like = `%${escaped}%`;
    const yearMatch = /^\d{4}$/.test(term) ? Number(term) : null;
    const orParts = [
      `asset_tag.ilike.${like}`,
      `vin.ilike.${like}`,
      `vehicle_make.ilike.${like}`,
      `vehicle_model.ilike.${like}`,
    ];
    if (yearMatch != null) {
      orParts.push(`vehicle_year.eq.${yearMatch}`);
    }

    const { data: assets, error } = await admin
      .from("fixed_assets")
      .select(
        "id, entity_id, asset_tag, vin, vehicle_year, vehicle_make, vehicle_model, vehicle_class, rental_category, acquisition_cost, disposed_date"
      )
      .in("entity_id", entityIds)
      .in("rental_category", ["rental", "service"])
      .or(orParts.join(","))
      .limit(20);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    type AssetRow = {
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
      disposed_date: string | null;
    };

    const matches = ((assets ?? []) as AssetRow[]).map((a) => ({
      id: a.id,
      entity_id: a.entity_id,
      entity_name: entityNameById.get(a.entity_id) ?? null,
      asset_tag: a.asset_tag,
      vin: a.vin,
      vehicle_year: a.vehicle_year,
      vehicle_make: a.vehicle_make,
      vehicle_model: a.vehicle_model,
      vehicle_class: a.vehicle_class,
      rental_category: a.rental_category,
      acquisition_cost: Number(a.acquisition_cost ?? 0),
      disposed_date: a.disposed_date,
    }));

    // Sort: non-disposed first, then by year desc, then by tag
    matches.sort((a, b) => {
      const da = a.disposed_date ? 1 : 0;
      const db = b.disposed_date ? 1 : 0;
      if (da !== db) return da - db;
      const ya = a.vehicle_year ?? 0;
      const yb = b.vehicle_year ?? 0;
      if (ya !== yb) return yb - ya;
      return (a.asset_tag ?? "").localeCompare(b.asset_tag ?? "");
    });

    return NextResponse.json({ matches });
  }

  // ────────── Detail branch ──────────
  if (!fixedAssetId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Load the asset identity row. `reporting_group` is not stored on
  // fixed_assets — it lives on rental_asset_kpis and we derive it from the
  // most recent KPI row below.
  const { data: assetRow, error: assetErr } = await admin
    .from("fixed_assets")
    .select(
      "id, entity_id, asset_tag, vin, vehicle_year, vehicle_make, vehicle_model, vehicle_class, rental_category, acquisition_cost, in_service_date, disposed_date"
    )
    .eq("id", fixedAssetId)
    .maybeSingle();
  if (assetErr) {
    return NextResponse.json({ error: assetErr.message }, { status: 500 });
  }
  if (!assetRow) {
    return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  }

  // Verify the asset belongs to an entity in the caller's org.
  const { data: entityRow } = await admin
    .from("entities")
    .select("id, name, organization_id")
    .eq("id", assetRow.entity_id)
    .maybeSingle();
  if (!entityRow || entityRow.organization_id !== organizationId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pull every monthly KPI row for this asset, across all history.
  const kpiRows: Array<{
    period_year: number;
    period_month: number;
    reporting_group: string | null;
    fleet_days: number | null;
    rental_dbr_days: number | null;
    rental_act_days: number | null;
    total_revenue: number | null;
    dbr_util_pct: number | null;
    dbr_status: string | null;
  }> = [];
  {
    const batch = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await admin
        .from("rental_asset_kpis")
        .select(
          "period_year, period_month, reporting_group, fleet_days, rental_dbr_days, rental_act_days, total_revenue, dbr_util_pct, dbr_status"
        )
        .eq("organization_id", organizationId)
        .eq("grain", "asset")
        .eq("fixed_asset_id", fixedAssetId)
        .range(offset, offset + batch - 1);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rows = (data ?? []) as typeof kpiRows;
      kpiRows.push(...rows);
      if (rows.length < batch) break;
      offset += batch;
    }
  }

  // Pull every maintenance row for this asset, across all history.
  const maintRows: Array<{
    completed_at: string | null;
    total_amount: number | null;
    status: string | null;
  }> = [];
  {
    const batch = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await admin
        .from("rental_asset_maintenance")
        .select("completed_at, total_amount, status")
        .eq("organization_id", organizationId)
        .eq("fixed_asset_id", fixedAssetId)
        .not("completed_at", "is", null)
        .range(offset, offset + batch - 1);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rows = (data ?? []) as typeof maintRows;
      maintRows.push(...rows);
      if (rows.length < batch) break;
      offset += batch;
    }
  }

  // Bucket maintenance by year/month
  const maintByPeriod = new Map<string, number>();
  for (const m of maintRows) {
    if (!m.completed_at) continue;
    const d = new Date(m.completed_at);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const key = `${y}-${String(mo).padStart(2, "0")}`;
    maintByPeriod.set(
      key,
      (maintByPeriod.get(key) ?? 0) + Number(m.total_amount ?? 0)
    );
  }

  // Build monthly series merged across KPI + maintenance
  const seriesMap = new Map<
    string,
    {
      period: string;
      year: number;
      month: number;
      revenue: number;
      rentalDays: number;
      actualRentalDays: number;
      fleetDays: number;
      utilizationPct: number;
      maintenance: number;
    }
  >();

  for (const k of kpiRows) {
    const period = `${k.period_year}-${String(k.period_month).padStart(2, "0")}`;
    const fleetDays = Number(k.fleet_days ?? 0);
    const rentalDays = Number(k.rental_dbr_days ?? 0);
    seriesMap.set(period, {
      period,
      year: k.period_year,
      month: k.period_month,
      revenue: Number(k.total_revenue ?? 0),
      rentalDays,
      actualRentalDays: Number(k.rental_act_days ?? 0),
      fleetDays,
      utilizationPct: fleetDays > 0 ? (rentalDays / fleetDays) * 100 : 0,
      maintenance: maintByPeriod.get(period) ?? 0,
    });
  }
  // Fold in maintenance-only months (rare — e.g. service after disposal)
  for (const [period, amt] of maintByPeriod) {
    if (seriesMap.has(period)) continue;
    const [ys, ms] = period.split("-");
    seriesMap.set(period, {
      period,
      year: Number(ys),
      month: Number(ms),
      revenue: 0,
      rentalDays: 0,
      actualRentalDays: 0,
      fleetDays: 0,
      utilizationPct: 0,
      maintenance: amt,
    });
  }

  const series = [...seriesMap.values()].sort((a, b) =>
    a.period.localeCompare(b.period)
  );

  // reporting_group: take the most recent non-null value from KPI history.
  // KPI rows carry the reporting group the vehicle was classified into for
  // that period — use the newest as the "current" classification.
  const reportingGroup =
    [...kpiRows]
      .sort((a, b) => {
        if (a.period_year !== b.period_year) {
          return b.period_year - a.period_year;
        }
        return b.period_month - a.period_month;
      })
      .find((k) => k.reporting_group)?.reporting_group ?? null;

  // All-time rollup
  const totals = series.reduce(
    (acc, s) => {
      acc.revenue += s.revenue;
      acc.rentalDays += s.rentalDays;
      acc.actualRentalDays += s.actualRentalDays;
      acc.fleetDays += s.fleetDays;
      acc.maintenance += s.maintenance;
      return acc;
    },
    {
      revenue: 0,
      rentalDays: 0,
      actualRentalDays: 0,
      fleetDays: 0,
      maintenance: 0,
    }
  );
  const avgUtilizationPct =
    totals.fleetDays > 0 ? (totals.rentalDays / totals.fleetDays) * 100 : 0;
  const avgDailyRate =
    totals.actualRentalDays > 0 ? totals.revenue / totals.actualRentalDays : 0;
  const acquisitionCost = Number(assetRow.acquisition_cost ?? 0);
  const financialUtilizationPct =
    acquisitionCost > 0 ? (totals.revenue / acquisitionCost) * 100 : 0;
  const netOfMaintenance = totals.revenue - totals.maintenance;

  return NextResponse.json({
    vehicle: {
      id: assetRow.id,
      entity_id: assetRow.entity_id,
      entity_name: entityRow.name,
      asset_tag: assetRow.asset_tag,
      vin: assetRow.vin,
      vehicle_year: assetRow.vehicle_year,
      vehicle_make: assetRow.vehicle_make,
      vehicle_model: assetRow.vehicle_model,
      vehicle_class: assetRow.vehicle_class,
      reporting_group: reportingGroup,
      rental_category: assetRow.rental_category,
      acquisition_cost: acquisitionCost,
      in_service_date: assetRow.in_service_date,
      disposed_date: assetRow.disposed_date,
    },
    totals: {
      ...totals,
      avgUtilizationPct,
      avgDailyRate,
      acquisitionCost,
      financialUtilizationPct,
      netOfMaintenance,
      months: series.filter((s) => s.fleetDays > 0 || s.maintenance > 0)
        .length,
    },
    series,
  });
}
