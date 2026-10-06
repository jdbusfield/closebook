/**
 * Last year's actuals as the Financial Model shows them: the reporting group's income
 * statement with pro forma adjustments and allocations on, by master, by month.
 * JD budgets against those figures (not the raw GL), so the budget model's "last year"
 * columns, averages and "Build from last year" bases read from here.
 */
import type { VersionOwner } from "./access";
import type { Admin } from "./build-types";
import { loadMemberEntityIds, resolveVersionChartId } from "./recompute";
import { getPeriodsInRange } from "@/lib/utils/dates";
import { buildConsolidatedStatements, collectAllMonths } from "@/lib/financial-statements/statements-engine";

interface StatementLine {
  amounts: Record<string, number>;
  drillDownMeta?: { type: string; masterAccountIds?: string[] };
}

// The statements take seconds to build; a budget page reloads often, so keep a group's year
// briefly in this server instance (short, so pro forma or allocation edits show up quickly)
const TTL_MS = 2 * 60 * 1000;
const BUILD_LIMIT_MS = 25_000;
const cache = new Map<string, { at: number; value: Record<string, number[]> }>();

/** Master id -> twelve months (January first), or null when the version has no reporting group */
export async function loadFinancialModelYear(admin: Admin, owner: VersionOwner, year: number): Promise<Record<string, number[]> | null> {
  if (!owner.reportingEntityId || !owner.organizationId) return null;
  const [members, chartId] = await Promise.all([loadMemberEntityIds(admin, owner), resolveVersionChartId(admin, owner)]);
  const key = `${owner.reportingEntityId}|${chartId}|${year}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const entityIds = [...members];
  if (!entityIds.length) return null;
  const { data: ent } = await admin.from("entities").select("fiscal_year_end_month").in("id", entityIds).limit(1);
  const fyEnd = Number((ent ?? [])[0]?.fiscal_year_end_month ?? 12);

  const buckets = getPeriodsInRange(year, 1, year, 12, "monthly");
  // Never let a slow build take the page down: past the limit the caller falls back to the GL
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Financial Model build exceeded ${BUILD_LIMIT_MS / 1000}s`)), BUILD_LIMIT_MS);
  });
  const build = buildConsolidatedStatements({
    admin,
    organizationId: owner.organizationId,
    chartId,
    entityIds,
    reportingEntityId: owner.reportingEntityId,
    buckets,
    allMonths: collectAllMonths(buckets, false),
    includeYoY: false,
    includeBudget: false,
    includeProForma: true,
    includeAllocations: true,
    includeFixedAssetSchedule: true,
    granularity: "monthly",
    scope: "reporting_entity",
    startYear: year,
    startMonth: 1,
    endYear: year,
    endMonth: 12,
    fiscalYearStartMonth: (fyEnd % 12) + 1,
  });
  // A build that loses the race still lands in the cache, so the next load is quick; a late
  // failure must not surface as an unhandled rejection
  build.then((r) => cache.set(key, { at: Date.now(), value: byMaster(r, buckets) })).catch(() => undefined);
  const result = await Promise.race([build, timeout]).finally(() => clearTimeout(timer));
  const out = byMaster(result, buckets);
  cache.set(key, { at: Date.now(), value: out });
  return out;
}

/** Income-statement lines that are one master each, by month */
function byMaster(result: Awaited<ReturnType<typeof buildConsolidatedStatements>>, buckets: Array<{ key: string }>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const section of result.incomeStatement.sections as Array<{ lines: StatementLine[] }>) {
    for (const line of section.lines) {
      const id = line.drillDownMeta?.type === "account" ? line.drillDownMeta.masterAccountIds?.[0] : undefined;
      if (!id) continue;
      out[id] = buckets.map((b) => Math.round((line.amounts[b.key] ?? 0) * 100) / 100);
    }
  }
  return out;
}
