/**
 * Method items on the server: the named items under a master line whose
 * amounts come from a LineMethod (see line-methods.ts). They are stored as
 * manual builds with `meta.method`, so the line is their sum like any other
 * build, and a recompute re-evaluates them against fresh actuals and the
 * other lines they follow.
 *
 * "Break out by account" seeds a bucketed master (Other Expenses, Parts &
 * Supplies) with one run-rate item per entity account that fed it last
 * year, so the reasons behind the number are on the page from the start.
 */
import { loadMonthlyActuals, monthKey, rollupActualsToParents } from "./actuals";
import { trendStats } from "./trend-builds";
import { evaluateMethod, readMethod, type LineMethod, type MethodHistory } from "./line-methods";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { amountsFromArray, type Admin, type BuildContext, type BuildInsert } from "./build-types";

const NIL_CLASS = "00000000-0000-0000-0000-000000000000";

interface HistoryBank {
  forMaster(masterId: string): MethodHistory;
  forAccounts(accountIds: string[]): MethodHistory;
  /** Account ids with any activity in the last three years, by master */
  accountsOfMaster(masterId: string): string[];
  priorYearTotal(series: Map<string, number>): number;
  seriesOfAccount(accountId: string): Map<string, number> | undefined;
}

/** Three years of actuals for the version's entities, by master (rolled to parents) and by account. */
export async function loadHistoryBank(ctx: BuildContext): Promise<HistoryBank> {
  const actuals = await loadMonthlyActuals(ctx.admin, {
    chartId: ctx.chartId,
    entityIds: ctx.memberEntityIds,
    startYear: ctx.year - 3,
    startMonth: 1,
    endYear: ctx.year - 1,
    endMonth: 12,
    masters: ctx.masters,
  });
  const months = actuals.monthsRequested;
  const byMaster = rollupActualsToParents(actuals.byMaster, ctx.masters);
  const parentOf = new Map(ctx.masters.filter((m) => m.parentAccountId).map((m) => [m.id, m.parentAccountId!]));
  const accountsByMaster = new Map<string, string[]>();
  for (const [accountId, masterId] of actuals.accountToMaster) {
    if (!actuals.byAccount.has(accountId)) continue;
    const top = parentOf.get(masterId) ?? masterId;
    accountsByMaster.set(top, [...(accountsByMaster.get(top) ?? []), accountId]);
  }
  const empty = new Map<string, number>();
  const history = (series: Map<string, number>): MethodHistory => {
    const stats = trendStats("", series, months);
    const last12 = months.slice(-12);
    return {
      priorYear: Array.from({ length: 12 }, (_, i) => Math.round((series.get(monthKey(ctx.year - 1, i + 1)) ?? 0) * 100) / 100),
      trailing12: stats.trailing12,
      trailing3Annualized: stats.trailing3Annualized,
      seasonality: stats.seasonality,
      hasFullYear: last12.every((m) => series.has(monthKey(m.year, m.month))),
    };
  };
  const sumSeries = (ids: string[]): Map<string, number> => {
    const out = new Map<string, number>();
    for (const id of ids) {
      const s = actuals.byAccount.get(id);
      if (!s) continue;
      for (const [k, v] of s) out.set(k, (out.get(k) ?? 0) + v);
    }
    return out;
  };
  return {
    forMaster: (id) => history(byMaster.get(id) ?? empty),
    forAccounts: (ids) => history(sumSeries(ids)),
    accountsOfMaster: (id) => accountsByMaster.get(id) ?? [],
    priorYearTotal: (series) => Array.from({ length: 12 }, (_, i) => series.get(monthKey(ctx.year - 1, i + 1)) ?? 0).reduce((t, v) => t + v, 0),
    seriesOfAccount: (id) => actuals.byAccount.get(id),
  };
}

interface StoredBuild {
  id: string;
  master_account_id: string;
  build_type: string;
  amounts: Record<string, number> | null;
  meta: Record<string, unknown> | null;
}

/**
 * Re-evaluates every method item on the version. Items that follow another
 * line read that line as the sum of its other builds, so they never chase
 * themselves.
 */
export async function recomputeMethodBuilds(ctx: BuildContext, bank?: HistoryBank): Promise<{ items: number }> {
  const admin = ctx.admin;
  const builds = await fetchAllPaginated<StoredBuild>((o, l) =>
    admin.from("budget_builds").select("id, master_account_id, build_type, amounts, meta").eq("budget_version_id", ctx.owner.id).range(o, o + l - 1),
  );
  const items = builds
    .map((b) => ({ b, method: b.build_type === "manual" ? readMethod(b.meta?.method) : null }))
    .filter((x): x is { b: StoredBuild; method: LineMethod } => !!x.method);
  if (items.length === 0) return { items: 0 };
  const history = bank ?? (await loadHistoryBank(ctx));

  // Line totals for pct_of_line: everything except the following items themselves, rolled to parents
  const parentOf = new Map(ctx.masters.filter((m) => m.parentAccountId).map((m) => [m.id, m.parentAccountId!]));
  const followers = new Set(items.filter((x) => x.method.kind === "pct_of_line").map((x) => x.b.id));
  const lineTotals = new Map<string, number[]>();
  for (const b of builds) {
    if (followers.has(b.id)) continue;
    const top = parentOf.get(b.master_account_id) ?? b.master_account_id;
    const s = lineTotals.get(top) ?? new Array(12).fill(0);
    for (let m = 1; m <= 12; m++) s[m - 1] += Number(b.amounts?.[String(m)] ?? 0);
    lineTotals.set(top, s);
  }

  const now = new Date().toISOString();
  let n = 0;
  for (const { b, method } of items) {
    const h = method.account_ids?.length ? history.forAccounts(method.account_ids) : history.forMaster(parentOf.get(b.master_account_id) ?? b.master_account_id);
    const values = evaluateMethod(method, { history: h, lineTotals });
    const { error } = await admin
      .from("budget_builds")
      .update({
        amounts: amountsFromArray(values),
        computed_at: now,
        meta: {
          ...(b.meta ?? {}),
          method,
          history: { priorYear: Math.round(h.priorYear.reduce((t, v) => t + v, 0)), trailing12: Math.round(h.trailing12), trailing3Annualized: Math.round(h.trailing3Annualized), hasFullYear: h.hasFullYear },
        },
      })
      .eq("id", b.id);
    if (error) throw new Error(`Could not update item ${b.id}: ${error.message}`);
    n++;
  }
  return { items: n };
}

/** A master's trend build gives way once it has items of its own. */
export async function clearTrendForMaster(admin: Admin, versionId: string, masterId: string): Promise<void> {
  const { error } = await admin.from("budget_builds").delete().eq("budget_version_id", versionId).eq("build_type", "trend").eq("master_account_id", masterId);
  if (error) throw new Error(`Could not clear the run-rate build: ${error.message}`);
}

/** The manual build row for a method item. */
export function methodBuild(ctx: BuildContext, masterId: string, label: string, method: LineMethod, note: string | null, extraMeta?: Record<string, unknown>): BuildInsert & { note: string | null } {
  return {
    budget_version_id: ctx.owner.id,
    reporting_entity_id: ctx.owner.reportingEntityId,
    entity_id: ctx.owner.entityId,
    master_account_id: masterId,
    qbo_class_id: null,
    build_type: "manual",
    source_table: null,
    source_id: null,
    component: "method",
    label,
    amounts: amountsFromArray(new Array(12).fill(0)),
    assumption_keys: [],
    is_computed: true,
    meta: { method, ...(extraMeta ?? {}) },
    computed_at: ctx.now,
    note,
  };
}

/**
 * Seeds a master with one run-rate item per entity account that fed it last
 * year (same-named accounts across the group's entities share an item), the
 * small ones together as "Other accounts". Replaces an earlier breakout and
 * the master's trend build.
 */
export async function breakoutMaster(
  ctx: BuildContext,
  masterId: string,
  opts: { top?: number; minAnnual?: number } = {},
): Promise<{ items: number; accounts: number }> {
  const admin = ctx.admin;
  const master = ctx.masters.find((m) => m.id === masterId);
  if (!master) throw new Error("Master account not found on this chart");
  const bank = await loadHistoryBank(ctx);
  const accountIds = bank.accountsOfMaster(masterId);
  const { data: accounts } = accountIds.length
    ? await admin.from("accounts").select("id, name, account_number, entity_id").in("id", accountIds)
    : { data: [] as Array<{ id: string; name: string; account_number: string | null; entity_id: string }> };

  // Group by name across entities, ranked by last year's spend
  const groups = new Map<string, { name: string; ids: string[]; priorYear: number }>();
  for (const a of accounts ?? []) {
    const series = bank.seriesOfAccount(a.id);
    if (!series) continue;
    const key = a.name.trim().toLowerCase();
    const g = groups.get(key) ?? { name: a.name.trim(), ids: [] as string[], priorYear: 0 };
    g.ids.push(a.id);
    g.priorYear += bank.priorYearTotal(series);
    groups.set(key, g);
  }
  const ranked = [...groups.values()].filter((g) => Math.abs(g.priorYear) >= 0.5).sort((a, b) => Math.abs(b.priorYear) - Math.abs(a.priorYear));
  const top = Math.max(1, opts.top ?? 12);
  const minAnnual = opts.minAnnual ?? 1000;
  const keep = ranked.filter((g, i) => i < top && Math.abs(g.priorYear) >= minAnnual);
  const rest = ranked.filter((g) => !keep.includes(g));

  const reScope = [{ scope: "reporting_entity", scopeId: ctx.owner.reportingEntityId }];
  const pct = master.classification === "Revenue" ? ctx.assumptions.get("revenue_growth_pct", reScope) : ctx.assumptions.get("inflation_pct", reScope);
  const rows: Array<BuildInsert & { note: string | null }> = [];
  for (const g of keep) {
    rows.push(methodBuild(ctx, masterId, g.name, { kind: "run_rate", pct, account_ids: g.ids }, null, { breakout: true }));
  }
  if (rest.length > 0) {
    const ids = rest.flatMap((g) => g.ids);
    rows.push(methodBuild(ctx, masterId, `Other accounts (${rest.length})`, { kind: "run_rate", pct, account_ids: ids }, rest.map((g) => g.name).join(", "), { breakout: true }));
  }

  // Replace an earlier breakout and the trend build; leave hand-made items alone
  const existing = await fetchAllPaginated<{ id: string; build_type: string; meta: Record<string, unknown> | null }>((o, l) =>
    admin.from("budget_builds").select("id, build_type, meta").eq("budget_version_id", ctx.owner.id).eq("master_account_id", masterId).range(o, o + l - 1),
  );
  const drop = existing.filter((b) => b.build_type === "trend" || (b.build_type === "manual" && b.meta?.breakout === true)).map((b) => b.id);
  if (drop.length) {
    const { error } = await admin.from("budget_builds").delete().in("id", drop);
    if (error) throw new Error(`Could not clear the earlier breakout: ${error.message}`);
  }
  if (rows.length) {
    const { error } = await admin.from("budget_builds").insert(rows);
    if (error) throw new Error(`Could not write the breakout: ${error.message}`);
  }
  await recomputeMethodBuilds(ctx, bank);
  return { items: rows.length, accounts: keep.reduce((t, g) => t + g.ids.length, 0) + rest.reduce((t, g) => t + g.ids.length, 0) };
}

export { NIL_CLASS };
