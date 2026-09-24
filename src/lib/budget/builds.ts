/**
 * Orchestrates every computed build for a version and syncs the lines.
 * Manual builds are never touched by a recompute.
 */
import type { VersionOwner } from "./access";
import { loadMasters } from "./actuals";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { loadAssumptions, loadMemberEntityIds, recomputePersonnel, resolveVersionChartId, syncLinesFromBuilds } from "./recompute";
import { allocationBuilds, debtBuilds, depreciationBuilds, insuranceBuilds, leaseBuilds } from "./schedule-builds";
import { fleetRevenueBuilds } from "./driver-builds";
import { trendBuilds } from "./trend-builds";
import { recomputeMethodBuilds } from "./method-builds";
import type { Admin, BuildContext, BuildInsert, BuildType } from "./build-types";

export type RecomputeScope = "personnel" | "schedules" | "drivers" | "trend" | "methods" | "all";

export interface RecomputeSummary {
  scope: RecomputeScope;
  personnel?: { positions: number; buildsWritten: number; missingSubMasters: string[] };
  schedules?: { debt: number; leases: number; depreciation: number; insurance: number; allocations: number };
  drivers?: { fleetRevenue: number };
  trend?: { builds: number; skippedMasters: number };
  methods?: { items: number };
  lines: { linesUpserted: number; linesDeleted: number };
  warnings: string[];
}

export async function buildContext(admin: Admin, owner: VersionOwner): Promise<BuildContext> {
  const [assumptions, memberSet, chartId] = await Promise.all([
    loadAssumptions(admin, owner.id),
    loadMemberEntityIds(admin, owner),
    resolveVersionChartId(admin, owner),
  ]);
  const memberEntityIds = [...memberSet];
  const masters = await loadMasters(admin, chartId);
  const mappings = memberEntityIds.length
    ? await fetchAllPaginated<{ master_account_id: string; account_id: string }>((o, l) =>
        admin
          .from("master_account_mappings")
          .select("master_account_id, account_id")
          .eq("chart_id", chartId)
          .in("entity_id", memberEntityIds)
          .range(o, o + l - 1),
      )
    : [];
  const accountToMaster = new Map(mappings.map((m) => [m.account_id, m.master_account_id]));
  const masterByNumber = new Map(masters.filter((m) => m.accountNumber).map((m) => [m.accountNumber!, m]));
  return {
    admin,
    owner,
    year: owner.fiscalYear,
    chartId,
    memberEntityIds,
    assumptions,
    masters,
    accountToMaster,
    masterByNumber,
    now: new Date().toISOString(),
  };
}

async function replaceBuilds(admin: Admin, versionId: string, types: BuildType[], builds: BuildInsert[]): Promise<void> {
  const { error: delErr } = await admin.from("budget_builds").delete().eq("budget_version_id", versionId).in("build_type", types);
  if (delErr) throw new Error(`Could not clear ${types.join("/")} builds: ${delErr.message}`);
  for (let i = 0; i < builds.length; i += 500) {
    const { error } = await admin.from("budget_builds").insert(builds.slice(i, i + 500));
    if (error) throw new Error(`Could not write ${types.join("/")} builds: ${error.message}`);
  }
}

export async function recomputeVersion(admin: Admin, owner: VersionOwner, scope: RecomputeScope): Promise<RecomputeSummary> {
  const summary: RecomputeSummary = { scope, lines: { linesUpserted: 0, linesDeleted: 0 }, warnings: [] };
  const ctx = await buildContext(admin, owner);

  if (scope === "personnel" || scope === "all") {
    const p = await recomputePersonnel(admin, owner);
    summary.personnel = { positions: p.positions.length, buildsWritten: p.buildsWritten, missingSubMasters: p.missingSubMasters };
    if (p.missingSubMasters.length) summary.warnings.push(`Personnel sub-masters missing: ${p.missingSubMasters.join(", ")}`);
  }

  if (scope === "schedules" || scope === "all") {
    const [debt, leases, depreciation, insurance, allocations] = await Promise.all([
      debtBuilds(ctx).catch((e) => { summary.warnings.push(`Debt: ${e.message}`); return []; }),
      leaseBuilds(ctx).catch((e) => { summary.warnings.push(`Leases: ${e.message}`); return []; }),
      depreciationBuilds(ctx).catch((e) => { summary.warnings.push(`Depreciation: ${e.message}`); return []; }),
      insuranceBuilds(ctx).catch((e) => { summary.warnings.push(`Insurance: ${e.message}`); return []; }),
      allocationBuilds(ctx).catch((e) => { summary.warnings.push(`Allocations: ${e.message}`); return []; }),
    ]);
    await replaceBuilds(admin, owner.id, ["schedule", "capex"], [...debt, ...leases, ...depreciation, ...insurance, ...allocations]);
    summary.schedules = { debt: debt.length, leases: leases.length, depreciation: depreciation.length, insurance: insurance.length, allocations: allocations.length };
  }

  if (scope === "drivers" || scope === "all") {
    const fleet = await fleetRevenueBuilds(ctx).catch((e) => { summary.warnings.push(`Fleet revenue: ${e.message}`); return []; });
    await replaceBuilds(admin, owner.id, ["driver"], fleet);
    summary.drivers = { fleetRevenue: fleet.length };
  }

  if (scope === "trend" || scope === "all") {
    // Masters already covered by any other build type keep their builds
    const covered = await fetchAllPaginated<{ master_account_id: string }>((o, l) =>
      admin
        .from("budget_builds")
        .select("master_account_id")
        .eq("budget_version_id", owner.id)
        .neq("build_type", "trend")
        .range(o, o + l - 1),
    );
    const parentOf = new Map(ctx.masters.filter((m) => m.parentAccountId).map((m) => [m.id, m.parentAccountId!]));
    const excluded = new Set<string>();
    for (const c of covered) {
      excluded.add(c.master_account_id);
      const parent = parentOf.get(c.master_account_id);
      if (parent) excluded.add(parent);
    }
    const trend = await trendBuilds(ctx, { excludeMasterIds: excluded }).catch((e) => { summary.warnings.push(`Trend: ${e.message}`); return []; });
    await replaceBuilds(admin, owner.id, ["trend"], trend);
    summary.trend = { builds: trend.length, skippedMasters: excluded.size };
  }

  if (scope === "methods" || scope === "all") {
    // Method items last: the ones that follow another line need the others in place
    summary.methods = await recomputeMethodBuilds(ctx).catch((e) => {
      summary.warnings.push(`Items: ${e.message}`);
      return { items: 0 };
    });
  }

  summary.lines = await syncLinesFromBuilds(admin, owner);
  return summary;
}
