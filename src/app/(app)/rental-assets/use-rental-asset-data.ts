"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSubrental } from "@/lib/utils/subrental";

// True when a sale_date ("YYYY-MM-DD") lands in the given period month — i.e.
// the vehicle was disposed that month, so it isn't owned at period-end. Date-
// only strings parse as UTC midnight, so compare in UTC.
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
import {
  getReportingGroup,
  customRowsToClassifications,
  type VehicleClassification,
  type CustomVehicleClassRow,
} from "@/lib/utils/vehicle-classification";

// ────────── types ──────────

export interface Entity {
  id: string;
  name: string;
  code: string;
  organization_id: string;
}

export interface ReportingEntity {
  id: string;
  name: string;
  code: string | null;
  member_entity_ids: string[];
}

export interface FixedAssetRow {
  id: string;
  entity_id: string;
  asset_tag: string | null;
  vin: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_class: string | null;
  status: string;
  in_service_date: string;
  acquisition_date: string;
  acquisition_cost: number;
  disposed_date: string | null;
  disposed_sale_price: number | null;
  rental_category: "rental" | "service" | "other";
  fleetio_vehicle_id: number | null;
  fleetio_group_name: string | null;
  odometer_current: number | null;
  odometer_current_as_of: string | null;
}

export interface KpiRow {
  id: string;
  period_year: number;
  period_month: number;
  grain: "asset" | "reporting_group" | "entity" | "equipment_pool";
  fixed_asset_id: string | null;
  reporting_group: string | null;
  entity_id: string | null;
  equipment_pool_key: string | null;
  orphan_bridge_vin: string | null;
  orphan_veh_number: string | null;
  dbr_status: string | null;
  sale_date: string | null;
  fleet_days: number | null;
  rental_dbr_days: number | null;
  rental_act_days: number | null;
  total_revenue: number | null;
  avg_revenue_per_day: number | null;
  standard_rate: number | null;
  dbr_util_pct: number | null;
  rev_util_pct: number | null;
  subrental_flag: string | null;
}

export interface MaintenanceRow {
  id: string;
  fixed_asset_id: string | null;
  fleetio_vehicle_id: number;
  fleetio_id: number;
  source: string;
  status: string | null;
  completed_at: string | null;
  reference: string | null;
  vendor_name: string | null;
  total_amount: number | null;
}

export interface SyncStateRow {
  resource: string;
  status: string;
  last_full_sync_at: string | null;
  last_incremental_sync_at: string | null;
  last_seen_updated_at: string | null;
  last_error: string | null;
}

// ────────── hook ──────────

export interface UseRentalAssetDataParams {
  organizationId: string | null;
  periodYear: number;
  periodMonth: number;
  includeService: boolean;
  excludeSubrental: boolean;
  scope: { type: "organization" } | { type: "entity"; entityId: string };
  reportingGroupFilter: string[] | null;
}

export function useRentalAssetData(params: UseRentalAssetDataParams) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [reportingEntities, setReportingEntities] = useState<ReportingEntity[]>([]);
  const [assets, setAssets] = useState<FixedAssetRow[]>([]);
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [priorKpis, setPriorKpis] = useState<KpiRow[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRow[]>([]);
  const [customClasses, setCustomClasses] = useState<VehicleClassification[]>([]);
  const [syncState, setSyncState] = useState<SyncStateRow[]>([]);
  const [availablePeriods, setAvailablePeriods] = useState<
    { year: number; month: number }[]
  >([]);

  const supabase = useMemo(() => createClient(), []);

  const load = useCallback(async () => {
    if (!params.organizationId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    try {
      // Tables not yet in generated types (rental_asset_*, fleetio_*,
      // fixed_assets extensions) — use the any-cast pattern the rest of the
      // codebase uses until `database.types.ts` is regenerated.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;

      // Distinct periods come from a dedicated API route that paginates
      // server-side — a browser round-trip to PostgREST is capped at 1000
      // rows, and walking 50k rows 50 pages at a time over the network is
      // slow.
      const availablePromise = (async () => {
        const res = await fetch(
          `/api/rental-assets/periods?organization_id=${encodeURIComponent(params.organizationId!)}`
        );
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`periods: ${res.status} ${body}`);
        }
        const json = (await res.json()) as {
          periods: { year: number; month: number }[];
        };
        return json.periods ?? [];
      })();

      // Compute prior period for beginning-of-period fleet + MoM deltas
      const priorMonth = params.periodMonth === 1 ? 12 : params.periodMonth - 1;
      const priorYear =
        params.periodMonth === 1 ? params.periodYear - 1 : params.periodYear;

      const [
        entitiesRes,
        reRes,
        assetsRes,
        kpisRes,
        priorKpisRes,
        availablePeriodsList,
        maintRes,
        classRes,
        syncRes,
      ] = await Promise.all([
        sb
          .from("entities")
          .select("id, name, code, organization_id")
          .eq("organization_id", params.organizationId),
        sb
          .from("reporting_entities")
          .select("id, name, code, reporting_entity_members(entity_id)")
          .eq("organization_id", params.organizationId),
        sb
          .from("fixed_assets")
          .select(
            "id, entity_id, asset_tag, vin, vehicle_year, vehicle_make, vehicle_model, vehicle_class, status, in_service_date, acquisition_date, acquisition_cost, disposed_date, disposed_sale_price, rental_category, fleetio_vehicle_id, fleetio_group_name, odometer_current, odometer_current_as_of"
          ),
        sb
          .from("rental_asset_kpis")
          .select(
            "id, period_year, period_month, grain, fixed_asset_id, reporting_group, entity_id, equipment_pool_key, orphan_bridge_vin, orphan_veh_number, dbr_status, sale_date, fleet_days, rental_dbr_days, rental_act_days, total_revenue, avg_revenue_per_day, standard_rate, dbr_util_pct, rev_util_pct, subrental_flag"
          )
          .eq("organization_id", params.organizationId)
          .eq("period_year", params.periodYear)
          .eq("period_month", params.periodMonth),
        sb
          .from("rental_asset_kpis")
          .select(
            "id, period_year, period_month, grain, fixed_asset_id, reporting_group, entity_id, equipment_pool_key, orphan_bridge_vin, orphan_veh_number, dbr_status, sale_date, fleet_days, rental_dbr_days, rental_act_days, total_revenue, avg_revenue_per_day, standard_rate, dbr_util_pct, rev_util_pct, subrental_flag"
          )
          .eq("organization_id", params.organizationId)
          .eq("period_year", priorYear)
          .eq("period_month", priorMonth),
        availablePromise,
        sb
          .from("rental_asset_maintenance")
          .select(
            "id, fixed_asset_id, fleetio_vehicle_id, fleetio_id, source, status, completed_at, reference, vendor_name, total_amount"
          )
          .eq("organization_id", params.organizationId)
          .gte(
            "completed_at",
            new Date(
              params.periodYear,
              params.periodMonth - 1,
              1
            ).toISOString()
          )
          .lt(
            "completed_at",
            new Date(
              params.periodYear,
              params.periodMonth,
              1
            ).toISOString()
          )
          .order("completed_at", { ascending: false })
          .limit(500),
        sb
          .from("custom_vehicle_classes")
          .select("*")
          .eq("organization_id", params.organizationId),
        sb
          .from("fleetio_sync_state")
          .select(
            "resource, status, last_full_sync_at, last_incremental_sync_at, last_seen_updated_at, last_error"
          )
          .eq("organization_id", params.organizationId),
      ]);

      if (entitiesRes.error) throw entitiesRes.error;
      if (reRes.error) throw reRes.error;
      if (assetsRes.error) throw assetsRes.error;
      if (kpisRes.error) throw kpisRes.error;
      if (priorKpisRes.error) throw priorKpisRes.error;
      if (maintRes.error) throw maintRes.error;

      setEntities((entitiesRes.data ?? []) as Entity[]);
      setReportingEntities(
        ((reRes.data ?? []) as Array<{
          id: string;
          name: string;
          code: string | null;
          reporting_entity_members?: Array<{ entity_id: string }>;
        }>).map((r) => ({
          id: r.id,
          name: r.name,
          code: r.code,
          member_entity_ids: (r.reporting_entity_members ?? []).map(
            (m) => m.entity_id
          ),
        }))
      );
      setAssets((assetsRes.data ?? []) as FixedAssetRow[]);
      setKpis((kpisRes.data ?? []) as KpiRow[]);
      setPriorKpis((priorKpisRes.data ?? []) as KpiRow[]);
      setMaintenance((maintRes.data ?? []) as MaintenanceRow[]);
      setCustomClasses(
        customRowsToClassifications(
          (classRes.data ?? []) as CustomVehicleClassRow[]
        )
      );
      setSyncState((syncRes.data ?? []) as SyncStateRow[]);

      setAvailablePeriods(availablePeriodsList);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [
    supabase,
    params.organizationId,
    params.periodYear,
    params.periodMonth,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // ────────── derived aggregates ──────────

  const computed = useMemo(() => {
    const customClassList = customClasses;

    // entity scope filter
    const entityAllowed = (entityId: string) => {
      if (params.scope.type === "organization") return true;
      if (params.scope.type === "entity")
        return entityId === params.scope.entityId;
      return true;
    };

    // category filter
    const catAllowed = (category: FixedAssetRow["rental_category"]) => {
      if (category === "rental") return true;
      if (category === "service" && params.includeService) return true;
      return false;
    };

    const activeAssets = assets.filter(
      (a) => entityAllowed(a.entity_id) && catAllowed(a.rental_category)
    );

    // index
    const assetById = new Map(activeAssets.map((a) => [a.id, a]));

    // reporting group for each asset (derived from vehicle_class)
    const groupFor = (a: FixedAssetRow): string => {
      const g = getReportingGroup(a.vehicle_class, customClassList);
      return g ?? "Unclassified";
    };

    // period bounds
    const periodStart = new Date(
      params.periodYear,
      params.periodMonth - 1,
      1
    );
    const periodEnd = new Date(params.periodYear, params.periodMonth, 0);
    const periodEndIso = periodEnd.toISOString().slice(0, 10);
    const periodStartIso = periodStart.toISOString().slice(0, 10);

    // ───── KPI partitioning ─────
    // Per user directive: fleet size reflects the rows physically present
    // on the DBR utilization spreadsheet for the period (fleet_days > 0),
    // NOT the closebook register. Apply group filter per-KPI; apply entity
    // filter only to matched rows (orphans have no entity association).
    const groupFilterSet = params.reportingGroupFilter
      ? new Set(params.reportingGroupFilter)
      : null;

    const groupOfKpi = (k: KpiRow): string => {
      if (k.fixed_asset_id) {
        const a = assetById.get(k.fixed_asset_id);
        if (a) return groupFor(a);
      }
      return k.reporting_group ?? "Unclassified";
    };
    const kpiInGroupFilter = (k: KpiRow) =>
      !groupFilterSet || groupFilterSet.has(groupOfKpi(k));
    // Sub-rented units (third-party vehicles HDR re-rents) are dropped when
    // the "Owned fleet only" toggle is on, so they don't inflate fleet size,
    // days, revenue, or utilization on any tile or group breakdown.
    const subrentalAllowed = (k: KpiRow) =>
      !params.excludeSubrental || !isSubrental(k.subrental_flag);
    const kpiInEntityScope = (k: KpiRow): boolean => {
      if (params.scope.type !== "entity") return true;
      // Matched row: asset must be in the scoped entity (assetById already
      // filters by entity scope since activeAssets honours entityAllowed).
      if (k.fixed_asset_id) return assetById.has(k.fixed_asset_id);
      // Orphans have no entity info — excluded from entity scope.
      return false;
    };
    const assetKpisFiltered = kpis.filter(
      (k) =>
        k.grain === "asset" &&
        k.fixed_asset_id &&
        assetById.has(k.fixed_asset_id) &&
        kpiInGroupFilter(k) &&
        subrentalAllowed(k)
    );
    const orphanKpisFiltered = kpis.filter(
      (k) =>
        k.grain === "asset" &&
        !k.fixed_asset_id &&
        (k.orphan_bridge_vin || k.orphan_veh_number) &&
        kpiInEntityScope(k) &&
        kpiInGroupFilter(k) &&
        subrentalAllowed(k)
    );
    const equipmentKpis = kpis.filter((k) => k.grain === "equipment_pool");

    // Legacy alias for downstream consumers
    const orphanKpis = orphanKpisFiltered;

    // ───── Fleet size from the spreadsheet ─────
    // "Active rental asset" = asset-grain KPI row with fleet_days > 0.
    const stableKey = (k: KpiRow) =>
      k.fixed_asset_id
        ? `asset:${k.fixed_asset_id}`
        : `orphan:${k.orphan_veh_number ?? k.orphan_bridge_vin ?? ""}`;

    const activeCurrent = [
      ...assetKpisFiltered,
      ...orphanKpisFiltered,
    ].filter((k) => (k.fleet_days ?? 0) > 0);

    const activeCurrentKeys = new Set(activeCurrent.map(stableKey));

    // End-of-period fleet: active vehicles minus any sold during the period.
    // A unit sold mid-month was in the fleet part of the month (so it keeps
    // contributing revenue / days to the totals above) but is no longer owned
    // at period-end, so it must drop out of the fleet-size count.
    const ownedAtEop = activeCurrent.filter(
      (k) => !soldInMonth(k.sale_date, params.periodYear, params.periodMonth)
    );

    // Prior period bounds, for an end-of-prior-month BOP count.
    const priorMonth = params.periodMonth === 1 ? 12 : params.periodMonth - 1;
    const priorYear =
      params.periodMonth === 1 ? params.periodYear - 1 : params.periodYear;

    // Same filters applied to prior-period KPIs for BOP / MoM deltas.
    const activePrior = priorKpis
      .filter(
        (k) =>
          k.grain === "asset" &&
          (k.fleet_days ?? 0) > 0 &&
          ((k.fixed_asset_id && assetById.has(k.fixed_asset_id)) ||
            (!k.fixed_asset_id &&
              (k.orphan_bridge_vin || k.orphan_veh_number) &&
              kpiInEntityScope(k)))
      )
      .filter(kpiInGroupFilter)
      .filter(subrentalAllowed);
    const activePriorKeys = new Set(activePrior.map(stableKey));

    const additionsKeys = [...activeCurrentKeys].filter(
      (k) => !activePriorKeys.has(k)
    );
    const dispositionsKeys = [...activePriorKeys].filter(
      (k) => !activeCurrentKeys.has(k)
    );

    // Still expose the closebook-derived activity for reference (used by
    // the Fleet Activity tab which shows accounting dates).
    const additionsAssets = activeAssets.filter(
      (a) =>
        a.in_service_date >= periodStartIso &&
        a.in_service_date <= periodEndIso
    );
    const dispositionsAssets = activeAssets.filter(
      (a) =>
        a.disposed_date &&
        a.disposed_date >= periodStartIso &&
        a.disposed_date <= periodEndIso
    );

    // aggregates — include orphans so historical totals aren't understated.
    const sum = (vals: Array<number | null | undefined>) =>
      vals.reduce<number>((a, v) => a + (v ?? 0), 0);

    const allKpisForTotals = [...assetKpisFiltered, ...orphanKpisFiltered];
    const totalRentalDays = sum(allKpisForTotals.map((k) => k.rental_dbr_days));
    const totalFleetDays = sum(allKpisForTotals.map((k) => k.fleet_days));
    const totalRevenue = sum(allKpisForTotals.map((k) => k.total_revenue));
    const weightedDbrUtil = totalFleetDays
      ? (totalRentalDays / totalFleetDays) * 100
      : 0;

    // Financial utilization = sum(revenue for active asset rows) ÷
    //                        sum(acquisition_cost of those assets) × 100
    // Only matched KPI rows count (orphans have no acquisition cost). The
    // denominator accumulates the cost of every asset that had a KPI row
    // in the period, so a vehicle active in multiple entity scopes can't
    // be double-counted within one period.
    let financialRevenue = 0;
    let financialCost = 0;
    const countedAssetIds = new Set<string>();
    for (const k of assetKpisFiltered) {
      const a = assetById.get(k.fixed_asset_id!);
      if (!a) continue;
      financialRevenue += k.total_revenue ?? 0;
      if (!countedAssetIds.has(a.id)) {
        countedAssetIds.add(a.id);
        financialCost += a.acquisition_cost ?? 0;
      }
    }
    const finUtilPct =
      financialCost > 0 ? (financialRevenue / financialCost) * 100 : 0;

    // group aggregation (respects filter)
    const byGroup = new Map<
      string,
      {
        group: string;
        fleetSize: number;
        rentalDays: number;
        fleetDays: number;
        revenue: number;
        utilDbr: number;
        utilRev: number;
        additions: number;
        dispositions: number;
        maintenance: number;
      }
    >();
    const ensureGroup = (g: string) => {
      let row = byGroup.get(g);
      if (!row) {
        row = {
          group: g,
          fleetSize: 0,
          rentalDays: 0,
          fleetDays: 0,
          revenue: 0,
          utilDbr: 0,
          utilRev: 0,
          additions: 0,
          dispositions: 0,
          maintenance: 0,
        };
        byGroup.set(g, row);
      }
      return row;
    };
    // Fleet size per group — one row per owned-at-period-end KPI row
    // (matched + orphan), excluding units sold during the period.
    for (const k of ownedAtEop) {
      const g = groupOfKpi(k);
      ensureGroup(g).fleetSize++;
    }
    // Rental days / fleet days / revenue per group — now using the same
    // asset-grain data we aggregate for hero totals.
    for (const k of assetKpisFiltered) {
      const g = groupOfKpi(k);
      const row = ensureGroup(g);
      row.rentalDays += k.rental_dbr_days ?? 0;
      row.fleetDays += k.fleet_days ?? 0;
      row.revenue += k.total_revenue ?? 0;
    }
    for (const k of orphanKpisFiltered) {
      const g = groupOfKpi(k);
      const row = ensureGroup(g);
      row.rentalDays += k.rental_dbr_days ?? 0;
      row.fleetDays += k.fleet_days ?? 0;
      row.revenue += k.total_revenue ?? 0;
    }
    // Additions / dispositions per group — computed by diffing prior vs
    // current active KPI sets. Same logic as the totals adds/dispos.
    const priorByKey = new Map(activePrior.map((k) => [stableKey(k), k]));
    const currentByKey = new Map(activeCurrent.map((k) => [stableKey(k), k]));
    for (const k of additionsKeys) {
      const kpi = currentByKey.get(k);
      if (!kpi) continue;
      ensureGroup(groupOfKpi(kpi)).additions++;
    }
    for (const k of dispositionsKeys) {
      const kpi = priorByKey.get(k);
      if (!kpi) continue;
      ensureGroup(groupOfKpi(kpi)).dispositions++;
    }
    for (const m of maintenance) {
      const a = m.fixed_asset_id ? assetById.get(m.fixed_asset_id) : undefined;
      if (!a) continue;
      const g = groupFor(a);
      if (groupFilterSet && !groupFilterSet.has(g)) continue;
      ensureGroup(g).maintenance += m.total_amount ?? 0;
    }
    // finalize utilization per group
    const groups = Array.from(byGroup.values()).map((r) => ({
      ...r,
      utilDbr: r.fleetDays ? (r.rentalDays / r.fleetDays) * 100 : 0,
    }));
    groups.sort((a, b) => b.revenue - a.revenue);

    const totalMaintenance = sum(maintenance.map((m) => m.total_amount));

    // Fleet size = vehicles owned at period-end (active minus sold-in-period).
    const fleetSize = ownedAtEop.length;
    // BOP = vehicles owned at the end of the prior month (active minus those
    // sold in the prior month), so it's comparable to the EOP count.
    const bopFleet = activePrior.filter(
      (k) => !soldInMonth(k.sale_date, priorYear, priorMonth)
    ).length;

    // Fleetio coverage = how many of our owned-at-EOP matched KPI rows have a
    // linked Fleetio vehicle (so the Maintenance tab can show data). Counted
    // over the same EOP set the denominator (fleetSize) uses.
    let fleetLinked = 0;
    for (const k of ownedAtEop) {
      if (!k.fixed_asset_id) continue; // orphans can't link
      const a = assetById.get(k.fixed_asset_id);
      if (a?.fleetio_vehicle_id != null) fleetLinked++;
    }

    return {
      periodStartIso,
      periodEndIso,
      activeAssets,
      assetById,
      // kept for the Fleet Activity tab (uses accounting in_service / disposed dates)
      additions: additionsAssets,
      dispositions: dispositionsAssets,
      assetKpis: assetKpisFiltered,
      orphanKpis,
      equipmentKpis,
      totals: {
        fleetSize,
        fleetLinked,
        bopFleet,
        additions: additionsKeys.length,
        dispositions: dispositionsKeys.length,
        rentalDays: totalRentalDays,
        fleetDays: totalFleetDays,
        revenue: totalRevenue,
        weightedDbrUtil,
        finUtilPct,
        financialCost,
        maintenance: totalMaintenance,
      },
      groups,
      groupFor,
    };
  }, [
    assets,
    kpis,
    priorKpis,
    maintenance,
    customClasses,
    params.includeService,
    params.excludeSubrental,
    params.scope,
    params.reportingGroupFilter,
    params.periodYear,
    params.periodMonth,
  ]);

  return {
    loading,
    error,
    entities,
    reportingEntities,
    availablePeriods,
    syncState,
    customClasses,
    maintenance,
    computed,
    reload: load,
  };
}
