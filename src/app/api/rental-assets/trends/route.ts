import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSubrental } from "@/lib/utils/subrental";

/**
 * GET /api/rental-assets/trends
 *
 * Returns monthly aggregates of rental_asset_kpis + rental_asset_maintenance
 * for a date range, bucketed by reporting_group. Paginates server-side so
 * the response is a small JSON payload regardless of how many KPI rows back
 * it. Used by the dashboard Trends tab.
 *
 * Params:
 *   organization_id   (required) — scope org
 *   start_year        default: earliest period in data
 *   start_month       default: 1
 *   end_year          default: latest period in data
 *   end_month         default: 12
 *   include_service   "true"/"false" — whether to include rental_category='service'
 *
 * Response shape:
 *   {
 *     series: Array<{
 *       year: number
 *       month: number
 *       period: "YYYY-MM"
 *       total: { revenue, rentalDays, fleetDays, utilizationPct, maintenance }
 *       byGroup: { [group]: { revenue, rentalDays, fleetDays, utilizationPct, maintenance } }
 *     }>
 *     groups: string[]
 *   }
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
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const includeService = sp.get("include_service") === "true";
  // When true, drop KPI rows flagged as sub-rentals (third-party units HDR
  // re-rents) so the dashboard reflects owned fleet only.
  const excludeSubrental = sp.get("exclude_subrental") === "true";
  const startYear = sp.get("start_year") ? Number(sp.get("start_year")) : null;
  const startMonth = sp.get("start_month")
    ? Number(sp.get("start_month"))
    : null;
  const endYear = sp.get("end_year") ? Number(sp.get("end_year")) : null;
  const endMonth = sp.get("end_month") ? Number(sp.get("end_month")) : null;
  const granularity = (sp.get("granularity") ?? "monthly") as
    | "monthly"
    | "quarterly"
    | "yearly";

  // Optional class filter — comma-separated list of vehicle_class codes.
  // When provided, restricts both KPI rows and maintenance rows to assets
  // whose vehicle_class is in the set. Case-insensitive match on the class
  // code, matching how groupFromClass normalizes keys below.
  const classesParam = sp.get("classes");
  const classFilter = classesParam
    ? new Set(
        classesParam
          .split(",")
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean)
      )
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Pull the set of fixed_asset_ids we're allowed to include based on the
  // rental_category filter. Used to filter KPIs that have a fixed_asset_id.
  const categoriesAllowed = includeService
    ? ["rental", "service"]
    : ["rental"];
  const { data: allowedAssetsRaw } = await admin
    .from("fixed_assets")
    .select("id, rental_category, vehicle_class, acquisition_cost")
    .in("rental_category", categoriesAllowed);
  const allowedAssets = (allowedAssetsRaw ?? []) as Array<{
    id: string;
    rental_category: string;
    vehicle_class: string | null;
    acquisition_cost: number | string | null;
  }>;
  const allowedAssetIds = new Set(allowedAssets.map((a) => a.id));
  const classByAssetId = new Map(
    allowedAssets.map((a) => [a.id, a.vehicle_class])
  );
  const costByAssetId = new Map(
    allowedAssets.map((a) => [a.id, Number(a.acquisition_cost ?? 0)])
  );

  // Pull KPI rows within range, paginated.
  const kpis: Array<{
    period_year: number;
    period_month: number;
    grain: string;
    fixed_asset_id: string | null;
    reporting_group: string | null;
    rental_dbr_days: number | null;
    rental_act_days: number | null;
    fleet_days: number | null;
    total_revenue: number | null;
    standard_rate: number | null;
    orphan_veh_number: string | null;
    subrental_flag: string | null;
    sale_date: string | null;
  }> = [];
  {
    const batch = 1000;
    let offset = 0;
    while (true) {
      let q = admin
        .from("rental_asset_kpis")
        .select(
          "period_year, period_month, grain, fixed_asset_id, reporting_group, rental_dbr_days, rental_act_days, fleet_days, total_revenue, standard_rate, orphan_veh_number, subrental_flag, sale_date"
        )
        .eq("organization_id", organizationId)
        .range(offset, offset + batch - 1);
      if (startYear && startMonth) {
        q = q.or(
          `period_year.gt.${startYear},and(period_year.eq.${startYear},period_month.gte.${startMonth})`
        );
      }
      if (endYear && endMonth) {
        q = q.or(
          `period_year.lt.${endYear},and(period_year.eq.${endYear},period_month.lte.${endMonth})`
        );
      }
      const { data, error } = await q;
      if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });
      const rows = (data ?? []) as typeof kpis;
      kpis.push(...rows);
      if (rows.length < batch) break;
      offset += batch;
    }
  }

  // Pull maintenance totals grouped by month + asset
  const maintenance: Array<{
    fixed_asset_id: string | null;
    completed_at: string | null;
    total_amount: number | null;
  }> = [];
  {
    const batch = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await admin
        .from("rental_asset_maintenance")
        .select("fixed_asset_id, completed_at, total_amount")
        .eq("organization_id", organizationId)
        .not("completed_at", "is", null)
        .range(offset, offset + batch - 1);
      if (error)
        return NextResponse.json({ error: error.message }, { status: 500 });
      const rows = (data ?? []) as typeof maintenance;
      maintenance.push(...rows);
      if (rows.length < batch) break;
      offset += batch;
    }
  }

  // Class → reporting group map (mirror of VEHICLE_CLASSIFICATIONS)
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

  // Aggregate
  type Bucket = {
    revenue: number;
    rentalDays: number;       // DBR rental days (col J)
    actualRentalDays: number; // actual rental days (col K) — denominator for ADR
    fleetDays: number;
    maintenance: number;
    acquisitionCost: number;
    assetIdsCounted: Set<string>;
    // Distinct vehicle keys (matched asset_id OR orphan veh_number) that had
    // fleet_days > 0 during the bucket — the "active" set.
    vehicleKeys: Set<string>;
    // Vehicles whose sale_date falls inside the bucket — disposed during the
    // period, so not owned at period-end. Subtracted from the active set to
    // give the end-of-period Vehicle Count.
    soldKeys: Set<string>;
  };
  const makeBucket = (): Bucket => ({
    revenue: 0,
    rentalDays: 0,
    actualRentalDays: 0,
    fleetDays: 0,
    maintenance: 0,
    acquisitionCost: 0,
    assetIdsCounted: new Set<string>(),
    vehicleKeys: new Set<string>(),
    soldKeys: new Set<string>(),
  });
  // Bucket key / label / sort-index computed from the chosen granularity.
  // Monthly: "2025-04" (sort key 202504)
  // Quarterly: "2025-Q2" (sort key 202502 — quarter number in the month slot)
  // Yearly: "2025" (sort key 202500)
  function bucketOf(y: number, m: number) {
    if (granularity === "yearly") {
      return { key: String(y), label: String(y), sort: y * 100 };
    }
    if (granularity === "quarterly") {
      const q = Math.floor((m - 1) / 3) + 1;
      return { key: `${y}-Q${q}`, label: `Q${q} ${y}`, sort: y * 100 + q };
    }
    return {
      key: `${y}-${String(m).padStart(2, "0")}`,
      label: `${y}-${String(m).padStart(2, "0")}`,
      sort: y * 100 + m,
    };
  }

  const periods = new Map<
    string,
    {
      key: string;
      label: string;
      sort: number;
      total: Bucket;
      byGroup: Map<string, Bucket>;
      // Calendar months (y-m) that contributed data to this bucket. Summing
      // their day counts gives the denominator for the "average assets on
      // rent" metric — rental-days ÷ days-in-period = avg assets earning per
      // day. Tracking only months with data keeps partial periods (e.g. the
      // first quarter in the dataset) from being diluted by empty months.
      months: Set<string>;
    }
  >();
  const groupSet = new Set<string>();

  function ensurePeriod(y: number, m: number) {
    const b = bucketOf(y, m);
    let p = periods.get(b.key);
    if (!p) {
      p = {
        key: b.key,
        label: b.label,
        sort: b.sort,
        total: makeBucket(),
        byGroup: new Map(),
        months: new Set<string>(),
      };
      periods.set(b.key, p);
    }
    p.months.add(`${y}-${m}`);
    return p;
  }
  function ensureGroup(
    p: ReturnType<typeof ensurePeriod>,
    group: string
  ): Bucket {
    let b = p.byGroup.get(group);
    if (!b) {
      b = makeBucket();
      p.byGroup.set(group, b);
    }
    groupSet.add(group);
    return b;
  }

  for (const k of kpis) {
    if (k.grain === "equipment_pool") continue;
    // Drop sub-rented units when the dashboard asks for owned fleet only.
    if (excludeSubrental && isSubrental(k.subrental_flag)) continue;
    // For asset-grain rows linked to a fixed_asset, enforce category filter
    if (k.fixed_asset_id && !allowedAssetIds.has(k.fixed_asset_id)) continue;
    // Class filter — skip rows whose linked asset isn't in the selected
    // class set. Orphans and unmatched rows are excluded when a class
    // filter is active since they have no class to compare against.
    if (classFilter) {
      if (!k.fixed_asset_id) continue;
      const cls = classByAssetId.get(k.fixed_asset_id);
      if (!cls || !classFilter.has(String(cls).trim().toUpperCase())) continue;
    }
    // Prefer the stored reporting_group (filled at ingest). Fallback to
    // deriving from the linked asset's vehicle_class.
    let group = k.reporting_group;
    if (!group && k.fixed_asset_id) {
      const cls = classByAssetId.get(k.fixed_asset_id);
      group = groupFromClass(cls);
    }
    group = group ?? "Unclassified";

    const p = ensurePeriod(k.period_year, k.period_month);
    const g = ensureGroup(p, group);
    const rd = Number(k.rental_dbr_days ?? 0);
    const ard = Number(k.rental_act_days ?? 0);
    const fd = Number(k.fleet_days ?? 0);
    const rev = Number(k.total_revenue ?? 0);
    g.revenue += rev;
    g.rentalDays += rd;
    g.actualRentalDays += ard;
    g.fleetDays += fd;
    p.total.revenue += rev;
    p.total.rentalDays += rd;
    p.total.actualRentalDays += ard;
    p.total.fleetDays += fd;
    // Vehicle-count dedup: any asset-grain row with fleet_days > 0 is an
    // active vehicle for this bucket. Key matched rows by fixed_asset_id
    // and orphans by their Veh_number so the same vehicle is only counted
    // once per bucket even across multi-row quarterly/yearly aggregations.
    // A vehicle whose sale_date lands in one of the bucket's months was sold
    // during the period — record it in soldKeys (independent of fleet_days,
    // since a sale-month row may show zero fleet days) so it can be removed
    // from the end-of-period count even though it was active earlier.
    const vKey = k.fixed_asset_id
      ? `a:${k.fixed_asset_id}`
      : `o:${k.orphan_veh_number ?? ""}`;
    if (vKey !== "o:") {
      if (fd > 0) {
        g.vehicleKeys.add(vKey);
        p.total.vehicleKeys.add(vKey);
      }
      if (soldInMonth(k.sale_date, k.period_year, k.period_month)) {
        g.soldKeys.add(vKey);
        p.total.soldKeys.add(vKey);
      }
    }
    // Financial utilization denominator — only matched assets carry an
    // acquisition cost. Dedupe per period × scope so a multi-row asset
    // isn't double-counted within the month.
    if (k.fixed_asset_id) {
      const cost = costByAssetId.get(k.fixed_asset_id) ?? 0;
      if (!g.assetIdsCounted.has(k.fixed_asset_id)) {
        g.assetIdsCounted.add(k.fixed_asset_id);
        g.acquisitionCost += cost;
      }
      if (!p.total.assetIdsCounted.has(k.fixed_asset_id)) {
        p.total.assetIdsCounted.add(k.fixed_asset_id);
        p.total.acquisitionCost += cost;
      }
    }
  }

  for (const m of maintenance) {
    if (!m.completed_at) continue;
    const d = new Date(m.completed_at);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    if (startYear && (y < startYear || (y === startYear && mo < (startMonth ?? 1))))
      continue;
    if (endYear && (y > endYear || (y === endYear && mo > (endMonth ?? 12))))
      continue;
    // Apply the same class filter used above on KPIs so maintenance
    // spend in the chart matches the filtered KPI scope.
    if (classFilter) {
      if (!m.fixed_asset_id) continue;
      const cls = classByAssetId.get(m.fixed_asset_id);
      if (!cls || !classFilter.has(String(cls).trim().toUpperCase())) continue;
    }
    const p = ensurePeriod(y, mo);
    let group = "Unclassified";
    if (m.fixed_asset_id) {
      if (!allowedAssetIds.has(m.fixed_asset_id)) continue;
      const cls = classByAssetId.get(m.fixed_asset_id);
      group = groupFromClass(cls) ?? "Unclassified";
    }
    const g = ensureGroup(p, group);
    const amt = Number(m.total_amount ?? 0);
    g.maintenance += amt;
    p.total.maintenance += amt;
  }

  const series = [...periods.values()]
    .sort((a, b) => a.sort - b.sort)
    .map((p) => {
      const total = p.total;
      const totalUtil =
        total.fleetDays > 0 ? (total.rentalDays / total.fleetDays) * 100 : 0;
      // Days spanned by the months that carried data in this bucket. Used as
      // the denominator for average-assets-on-rent (and average fleet size),
      // converting a sum of asset-days into an average daily count.
      const daysInPeriod = [...p.months].reduce(
        (s, key) => s + daysInMonth(key),
        0
      );
      const byGroup: Record<
        string,
        {
          revenue: number;
          rentalDays: number;
          actualRentalDays: number;
          fleetDays: number;
          maintenance: number;
          acquisitionCost: number;
          utilizationPct: number;
          finUtilPct: number;
          avgDailyRate: number;
          vehicleCount: number;
          activeVehicleCount: number;
          revenuePerActiveAsset: number;
          avgAssetsOnRent: number;
          avgFleetSize: number;
        }
      > = {};
      for (const [g, b] of p.byGroup) {
        // Active = anything in fleet during the period; EOP = active minus
        // vehicles sold within the period (no longer owned at period-end).
        const activeVc = b.vehicleKeys.size;
        const vc = countOwnedAtEop(b.vehicleKeys, b.soldKeys);
        byGroup[g] = {
          revenue: round2(b.revenue),
          rentalDays: round2(b.rentalDays),
          actualRentalDays: round2(b.actualRentalDays),
          fleetDays: round2(b.fleetDays),
          maintenance: round2(b.maintenance),
          acquisitionCost: round2(b.acquisitionCost),
          utilizationPct: b.fleetDays > 0 ? round2((b.rentalDays / b.fleetDays) * 100) : 0,
          finUtilPct:
            b.acquisitionCost > 0
              ? round2((b.revenue / b.acquisitionCost) * 100)
              : 0,
          avgDailyRate:
            b.actualRentalDays > 0
              ? round2(b.revenue / b.actualRentalDays)
              : 0,
          vehicleCount: vc,
          activeVehicleCount: activeVc,
          // Per-asset revenue divides by the assets that were actually in
          // fleet during the period (they earned the revenue), not the EOP
          // count, so a mid-period sale doesn't inflate the per-asset figure.
          revenuePerActiveAsset: activeVc > 0 ? round2(b.revenue / activeVc) : 0,
          avgAssetsOnRent:
            daysInPeriod > 0 ? round2(b.rentalDays / daysInPeriod) : 0,
          avgFleetSize:
            daysInPeriod > 0 ? round2(b.fleetDays / daysInPeriod) : 0,
        };
      }
      const totalActiveVc = total.vehicleKeys.size;
      const totalVc = countOwnedAtEop(total.vehicleKeys, total.soldKeys);
      return {
        period: p.key,
        label: p.label,
        total: {
          revenue: round2(total.revenue),
          rentalDays: round2(total.rentalDays),
          actualRentalDays: round2(total.actualRentalDays),
          fleetDays: round2(total.fleetDays),
          maintenance: round2(total.maintenance),
          acquisitionCost: round2(total.acquisitionCost),
          utilizationPct: round2(totalUtil),
          finUtilPct:
            total.acquisitionCost > 0
              ? round2((total.revenue / total.acquisitionCost) * 100)
              : 0,
          avgDailyRate:
            total.actualRentalDays > 0
              ? round2(total.revenue / total.actualRentalDays)
              : 0,
          vehicleCount: totalVc,
          activeVehicleCount: totalActiveVc,
          revenuePerActiveAsset:
            totalActiveVc > 0 ? round2(total.revenue / totalActiveVc) : 0,
          avgAssetsOnRent:
            daysInPeriod > 0 ? round2(total.rentalDays / daysInPeriod) : 0,
          avgFleetSize:
            daysInPeriod > 0 ? round2(total.fleetDays / daysInPeriod) : 0,
        },
        byGroup,
      };
    });

  const groups = [...groupSet].sort();

  return NextResponse.json({ series, groups });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Calendar days in the given "YYYY-M" month (month is 1-based). Day 0 of the
// next month rolls back to the last day of this one, so this is leap-year and
// month-length correct.
function daysInMonth(key: string): number {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return 0;
  return new Date(y, m, 0).getDate();
}

// True when a sale_date ("YYYY-MM-DD") lands in the given period month — i.e.
// the vehicle was disposed that month. Across a multi-month bucket this fires
// on the sale-month row, flagging the vehicle even if it was active earlier in
// the bucket. sale_date is a date-only string, so compare in UTC.
function soldInMonth(
  saleDate: string | null,
  year: number,
  month: number
): boolean {
  if (!saleDate) return false;
  const d = new Date(saleDate);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
}

// End-of-period owned count: active vehicles minus those sold during the
// period.
function countOwnedAtEop(active: Set<string>, sold: Set<string>): number {
  let n = 0;
  for (const k of active) if (!sold.has(k)) n++;
  return n;
}
