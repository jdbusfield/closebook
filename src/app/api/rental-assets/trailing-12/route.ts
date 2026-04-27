import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/rental-assets/trailing-12
 *
 * Trailing-twelve-month aggregation of rental asset KPIs + maintenance,
 * bucketed by reporting group. The TTM window ends at (period_year,
 * period_month) and spans the 12 periods ending there (inclusive).
 *
 * Fleet size in the response is the count of active KPI rows at the END
 * of the window (= the selected period). Additions/disposals are diffed
 * against the fleet 12 periods before (one month before the start of the
 * window) so the numbers answer the question "how did the fleet change
 * over the past 12 months?". Rental days, fleet days, revenue, and
 * maintenance are simple sums over the window. DBR utilization is
 * recomputed from the summed totals.
 *
 * Params:
 *   organization_id     (required)
 *   period_year         (required) — TTM end year
 *   period_month        (required) — TTM end month (1..12)
 *   include_service     "true"/"false" (default false)
 *   entity_id           (optional) — scope to a single entity
 *   reporting_groups    (optional, comma-separated) — filter to these groups
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
  const periodYearStr = sp.get("period_year");
  const periodMonthStr = sp.get("period_month");
  if (!organizationId || !periodYearStr || !periodMonthStr) {
    return NextResponse.json(
      { error: "organization_id, period_year, period_month required" },
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

  const endYear = Number(periodYearStr);
  const endMonth = Number(periodMonthStr);
  const includeService = sp.get("include_service") === "true";
  const entityId = sp.get("entity_id");
  const groupsParam = sp.get("reporting_groups");
  const groupFilter = groupsParam
    ? new Set(
        groupsParam
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean)
      )
    : null;

  // Window: 12 periods ending at (endYear, endMonth), inclusive.
  // Example: end = Jan 2026 → start = Feb 2025; BOP = Jan 2025.
  const startAbsolute = endYear * 12 + (endMonth - 1) - 11;
  const startYear = Math.floor(startAbsolute / 12);
  const startMonth = (startAbsolute % 12) + 1;
  const bopAbsolute = startAbsolute - 1;
  const bopYear = Math.floor(bopAbsolute / 12);
  const bopMonth = (bopAbsolute % 12) + 1;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // ────────── Fetch asset context ──────────
  // Pull the org's assets so we can filter by rental_category and entity,
  // and map asset_id → vehicle_class / acquisition_cost / entity.
  const categoriesAllowed = includeService
    ? ["rental", "service"]
    : ["rental"];
  let assetsQuery = admin
    .from("fixed_assets")
    .select(
      "id, entity_id, rental_category, vehicle_class, acquisition_cost"
    )
    .in("rental_category", categoriesAllowed);
  if (entityId) assetsQuery = assetsQuery.eq("entity_id", entityId);
  const { data: allowedAssetsRaw, error: assetsErr } = await assetsQuery;
  if (assetsErr) {
    return NextResponse.json({ error: assetsErr.message }, { status: 500 });
  }
  const allowedAssets = (allowedAssetsRaw ?? []) as Array<{
    id: string;
    entity_id: string;
    rental_category: string;
    vehicle_class: string | null;
    acquisition_cost: number | string | null;
  }>;
  const allowedAssetIds = new Set(allowedAssets.map((a) => a.id));
  const classByAssetId = new Map(
    allowedAssets.map((a) => [a.id, a.vehicle_class])
  );

  // Class → reporting group map (mirrors VEHICLE_CLASSIFICATIONS in the UI).
  // Kept in sync with /api/rental-assets/trends.
  const CLASS_TO_GROUP: Record<string, string> = {
    "1R": "Cast Trailer", "2": "Studio Box Truck", "2R": "Cast Trailer",
    "3": "Car", "3R": "Cast Trailer", "4": "Car",
    "5": "Car", "6": "Car", "7": "Car",
    "8": "Passenger Van", "8MU": "Makeup Trailer", "9": "Studio Box Truck",
    "11": "Cargo Van", "12": "Car", "13": "Box Truck",
    "13T": "Box Truck", "13W": "Box Truck", "14": "Box Truck",
    "15": "Stakebed", "15I": "Stakebed", "15L": "Stakebed",
    "16": "Stakebed", "17": "Car", "18": "Car",
    "20": "Box Truck", "20T": "Box Truck", "21": "Car",
    "22": "Box Truck", "23": "Stakebed", "24": "Box Truck",
    "26": "Cargo Van", "27": "Studio Box Truck", "28": "Passenger Van",
    "28P": "Passenger Van", "28S": "Passenger Van", "29": "Cargo Van",
    "30": "Cargo Van", "31": "Cargo Van", "32": "Cargo Van",
    "33": "Cargo Van", "34": "Cargo Van", "40": "Studio Box Truck",
    "51": "Stakebed", "52": "Stakebed", "4BR": "Cast Trailer",
  };
  function groupFromClass(cls: string | null | undefined): string | null {
    if (!cls) return null;
    const key = String(cls).trim().toUpperCase();
    if (CLASS_TO_GROUP[key]) return CLASS_TO_GROUP[key];
    if (/^\d+TB/.test(key)) return "Cast Trailer";
    return null;
  }

  // ────────── Fetch KPI rows ──────────
  // Pull all asset-grain KPI rows across the TTM window AND the BOP period
  // in a single paginated query so we can partition client-side. Including
  // BOP avoids a second round-trip.
  type KpiRow = {
    period_year: number;
    period_month: number;
    grain: string;
    fixed_asset_id: string | null;
    reporting_group: string | null;
    rental_dbr_days: number | null;
    fleet_days: number | null;
    total_revenue: number | null;
    orphan_veh_number: string | null;
    orphan_bridge_vin: string | null;
  };
  const kpis: KpiRow[] = [];
  {
    const batch = 1000;
    let offset = 0;
    while (true) {
      const q = admin
        .from("rental_asset_kpis")
        .select(
          "period_year, period_month, grain, fixed_asset_id, reporting_group, rental_dbr_days, fleet_days, total_revenue, orphan_veh_number, orphan_bridge_vin"
        )
        .eq("organization_id", organizationId)
        .eq("grain", "asset")
        .or(
          `period_year.gt.${bopYear},and(period_year.eq.${bopYear},period_month.gte.${bopMonth})`
        )
        .or(
          `period_year.lt.${endYear},and(period_year.eq.${endYear},period_month.lte.${endMonth})`
        )
        .range(offset, offset + batch - 1);
      const { data, error } = await q;
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rows = (data ?? []) as KpiRow[];
      kpis.push(...rows);
      if (rows.length < batch) break;
      offset += batch;
    }
  }

  // ────────── Fetch maintenance over TTM window ──────────
  const ttmStartIso = new Date(
    Date.UTC(startYear, startMonth - 1, 1)
  ).toISOString();
  const ttmEndIso = new Date(
    Date.UTC(endYear, endMonth, 1)
  ).toISOString();
  const maintenance: Array<{
    fixed_asset_id: string | null;
    total_amount: number | null;
  }> = [];
  {
    const batch = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await admin
        .from("rental_asset_maintenance")
        .select("fixed_asset_id, total_amount")
        .eq("organization_id", organizationId)
        .not("completed_at", "is", null)
        .gte("completed_at", ttmStartIso)
        .lt("completed_at", ttmEndIso)
        .range(offset, offset + batch - 1);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const rows = (data ?? []) as typeof maintenance;
      maintenance.push(...rows);
      if (rows.length < batch) break;
      offset += batch;
    }
  }

  // ────────── Aggregate ──────────
  type GroupBucket = {
    group: string;
    fleetSize: number;
    bopFleet: number;
    additions: number;
    dispositions: number;
    rentalDays: number;
    fleetDays: number;
    revenue: number;
    maintenance: number;
  };
  const byGroup = new Map<string, GroupBucket>();
  const ensure = (g: string) => {
    let b = byGroup.get(g);
    if (!b) {
      b = {
        group: g,
        fleetSize: 0,
        bopFleet: 0,
        additions: 0,
        dispositions: 0,
        rentalDays: 0,
        fleetDays: 0,
        revenue: 0,
        maintenance: 0,
      };
      byGroup.set(g, b);
    }
    return b;
  };

  // Helpers
  function resolveGroup(k: KpiRow): string {
    let g = k.reporting_group;
    if (!g && k.fixed_asset_id) {
      g = groupFromClass(classByAssetId.get(k.fixed_asset_id));
    }
    return g ?? "Unclassified";
  }
  function kpiInScope(k: KpiRow): boolean {
    // Asset-grain only (we enforce that in the query too).
    if (k.fixed_asset_id) {
      // Matched row — asset must be allowed (category + optional entity).
      if (!allowedAssetIds.has(k.fixed_asset_id)) return false;
    } else {
      // Orphan — excluded when scoped to a specific entity (orphans have
      // no entity association). Org-wide view still counts them.
      if (entityId) return false;
    }
    if (groupFilter && !groupFilter.has(resolveGroup(k))) return false;
    return true;
  }
  function stableKey(k: KpiRow): string | null {
    if (k.fixed_asset_id) return `asset:${k.fixed_asset_id}`;
    const orphan = k.orphan_veh_number ?? k.orphan_bridge_vin ?? "";
    if (!orphan) return null;
    return `orphan:${orphan}`;
  }

  // Partition rows by where they fall in time.
  const eopKeys = new Set<string>();
  const bopKeys = new Set<string>();
  const eopKeyToGroup = new Map<string, string>();
  const bopKeyToGroup = new Map<string, string>();
  const ttmKpis: KpiRow[] = [];

  for (const k of kpis) {
    if (!kpiInScope(k)) continue;
    const isBop = k.period_year === bopYear && k.period_month === bopMonth;
    const isEop = k.period_year === endYear && k.period_month === endMonth;
    const inTtm =
      (k.period_year > startYear ||
        (k.period_year === startYear && k.period_month >= startMonth)) &&
      (k.period_year < endYear ||
        (k.period_year === endYear && k.period_month <= endMonth));
    if (inTtm) ttmKpis.push(k);
    if ((k.fleet_days ?? 0) > 0) {
      const key = stableKey(k);
      if (!key) continue;
      const g = resolveGroup(k);
      if (isEop) {
        eopKeys.add(key);
        eopKeyToGroup.set(key, g);
      }
      if (isBop) {
        bopKeys.add(key);
        bopKeyToGroup.set(key, g);
      }
    }
  }

  // Fleet EOP / BOP per group
  for (const [key, g] of eopKeyToGroup) {
    ensure(g).fleetSize++;
    if (!bopKeys.has(key)) ensure(g).additions++;
  }
  for (const [key, g] of bopKeyToGroup) {
    ensure(g).bopFleet++;
    if (!eopKeys.has(key)) ensure(g).dispositions++;
  }

  // TTM sums
  for (const k of ttmKpis) {
    const g = resolveGroup(k);
    const row = ensure(g);
    row.rentalDays += Number(k.rental_dbr_days ?? 0);
    row.fleetDays += Number(k.fleet_days ?? 0);
    row.revenue += Number(k.total_revenue ?? 0);
  }

  // Maintenance in TTM window
  for (const m of maintenance) {
    if (!m.fixed_asset_id) continue;
    if (!allowedAssetIds.has(m.fixed_asset_id)) continue;
    const g = groupFromClass(classByAssetId.get(m.fixed_asset_id)) ?? "Unclassified";
    if (groupFilter && !groupFilter.has(g)) continue;
    ensure(g).maintenance += Number(m.total_amount ?? 0);
  }

  // Finalize: compute utilDbr and round
  const groups = Array.from(byGroup.values())
    .map((b) => ({
      ...b,
      rentalDays: round2(b.rentalDays),
      fleetDays: round2(b.fleetDays),
      revenue: round2(b.revenue),
      maintenance: round2(b.maintenance),
      utilDbr: b.fleetDays > 0 ? round2((b.rentalDays / b.fleetDays) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const totals = groups.reduce(
    (acc, g) => {
      acc.fleetSize += g.fleetSize;
      acc.bopFleet += g.bopFleet;
      acc.additions += g.additions;
      acc.dispositions += g.dispositions;
      acc.rentalDays += g.rentalDays;
      acc.fleetDays += g.fleetDays;
      acc.revenue += g.revenue;
      acc.maintenance += g.maintenance;
      return acc;
    },
    {
      fleetSize: 0,
      bopFleet: 0,
      additions: 0,
      dispositions: 0,
      rentalDays: 0,
      fleetDays: 0,
      revenue: 0,
      maintenance: 0,
    }
  );
  const totalsWithUtil = {
    ...totals,
    utilDbr:
      totals.fleetDays > 0
        ? round2((totals.rentalDays / totals.fleetDays) * 100)
        : 0,
  };

  return NextResponse.json({
    groups,
    totals: totalsWithUtil,
    window: {
      startYear,
      startMonth,
      endYear,
      endMonth,
    },
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
