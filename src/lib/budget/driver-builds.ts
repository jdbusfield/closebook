/**
 * Driver builds: rental revenue from the fleet.
 *
 * For each vehicle group in the version's entities, the trailing twelve
 * months of asset-level KPIs give utilization by calendar month and revenue
 * per rental day. Budget month = units in service x days x utilization x
 * revenue per rental day, with the capex and disposal plan moving the unit
 * count and two assumption keys (utilization points, day-rate change).
 */
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { computeCapexMonthly } from "./capex-engine";
import { loadCapexPlan, loadDepreciationDefaults } from "./schedule-builds";
import { amountsFromArray, baseBuild, isAllZero, zeros, type BuildContext, type BuildInsert } from "./build-types";

const VEHICLE_REVENUE_NUMBER = "4000";
const TRAILER_REVENUE_NUMBER = "4010";

interface KpiRow {
  period_year: number;
  period_month: number;
  fixed_asset_id: string | null;
  reporting_group: string | null;
  fleet_days: number | null;
  rental_act_days: number | null;
  rental_dbr_days: number | null;
  total_revenue: number | null;
}

interface GroupStats {
  group: string;
  trailer: boolean;
  entityIds: Set<string>;
  /** by calendar month index: fleet days, rental days, revenue */
  fleetDays: number[];
  rentalDays: number[];
  revenue: number[];
  unitsNow: number;
}

function daysIn(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export async function fleetRevenueBuilds(ctx: BuildContext): Promise<BuildInsert[]> {
  const out: BuildInsert[] = [];
  const assets = await fetchAllPaginated<{ id: string; entity_id: string; status: string; master_type_override: string | null; vehicle_class: string | null }>((o, l) =>
    ctx.admin
      .from("fixed_assets")
      .select("id, entity_id, status, master_type_override, vehicle_class")
      .in("entity_id", ctx.memberEntityIds)
      .range(o, o + l - 1),
  );
  if (assets.length === 0) return out;
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const assetIds = assets.map((a) => a.id);

  // Trailing 12 full months ending with the latest month that has KPI data
  const orgId = ctx.owner.organizationId!;
  const { data: latest } = await ctx.admin
    .from("rental_asset_kpis")
    .select("period_year, period_month")
    .eq("organization_id", orgId)
    .eq("grain", "asset")
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })
    .limit(1);
  if (!latest || latest.length === 0) return out;
  const endY = Number(latest[0].period_year);
  const endM = Number(latest[0].period_month);
  const window: Array<{ y: number; m: number }> = [];
  let y = endY;
  let m = endM;
  for (let i = 0; i < 12; i++) {
    window.unshift({ y, m });
    m--;
    if (m < 1) { m = 12; y--; }
  }
  const years = [...new Set(window.map((w) => w.y))];

  const rows: KpiRow[] = [];
  const CH = 300;
  for (let i = 0; i < assetIds.length; i += CH) {
    const chunk = await fetchAllPaginated<KpiRow>((o, l) =>
      ctx.admin
        .from("rental_asset_kpis")
        .select("period_year, period_month, fixed_asset_id, reporting_group, fleet_days, rental_act_days, rental_dbr_days, total_revenue")
        .eq("organization_id", orgId)
        .eq("grain", "asset")
        .in("fixed_asset_id", assetIds.slice(i, i + CH))
        .in("period_year", years)
        .range(o, o + l - 1),
    );
    rows.push(...chunk);
  }
  const inWindow = new Set(window.map((w) => `${w.y}-${w.m}`));
  const groups = new Map<string, GroupStats>();
  const latestGroupByAsset = new Map<string, string>();
  for (const r of rows) {
    if (!r.fixed_asset_id || !inWindow.has(`${r.period_year}-${r.period_month}`)) continue;
    const asset = assetById.get(r.fixed_asset_id);
    if (!asset) continue;
    const group = r.reporting_group ?? "Unassigned";
    latestGroupByAsset.set(r.fixed_asset_id, group);
    const g = groups.get(group) ?? {
      group,
      trailer: asset.master_type_override ? asset.master_type_override.toLowerCase() === "trailer" : /trailer/i.test(group),
      entityIds: new Set<string>(),
      fleetDays: zeros(),
      rentalDays: zeros(),
      revenue: zeros(),
      unitsNow: 0,
    };
    g.entityIds.add(asset.entity_id);
    const idx = r.period_month - 1;
    g.fleetDays[idx] += Number(r.fleet_days ?? 0);
    g.rentalDays[idx] += Number(r.rental_act_days ?? r.rental_dbr_days ?? 0);
    g.revenue[idx] += Number(r.total_revenue ?? 0);
    groups.set(group, g);
  }
  // Units in service now per group = active assets whose latest KPI group is this one
  for (const a of assets) {
    if (a.status !== "active") continue;
    const group = latestGroupByAsset.get(a.id);
    if (!group) continue;
    groups.get(group)!.unitsNow++;
  }

  // Fleet deltas from the capex plan
  const plan = await loadCapexPlan(ctx);
  const defaultsFor = await loadDepreciationDefaults(ctx);
  const capex = computeCapexMonthly(ctx.year, plan.items, plan.disposals, defaultsFor);

  const vehicleMaster = ctx.masterByNumber.get(VEHICLE_REVENUE_NUMBER)?.id;
  const trailerMaster = ctx.masterByNumber.get(TRAILER_REVENUE_NUMBER)?.id;
  const reScope = [{ scope: "reporting_entity", scopeId: ctx.owner.reportingEntityId }];

  for (const g of groups.values()) {
    const totalRentalDays = g.rentalDays.reduce((t, v) => t + v, 0);
    const totalFleetDays = g.fleetDays.reduce((t, v) => t + v, 0);
    const totalRevenue = g.revenue.reduce((t, v) => t + v, 0);
    if (totalFleetDays <= 0 || totalRevenue <= 0) continue;
    const revPerRentalDay = totalRentalDays > 0 ? totalRevenue / totalRentalDays : 0;
    const avgUtil = totalRentalDays / totalFleetDays;
    const utilPts = ctx.assumptions.get("utilization_change_pts", [{ scope: "asset_group", scopeId: g.group }, ...reScope]) / 100;
    const ratePct = ctx.assumptions.get("day_rate_change_pct", [{ scope: "asset_group", scopeId: g.group }, ...reScope]) / 100;
    const values = zeros();
    const utilByMonth: number[] = [];
    for (let i = 0; i < 12; i++) {
      const util = g.fleetDays[i] > 0 ? g.rentalDays[i] / g.fleetDays[i] : avgUtil;
      const u = Math.max(0, Math.min(1, util + utilPts));
      utilByMonth.push(Math.round(u * 10000) / 100);
      const units = Math.max(0, g.unitsNow + (capex.fleetDelta[g.group]?.[i] ?? 0));
      values[i] = units * daysIn(ctx.year, i + 1) * u * revPerRentalDay * (1 + ratePct);
    }
    if (isAllZero(values)) continue;
    const master = g.trailer ? trailerMaster : vehicleMaster;
    if (!master) continue;
    out.push(
      baseBuild(ctx, {
        master_account_id: master,
        qbo_class_id: null,
        build_type: "driver",
        source_table: "rental_asset_kpis",
        source_id: g.group,
        component: "fleet_revenue",
        label: `${g.group}: ${g.unitsNow} units × utilization × ${Math.round(revPerRentalDay)}/day`,
        amounts: amountsFromArray(values),
        assumption_keys: ["utilization_change_pts", "day_rate_change_pct"],
        meta: {
          unitsNow: g.unitsNow,
          fleetDeltaByMonth: capex.fleetDelta[g.group] ?? null,
          trailingRevenue: Math.round(totalRevenue),
          trailingUtilizationPct: Math.round(avgUtil * 10000) / 100,
          revenuePerRentalDay: Math.round(revPerRentalDay * 100) / 100,
          utilizationByMonthPct: utilByMonth,
          window: `${window[0].y}-${window[0].m} to ${endY}-${endM}`,
          entityIds: [...g.entityIds],
        },
      }),
    );
  }
  return out;
}
