/**
 * Trend builds: for masters with no other build, the trailing run rate
 * shaped by the seasonality of three years of actuals, times growth (revenue)
 * or inflation (expense). The volatility band is stored on the build.
 */
import { loadMonthlyActuals, monthKey, rollupActualsToParents, type MasterInfo } from "./actuals";
import { amountsFromArray, baseBuild, isAllZero, type BuildContext, type BuildInsert } from "./build-types";

export interface TrendStats {
  masterId: string;
  trailing12: number;
  trailing3Annualized: number;
  monthsWithData: number;
  seasonality: number[]; // 12 factors averaging 1
  stdDevMonthly: number;
  meanMonthly: number;
}

/** Seasonality index and volatility from a monthly series keyed "YYYY-M". */
export function trendStats(masterId: string, series: Map<string, number>, months: Array<{ year: number; month: number }>): TrendStats {
  const values = months.map((m) => series.get(monthKey(m.year, m.month)));
  const present = values.map((v, i) => ({ v, i })).filter((x) => x.v !== undefined) as Array<{ v: number; i: number }>;
  const n = present.length;
  const last12 = values.slice(-12).map((v) => v ?? 0);
  const last3 = values.slice(-3).map((v) => v ?? 0);
  const trailing12 = last12.reduce((t, v) => t + v, 0);
  const trailing3Annualized = (last3.reduce((t, v) => t + v, 0) / 3) * 12;
  const mean = n > 0 ? present.reduce((t, x) => t + x.v, 0) / n : 0;
  const variance = n > 1 ? present.reduce((t, x) => t + (x.v - mean) ** 2, 0) / (n - 1) : 0;

  // Seasonality: average by calendar month over available years, normalized
  const byMonth: number[][] = Array.from({ length: 12 }, () => []);
  for (const x of present) byMonth[months[x.i].month - 1].push(x.v);
  const monthMeans = byMonth.map((arr) => (arr.length ? arr.reduce((t, v) => t + v, 0) / arr.length : NaN));
  const valid = monthMeans.filter((v) => !Number.isNaN(v));
  const overall = valid.length ? valid.reduce((t, v) => t + v, 0) / valid.length : 0;
  const seasonality = monthMeans.map((v) => (Number.isNaN(v) || overall === 0 ? 1 : v / overall));
  // Guard against negative or wild factors from noisy accounts
  const bounded = seasonality.map((f) => Math.max(0.25, Math.min(3, f)));
  const avg = bounded.reduce((t, v) => t + v, 0) / 12;
  return {
    masterId,
    trailing12,
    trailing3Annualized,
    monthsWithData: n,
    seasonality: bounded.map((f) => f / avg),
    stdDevMonthly: Math.sqrt(variance),
    meanMonthly: mean,
  };
}

export async function trendBuilds(
  ctx: BuildContext,
  opts: { excludeMasterIds: Set<string>; onlyMasterIds?: Set<string> },
): Promise<BuildInsert[]> {
  const out: BuildInsert[] = [];
  const endYear = ctx.year - 1;
  const actuals = await loadMonthlyActuals(ctx.admin, {
    chartId: ctx.chartId,
    entityIds: ctx.memberEntityIds,
    startYear: ctx.year - 3,
    startMonth: 1,
    endYear,
    endMonth: 12,
    masters: ctx.masters,
  });
  const months = actuals.monthsRequested;
  const byMaster = actuals.byMaster;
  const reScope = [{ scope: "reporting_entity", scopeId: ctx.owner.reportingEntityId }];
  const growth = ctx.assumptions.get("revenue_growth_pct", reScope) / 100;
  const inflation = ctx.assumptions.get("inflation_pct", reScope) / 100;

  const plMasters: MasterInfo[] = ctx.masters.filter((m) => (m.classification === "Revenue" || m.classification === "Expense") && !m.parentAccountId);
  // Children roll into parents for the trend of a parent line that has no builds
  rollupActualsToParents(byMaster, ctx.masters);

  for (const master of plMasters) {
    if (opts.excludeMasterIds.has(master.id)) continue;
    if (opts.onlyMasterIds && !opts.onlyMasterIds.has(master.id)) continue;
    const series = byMaster.get(master.id);
    if (!series || series.size === 0) continue;
    const stats = trendStats(master.id, series, months);
    // Base = trailing twelve months when we have them, else annualized last three
    const hasFullYear = months.slice(-12).every((m) => series.has(monthKey(m.year, m.month)));
    const base = hasFullYear ? stats.trailing12 : stats.trailing3Annualized;
    if (!base) continue;
    const factor = master.classification === "Revenue" ? 1 + growth : 1 + inflation;
    const values = stats.seasonality.map((s) => (base / 12) * s * factor);
    if (isAllZero(values)) continue;
    out.push(
      baseBuild(ctx, {
        master_account_id: master.id,
        qbo_class_id: null,
        build_type: "trend",
        source_table: "gl_balances",
        source_id: master.id,
        component: "trend",
        label: `${master.name}: trailing ${hasFullYear ? "twelve months" : "three months annualized"} × seasonality × ${master.classification === "Revenue" ? "growth" : "inflation"}`,
        amounts: amountsFromArray(values),
        assumption_keys: [master.classification === "Revenue" ? "revenue_growth_pct" : "inflation_pct"],
        meta: {
          base: Math.round(base),
          basis: hasFullYear ? "trailing_12" : "trailing_3_annualized",
          trailing12: Math.round(stats.trailing12),
          trailing3Annualized: Math.round(stats.trailing3Annualized),
          monthsWithData: stats.monthsWithData,
          seasonality: stats.seasonality.map((s) => Math.round(s * 1000) / 1000),
          meanMonthly: Math.round(stats.meanMonthly),
          stdDevMonthly: Math.round(stats.stdDevMonthly),
          factor,
        },
      }),
    );
  }
  return out;
}
