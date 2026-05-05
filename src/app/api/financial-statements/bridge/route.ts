// POST /api/financial-statements/bridge
// Returns a side-by-side reconciliation between the accountant-prepared and
// management-prepared financial statements with named bridge categories.
//
// v1 scope: Balance Sheet + P&L, consolidated org scope, single-period or
// multi-period (granularity is honoured as-is). Tier 1 (line-level) only;
// tier-2/3 drill-down is computed on demand by a future endpoint.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveChart } from "@/lib/master-charts/resolve";
import { getPeriodsInRange } from "@/lib/utils/dates";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import {
  computeBridge,
  type ChartContext,
  type MasterAccountRow,
  type ProFormaRow,
  type AllocationEntryRow,
  type YearAdjRow,
  type PeriodBucketLite,
} from "@/lib/financial-statements/bridge-engine";
import type {
  BridgeRequest,
  BridgeResponse,
} from "@/lib/financial-statements/bridge-types";
import type { FinancialStatementsResponse } from "@/components/financial-statements/types";

interface RawAllocRow {
  source_entity_id: string;
  destination_entity_id: string;
  master_account_id: string;
  destination_master_account_id: string | null;
  amount: number;
  schedule_type: "single_month" | "monthly_spread";
  period_year: number | null;
  period_month: number | null;
  start_year: number | null;
  start_month: number | null;
  end_year: number | null;
  end_month: number | null;
  is_repeating: boolean;
  repeat_end_year: number | null;
  repeat_end_month: number | null;
}

/**
 * Expand allocation_adjustments into per-master-account, per-month line-level
 * impact entries, ignoring entity_id (the bridge is consolidated org-scope).
 *
 * Mirrors expandAllocationAdjustments() in route.ts.
 */
function expandAllocationsForBridge(rows: RawAllocRow[]): AllocationEntryRow[] {
  const out: AllocationEntryRow[] = [];

  function pushPair(a: RawAllocRow, year: number, month: number, amt: number): void {
    // Intra-entity reclass — move between master accounts (both impacts visible)
    if (a.destination_master_account_id) {
      out.push({
        master_account_id: a.master_account_id,
        amount: -amt,
        period_year: year,
        period_month: month,
      });
      out.push({
        master_account_id: a.destination_master_account_id,
        amount: amt,
        period_year: year,
        period_month: month,
      });
    } else {
      // Inter-entity — same master account, net zero at consolidated org level
      // but each entity contributes; for line-level bridge the entries cancel.
      out.push({
        master_account_id: a.master_account_id,
        amount: -amt,
        period_year: year,
        period_month: month,
      });
      out.push({
        master_account_id: a.master_account_id,
        amount: amt,
        period_year: year,
        period_month: month,
      });
    }
  }

  for (const a of rows) {
    const totalAmount = Number(a.amount);
    if (a.schedule_type === "single_month") {
      if (a.period_year == null || a.period_month == null) continue;
      if (a.is_repeating && a.repeat_end_year != null && a.repeat_end_month != null) {
        const totalMonths =
          (a.repeat_end_year - a.period_year) * 12 +
          (a.repeat_end_month - a.period_month) + 1;
        if (totalMonths < 1) continue;
        let y = a.period_year;
        let m = a.period_month;
        for (let i = 0; i < totalMonths; i++) {
          pushPair(a, y, m, totalAmount);
          m++;
          if (m > 12) { m = 1; y++; }
        }
      } else {
        pushPair(a, a.period_year, a.period_month, totalAmount);
      }
    } else if (a.schedule_type === "monthly_spread") {
      if (
        a.start_year == null || a.start_month == null ||
        a.end_year == null || a.end_month == null
      ) continue;
      const totalMonths =
        (a.end_year - a.start_year) * 12 +
        (a.end_month - a.start_month) + 1;
      if (totalMonths < 1) continue;
      const monthlyAmount = totalAmount / totalMonths;
      let y = a.start_year;
      let m = a.start_month;
      for (let i = 0; i < totalMonths; i++) {
        pushPair(a, y, m, monthlyAmount);
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
  }

  return out;
}

async function fetchStatementsForChart(args: {
  cookieHeader: string | null;
  origin: string;
  organizationId: string;
  chartId: string;
  isAccountantChart: boolean;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  granularity: "monthly" | "quarterly" | "yearly";
}): Promise<FinancialStatementsResponse> {
  const params = new URLSearchParams({
    scope: "organization",
    organizationId: args.organizationId,
    chartId: args.chartId,
    startYear: String(args.startYear),
    startMonth: String(args.startMonth),
    endYear: String(args.endYear),
    endMonth: String(args.endMonth),
    granularity: args.granularity,
    includeBudget: "false",
    includeYoY: "false",
    // Pro forma & allocations are management-only by current convention.
    // The accountant view auto-disables them; the management view honours
    // them for the user's saved preference. For the bridge we always run
    // the management chart with both ON so the bridge surfaces them.
    includeProForma: args.isAccountantChart ? "false" : "true",
    includeAllocations: args.isAccountantChart ? "false" : "true",
    includeTotal: "false",
  });
  const url = `${args.origin}/api/financial-statements?${params.toString()}`;
  const res = await fetch(url, {
    headers: args.cookieHeader ? { cookie: args.cookieHeader } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch ${args.isAccountantChart ? "accountant" : "management"} statements: ${res.status} ${text}`);
  }
  return res.json();
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BridgeRequest;
  try {
    body = (await request.json()) as BridgeRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.organizationId || !body.statement || !body.direction) {
    return NextResponse.json(
      { error: "organizationId, statement, and direction are required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Resolve both charts (accountant + management) for the org.
  let mgmtChart, accChart;
  try {
    [mgmtChart, accChart] = await Promise.all([
      resolveChart(admin, body.organizationId, "management"),
      resolveChart(admin, body.organizationId, "accountant"),
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: `Both management and accountant charts must exist: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", body.organizationId)
    .single();

  // Build origin URL for internal fetches (Vercel sets x-forwarded-host etc.)
  const url = new URL(request.url);
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const origin = `${proto}://${host}`;
  const cookieHeader = request.headers.get("cookie");

  // Fetch full statements + master accounts + adjustments for both charts in parallel.
  // Note: Supabase typings don't always know about every table; cast through `any`
  // for the dynamic-table queries to mirror the convention in the main route.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = admin as any;
  const [
    mgmtFS,
    accFS,
    mgmtMasters,
    accMasters,
    proFormaRows,
    allocRows,
    yearEndRows,
  ] = await Promise.all([
    fetchStatementsForChart({
      cookieHeader,
      origin,
      organizationId: body.organizationId,
      chartId: mgmtChart.id,
      isAccountantChart: false,
      startYear: body.startYear,
      startMonth: body.startMonth,
      endYear: body.endYear,
      endMonth: body.endMonth,
      granularity: body.granularity,
    }),
    fetchStatementsForChart({
      cookieHeader,
      origin,
      organizationId: body.organizationId,
      chartId: accChart.id,
      isAccountantChart: true,
      startYear: body.startYear,
      startMonth: body.startMonth,
      endYear: body.endYear,
      endMonth: body.endMonth,
      granularity: body.granularity,
    }),
    fetchAllPaginated<MasterAccountRow>((offset, limit) =>
      a
        .from("master_accounts")
        .select("id, name, classification, account_type, account_number, parent_account_id, is_intercompany")
        .eq("organization_id", body.organizationId)
        .eq("chart_id", mgmtChart.id)
        .eq("is_active", true)
        .range(offset, offset + limit - 1),
    ),
    fetchAllPaginated<MasterAccountRow>((offset, limit) =>
      a
        .from("master_accounts")
        .select("id, name, classification, account_type, account_number, parent_account_id, is_intercompany")
        .eq("organization_id", body.organizationId)
        .eq("chart_id", accChart.id)
        .eq("is_active", true)
        .range(offset, offset + limit - 1),
    ),
    fetchAllPaginated<ProFormaRow>((offset, limit) =>
      a
        .from("pro_forma_adjustments")
        .select("master_account_id, offset_master_account_id, amount, period_year, period_month")
        .eq("organization_id", body.organizationId)
        .eq("is_excluded", false)
        .range(offset, offset + limit - 1),
    ),
    fetchAllPaginated<RawAllocRow>((offset, limit) =>
      a
        .from("allocation_adjustments")
        .select("source_entity_id, destination_entity_id, master_account_id, destination_master_account_id, amount, schedule_type, period_year, period_month, start_year, start_month, end_year, end_month, is_repeating, repeat_end_year, repeat_end_month")
        .eq("organization_id", body.organizationId)
        .eq("is_excluded", false)
        .range(offset, offset + limit - 1),
    ),
    fetchAllPaginated<YearAdjRow & { chart_id: string }>((offset, limit) =>
      a
        .from("master_account_year_adjustments")
        .select("master_account_id, period_year, amount, offset_to_ic_net, entity_id, chart_id")
        .eq("organization_id", body.organizationId)
        .range(offset, offset + limit - 1),
    ),
  ]);

  // Coerce numeric fields (Supabase returns numerics as strings)
  const proForma: ProFormaRow[] = proFormaRows.map((p) => ({
    master_account_id: p.master_account_id,
    offset_master_account_id: p.offset_master_account_id,
    amount: Number(p.amount),
    period_year: Number(p.period_year),
    period_month: Number(p.period_month),
  }));

  const allocations: AllocationEntryRow[] = expandAllocationsForBridge(
    allocRows.map((a) => ({
      ...a,
      amount: Number(a.amount),
      period_year: a.period_year != null ? Number(a.period_year) : null,
      period_month: a.period_month != null ? Number(a.period_month) : null,
      start_year: a.start_year != null ? Number(a.start_year) : null,
      start_month: a.start_month != null ? Number(a.start_month) : null,
      end_year: a.end_year != null ? Number(a.end_year) : null,
      end_month: a.end_month != null ? Number(a.end_month) : null,
      repeat_end_year: a.repeat_end_year != null ? Number(a.repeat_end_year) : null,
      repeat_end_month: a.repeat_end_month != null ? Number(a.repeat_end_month) : null,
    })),
  );

  const yearEndAll = yearEndRows.map((r) => ({
    master_account_id: r.master_account_id,
    period_year: Number(r.period_year),
    amount: Number(r.amount),
    offset_to_ic_net: r.offset_to_ic_net,
    entity_id: r.entity_id,
    chart_id: r.chart_id,
  }));

  const mgmtYearEnd: YearAdjRow[] = yearEndAll.filter((r) => r.chart_id === mgmtChart.id);
  const accYearEnd: YearAdjRow[] = yearEndAll.filter((r) => r.chart_id === accChart.id);

  // Period bucket lite — needed to attribute adjustments to the right bucket.
  const buckets = getPeriodsInRange(
    body.startYear,
    body.startMonth,
    body.endYear,
    body.endMonth,
    body.granularity,
  );
  const periodBuckets: PeriodBucketLite[] = buckets.map((b) => ({
    key: b.key,
    startYear: b.year,
    startMonth: b.startMonth,
    endYear: b.endYear,
    endMonth: b.endMonth,
  }));

  // Pick the requested statement
  const mgmtStmt =
    body.statement === "BS" ? mgmtFS.balanceSheet : mgmtFS.incomeStatement;
  const accStmt =
    body.statement === "BS" ? accFS.balanceSheet : accFS.incomeStatement;

  // Build chart contexts
  const mgmtCtx: ChartContext = {
    chartId: mgmtChart.id,
    chartKind: "management",
    chartName: mgmtChart.name || "Company-prepared",
    statement: mgmtStmt,
    masters: mgmtMasters,
    proForma,
    allocations,
    yearEnd: mgmtYearEnd,
  };

  const accCtx: ChartContext = {
    chartId: accChart.id,
    chartKind: "accountant",
    chartName: accChart.name || "Accountant-prepared",
    statement: accStmt,
    masters: accMasters,
    // Pro forma & allocations are NOT applied to the accountant chart by
    // current convention — the FS API returns the accountant statements with
    // those layers off. The bridge mirrors that here.
    proForma: [],
    allocations: [],
    yearEnd: accYearEnd,
  };

  const fromCtx = body.direction === "acc-to-mgt" ? accCtx : mgmtCtx;
  const toCtx = body.direction === "acc-to-mgt" ? mgmtCtx : accCtx;
  const fromFS = body.direction === "acc-to-mgt" ? accFS : mgmtFS;

  const { rows, totalBridge } = computeBridge({
    fromCtx,
    toCtx,
    periods: fromFS.periods,
    periodBuckets,
  });

  const response: BridgeResponse = {
    statement: body.statement,
    direction: body.direction,
    periods: fromFS.periods,
    fromStatement: fromCtx.statement,
    toStatement: toCtx.statement,
    fromChartName: fromCtx.chartName,
    toChartName: toCtx.chartName,
    rows,
    totalBridge,
    metadata: {
      organizationName: org?.name ?? undefined,
      generatedAt: new Date().toISOString(),
      startPeriod: `${body.startYear}-${body.startMonth}`,
      endPeriod: `${body.endYear}-${body.endMonth}`,
    },
  };

  return NextResponse.json(response);
}
