import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPeriodsInRange } from "@/lib/utils/dates";
import { fetchAllMappings, fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { resolveChartIdOrDefault } from "@/lib/master-charts/resolve";
import { getExcludedFromBreakdownEntityIds } from "@/lib/db/queries/reporting-entity-exclusions";
import {
  INCOME_STATEMENT_SECTIONS,
  INCOME_STATEMENT_COMPUTED,
  BALANCE_SHEET_SECTIONS,
  BALANCE_SHEET_COMPUTED,
  type StatementSectionConfig,
  type ComputedLineConfig,
} from "@/lib/config/statement-sections";
import type {
  LineItem,
  StatementSection,
  StatementData,
  Granularity,
} from "@/components/financial-statements/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RawGLBalance {
  account_id: string;
  entity_id: string;
  period_year: number;
  period_month: number;
  beginning_balance: number;
  ending_balance: number;
  net_change: number;
}

interface AccountInfo {
  id: string;
  name: string;
  accountNumber: string | null;
  classification: string;
  accountType: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGLBalance(row: any): RawGLBalance {
  return {
    account_id: row.account_id,
    entity_id: row.entity_id,
    period_year: Number(row.period_year),
    period_month: Number(row.period_month),
    beginning_balance: Number(row.beginning_balance),
    ending_balance: Number(row.ending_balance),
    net_change: Number(row.net_change),
  };
}

// ---------------------------------------------------------------------------
// Derive standalone monthly net_change for P&L accounts.
// QBO trial balance stores cumulative YTD in ending_balance/net_change for
// P&L accounts. We must subtract the prior month's ending_balance to get the
// true monthly activity. This mirrors aggregateByBucket() in the main route.
// ---------------------------------------------------------------------------

function deriveStandaloneNetChanges(
  balances: RawGLBalance[],
  plAccountIds: Set<string>,
  fiscalYearStartMonth: number
): void {
  // Group by (entity_id, account_id)
  const grouped = new Map<string, RawGLBalance[]>();
  for (const b of balances) {
    const key = `${b.entity_id}::${b.account_id}`;
    const list = grouped.get(key) ?? [];
    list.push(b);
    grouped.set(key, list);
  }

  for (const [key, bals] of grouped) {
    const accountId = key.split("::")[1];
    if (!plAccountIds.has(accountId)) continue; // BS accounts are fine

    // Sort by date
    bals.sort(
      (a, b) => a.period_year - b.period_year || a.period_month - b.period_month
    );

    // Derive standalone amounts from ending_balance differences
    for (let i = 0; i < bals.length; i++) {
      const curr = bals[i];
      if (curr.period_month === fiscalYearStartMonth) {
        // P&L resets at fiscal year start — YTD IS standalone
        curr.net_change = curr.ending_balance;
      } else if (i > 0) {
        curr.net_change = curr.ending_balance - bals[i - 1].ending_balance;
      } else {
        // No prior month data — use ending_balance as best available
        curr.net_change = curr.ending_balance;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Paginated GL balance fetcher
// ---------------------------------------------------------------------------

const GL_PAGE_SIZE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllGLBalances(
  admin: any,
  entityIds: string[],
  years: number[],
  months: number[]
): Promise<RawGLBalance[]> {
  const allRows: RawGLBalance[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await admin
      .from("gl_balances")
      .select(
        "account_id, entity_id, period_year, period_month, beginning_balance, ending_balance, net_change"
      )
      .in("entity_id", entityIds)
      .in("period_year", years)
      .in("period_month", months)
      // Deterministic ordering is CRITICAL for correct pagination.
      // Without ORDER BY, PostgreSQL returns rows in arbitrary order that
      // can change between page fetches, causing rows to be skipped or
      // duplicated across pages.
      .order("entity_id")
      .order("account_id")
      .order("period_year")
      .order("period_month")
      .range(offset, offset + GL_PAGE_SIZE - 1);

    if (error) {
      console.error("GL balance pagination error:", error);
      break;
    }

    const rows = (data ?? []).map(parseGLBalance);
    allRows.push(...rows);

    if (rows.length < GL_PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += GL_PAGE_SIZE;
    }
  }

  return allRows;
}

// ---------------------------------------------------------------------------
// Helper: expand allocation adjustments into per-entity, per-period entries
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expandAllocationEntries(allocRows: any[]): Array<{
  entity_id: string;
  master_account_id: string;
  period_year: number;
  period_month: number;
  amount: number;
}> {
  const entries: Array<{
    entity_id: string;
    master_account_id: string;
    period_year: number;
    period_month: number;
    amount: number;
  }> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function pushPair(alloc: any, year: number, month: number, amt: number) {
    if (alloc.destination_master_account_id) {
      // Intra-entity reclass: move between accounts within same entity
      entries.push({
        entity_id: alloc.source_entity_id,
        master_account_id: alloc.master_account_id,
        period_year: year,
        period_month: month,
        amount: -amt,
      });
      entries.push({
        entity_id: alloc.source_entity_id,
        master_account_id: alloc.destination_master_account_id,
        period_year: year,
        period_month: month,
        amount: amt,
      });
    } else {
      // Inter-entity: move between entities on same account
      entries.push({
        entity_id: alloc.source_entity_id,
        master_account_id: alloc.master_account_id,
        period_year: year,
        period_month: month,
        amount: -amt,
      });
      entries.push({
        entity_id: alloc.destination_entity_id,
        master_account_id: alloc.master_account_id,
        period_year: year,
        period_month: month,
        amount: amt,
      });
    }
  }

  for (const alloc of allocRows) {
    const totalAmount = Number(alloc.amount);

    if (alloc.schedule_type === "single_month") {
      if (alloc.period_year == null || alloc.period_month == null) continue;

      if (alloc.is_repeating && alloc.repeat_end_year != null && alloc.repeat_end_month != null) {
        // Repeating: full amount each month from period through repeat_end
        const totalMonths =
          (alloc.repeat_end_year - alloc.period_year) * 12 +
          (alloc.repeat_end_month - alloc.period_month) + 1;
        if (totalMonths < 1) continue;

        let y = alloc.period_year;
        let m = alloc.period_month;
        for (let i = 0; i < totalMonths; i++) {
          pushPair(alloc, y, m, totalAmount);
          m++;
          if (m > 12) { m = 1; y++; }
        }
      } else {
        pushPair(alloc, alloc.period_year, alloc.period_month, totalAmount);
      }
    } else if (alloc.schedule_type === "monthly_spread") {
      if (
        alloc.start_year == null || alloc.start_month == null ||
        alloc.end_year == null || alloc.end_month == null
      ) continue;

      const totalMonths =
        (alloc.end_year - alloc.start_year) * 12 +
        (alloc.end_month - alloc.start_month) + 1;
      if (totalMonths < 1) continue;

      const monthlyAmount = totalAmount / totalMonths;
      let y = alloc.start_year;
      let m = alloc.start_month;
      for (let i = 0; i < totalMonths; i++) {
        pushPair(alloc, y, m, monthlyAmount);
        m++;
        if (m > 12) { m = 1; y++; }
      }
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Build statement with reporting-entity columns
// ---------------------------------------------------------------------------

interface ColumnAmounts {
  netChange: Record<string, number>;
  endingBalance: Record<string, number>;
}

function buildREStatement(
  statementId: string,
  title: string,
  sectionConfigs: StatementSectionConfig[],
  computedConfigs: ComputedLineConfig[],
  accounts: AccountInfo[],
  columnAmounts: Map<string, ColumnAmounts>,
  columnKeys: string[],
  useNetChange: boolean
): StatementData {
  const sections: StatementSection[] = [];
  const sectionTotals: Record<string, Record<string, number>> = {};

  for (const config of sectionConfigs) {
    const sectionAccounts = accounts.filter(
      (a) =>
        a.classification === config.classification &&
        config.accountTypes.includes(a.accountType)
    );

    sectionAccounts.sort((a, b) =>
      (a.accountNumber ?? "").localeCompare(b.accountNumber ?? "")
    );

    const lines: LineItem[] = [];
    const totals: Record<string, number> = {};
    for (const key of columnKeys) totals[key] = 0;

    let lineIndex = 0;
    for (const account of sectionAccounts) {
      const ca = columnAmounts.get(account.id);
      const amounts: Record<string, number> = {};

      for (const key of columnKeys) {
        const raw = useNetChange
          ? (ca?.netChange[key] ?? 0)
          : (ca?.endingBalance[key] ?? 0);
        amounts[key] = useNetChange
          ? config.classification === "Revenue"
            ? -raw
            : raw
          : (config.classification === "Liability" || config.classification === "Equity")
            ? -raw
            : raw;
        totals[key] += amounts[key];
      }

      lines.push({
        id: `${config.id}-${account.id}`,
        label: account.name,
        accountNumber: account.accountNumber ?? undefined,
        amounts,
        indent: 1,
        isTotal: false,
        isGrandTotal: false,
        isHeader: false,
        isSeparator: false,
        showDollarSign: lineIndex === 0,
      });
      lineIndex++;
    }

    sectionTotals[config.id] = totals;

    const subtotalLine: LineItem = {
      id: `${config.id}-total`,
      label: config.title ? `Total ${config.title}` : "",
      amounts: totals,
      indent: 0,
      isTotal: true,
      isGrandTotal: false,
      isHeader: false,
      isSeparator: false,
      showDollarSign: true,
    };

    sections.push({ id: config.id, title: config.title, lines, subtotalLine });
  }

  // Computed lines (Gross Margin, Net Income, etc.)
  const finalSections: StatementSection[] = [];

  for (const section of sections) {
    finalSections.push(section);

    const computedAfter = computedConfigs.filter(
      (c) => c.afterSection === section.id
    );

    for (const comp of computedAfter) {
      const amounts: Record<string, number> = {};

      for (const key of columnKeys) {
        let val = 0;
        for (const { sectionId, sign } of comp.formula) {
          val += (sectionTotals[sectionId]?.[key] ?? 0) * sign;
        }
        amounts[key] = val;
      }

      finalSections.push({
        id: comp.id,
        title: "",
        lines: [],
        subtotalLine: {
          id: comp.id,
          label: comp.label,
          amounts,
          indent: 0,
          isTotal: !comp.isGrandTotal,
          isGrandTotal: comp.isGrandTotal ?? false,
          isHeader: false,
          isSeparator: false,
          showDollarSign: true,
        },
      });

      // Margin % lines
      if (
        comp.id === "gross_margin" ||
        comp.id === "operating_margin" ||
        comp.id === "net_income"
      ) {
        const marginAmounts: Record<string, number> = {};
        for (const key of columnKeys) {
          const revenue = sectionTotals["revenue"]?.[key] ?? 0;
          marginAmounts[key] = revenue !== 0 ? amounts[key] / revenue : 0;
        }

        const marginLabel =
          comp.id === "gross_margin"
            ? "Gross Margin %"
            : comp.id === "operating_margin"
              ? "EBITDA %"
              : "Net Income Margin %";

        finalSections.push({
          id: `${comp.id}_pct`,
          title: "",
          lines: [],
          subtotalLine: {
            id: `${comp.id}_pct`,
            label: marginLabel,
            amounts: marginAmounts,
            indent: 1,
            isTotal: false,
            isGrandTotal: false,
            isHeader: false,
            isSeparator: false,
            showDollarSign: false,
          },
        });
      }
    }
  }

  return { id: statementId, title, sections: finalSections };
}

// ---------------------------------------------------------------------------
// Helper: inject Net Income into balance sheet equity section.
// Same logic as in the main route but adapted for ColumnAmounts structure.
// ---------------------------------------------------------------------------

function injectNetIncomeIntoREBreakdownBS(
  balanceSheet: StatementData,
  accounts: AccountInfo[],
  columnAmounts: Map<string, ColumnAmounts>,
  columnKeys: string[]
): void {
  const plAccounts = accounts.filter(
    (a) => a.classification === "Revenue" || a.classification === "Expense"
  );
  if (plAccounts.length === 0) return;

  const niAmounts: Record<string, number> = {};
  for (const key of columnKeys) {
    let plEnding = 0;
    for (const acct of plAccounts) {
      plEnding += columnAmounts.get(acct.id)?.endingBalance[key] ?? 0;
    }
    niAmounts[key] = -plEnding;
  }

  const equitySection = balanceSheet.sections.find((s) => s.id === "equity");
  if (!equitySection?.subtotalLine) return;

  equitySection.lines.push({
    id: "equity-net-income",
    label: "Net Income",
    amounts: niAmounts,
    indent: 1,
    isTotal: false,
    isGrandTotal: false,
    isHeader: false,
    isSeparator: false,
    showDollarSign: equitySection.lines.length === 0,
  });

  for (const key of columnKeys) {
    equitySection.subtotalLine.amounts[key] =
      (equitySection.subtotalLine.amounts[key] ?? 0) + niAmounts[key];
  }

  for (const section of balanceSheet.sections) {
    if (
      (section.id === "total_equity" ||
        section.id === "total_liabilities_and_equity") &&
      section.subtotalLine
    ) {
      for (const key of columnKeys) {
        section.subtotalLine.amounts[key] =
          (section.subtotalLine.amounts[key] ?? 0) + niAmounts[key];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const organizationId = searchParams.get("organizationId");
  const startYear = parseInt(searchParams.get("startYear") ?? "0");
  const startMonth = parseInt(searchParams.get("startMonth") ?? "0");
  const endYear = parseInt(searchParams.get("endYear") ?? "0");
  const endMonth = parseInt(searchParams.get("endMonth") ?? "0");
  const granularity =
    (searchParams.get("granularity") as Granularity) ?? "monthly";
  const includeProForma = searchParams.get("includeProForma") === "true";
  const includeAllocations = searchParams.get("includeAllocations") === "true";
  const chartIdParam = searchParams.get("chartId");

  if (!organizationId) {
    return NextResponse.json(
      { error: "organizationId is required" },
      { status: 400 }
    );
  }

  if (!startYear || !startMonth || !endYear || !endMonth) {
    return NextResponse.json(
      { error: "startYear, startMonth, endYear, endMonth are required" },
      { status: 400 }
    );
  }

  // Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Get org info
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .single();

  // Get all reporting entities for this org.
  // Excluded REs are kept here for member tracking (so their entities don't
  // appear under "Other") but are filtered out of column generation below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: allReportingEntities } = await (admin as any)
    .from("reporting_entities")
    .select("id, name, code, exclude_from_breakdown")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("name");

  const reportingEntities = (allReportingEntities ?? []).filter(
    (re: { exclude_from_breakdown?: boolean }) => !re.exclude_from_breakdown
  );

  if (!allReportingEntities || allReportingEntities.length === 0) {
    return NextResponse.json({
      columns: [],
      incomeStatement: {
        id: "income_statement",
        title: "Income Statement",
        sections: [],
      },
      balanceSheet: {
        id: "balance_sheet",
        title: "Balance Sheet",
        sections: [],
      },
      metadata: {
        organizationName: org?.name,
        generatedAt: new Date().toISOString(),
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

  // Get all member mappings: reporting_entity_id -> entity_id[].
  // Fetch members for ALL reporting entities (including excluded ones) so that
  // entities belonging to an excluded RE are not surfaced under "Other".
  const allReIds = allReportingEntities.map((re: { id: string }) => re.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberRows } = await (admin as any)
    .from("reporting_entity_members")
    .select("reporting_entity_id, entity_id")
    .in("reporting_entity_id", allReIds);

  const reMemberMap = new Map<string, string[]>();
  const allMemberEntityIds = new Set<string>();

  for (const row of memberRows ?? []) {
    const list = reMemberMap.get(row.reporting_entity_id) ?? [];
    list.push(row.entity_id);
    reMemberMap.set(row.reporting_entity_id, list);
    allMemberEntityIds.add(row.entity_id);
  }

  // Get ALL active entities for the org (to find unassigned ones)
  const { data: orgEntities } = await admin
    .from("entities")
    .select("id, name, code, fiscal_year_end_month")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("name");

  // Derive fiscal year start month (consistent with main route)
  const fyEnd = (orgEntities ?? [])[0]?.fiscal_year_end_month ?? 12;
  const fiscalYearStartMonth = (fyEnd % 12) + 1;

  const allEntities = orgEntities ?? [];
  const allEntityIds = allEntities.map((e) => e.id);

  // Entities not in any reporting entity
  const unassignedEntityIds = allEntityIds.filter(
    (id) => !allMemberEntityIds.has(id)
  );

  // Entities that belong only to excluded REs — must be left out of the
  // "Consolidated" column so excluding an RE actually reduces the total
  // (rather than just hiding a column while still summing its entities
  // into the consolidated figure).
  const excludedEntityIds = await getExcludedFromBreakdownEntityIds(
    admin,
    organizationId,
  );
  const consolidatedEntityIds = allEntityIds.filter(
    (id) => !excludedEntityIds.has(id),
  );

  if (allEntityIds.length === 0) {
    return NextResponse.json({
      columns: [],
      incomeStatement: {
        id: "income_statement",
        title: "Income Statement",
        sections: [],
      },
      balanceSheet: {
        id: "balance_sheet",
        title: "Balance Sheet",
        sections: [],
      },
      metadata: {
        organizationName: org?.name,
        generatedAt: new Date().toISOString(),
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

  let chartId: string;
  try {
    chartId = await resolveChartIdOrDefault(admin, organizationId, chartIdParam);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  // Get master accounts in the active chart
  const { data: masterAccounts } = await admin
    .from("master_accounts")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("chart_id", chartId)
    .eq("is_active", true)
    .order("display_order")
    .order("account_number");

  if (!masterAccounts || masterAccounts.length === 0) {
    return NextResponse.json({
      columns: [],
      incomeStatement: {
        id: "income_statement",
        title: "Income Statement",
        sections: [],
      },
      balanceSheet: {
        id: "balance_sheet",
        title: "Balance Sheet",
        sections: [],
      },
      metadata: {
        organizationName: org?.name,
        generatedAt: new Date().toISOString(),
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

  // Get mappings (paginated to avoid PostgREST max_rows truncation)
  const masterAccountIds = masterAccounts.map((ma) => ma.id);
  const mappings = await fetchAllMappings(admin, masterAccountIds);

  // Build mapping: (master_account_id, entity_id) -> list of entity account_ids
  const masterEntityToAccounts = new Map<string, string[]>();
  const mappedAccountIdSet = new Set<string>();
  for (const m of mappings ?? []) {
    const key = `${m.master_account_id}::${m.entity_id}`;
    const existing = masterEntityToAccounts.get(key) ?? [];
    existing.push(m.account_id);
    masterEntityToAccounts.set(key, existing);
    mappedAccountIdSet.add(m.account_id);
  }

  // Compute months in range
  const buckets = getPeriodsInRange(
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity
  );
  const allMonthsSet = new Set<string>();
  const allMonths: Array<{ year: number; month: number }> = [];
  for (const bucket of buckets) {
    for (const m of bucket.months) {
      const key = `${m.year}-${String(m.month).padStart(2, "0")}`;
      if (!allMonthsSet.has(key)) {
        allMonthsSet.add(key);
        allMonths.push(m);
      }
    }
  }

  // Build set of P&L master account IDs (for standalone net_change derivation)
  const plMasterAccountIds = new Set(
    masterAccounts
      .filter((ma: { classification: string }) =>
        ma.classification === "Revenue" || ma.classification === "Expense"
      )
      .map((ma: { id: string }) => ma.id)
  );

  // Compute the prior month (needed to derive standalone P&L net changes)
  const priorMonth = startMonth === 1
    ? { year: startYear - 1, month: 12 }
    : { year: startYear, month: startMonth - 1 };

  // Get GL balances for ALL entities (include prior month for derivation)
  let glBalances: RawGLBalance[] = [];

  if (mappedAccountIdSet.size > 0 && allEntityIds.length > 0) {
    const fetchMonths = [...allMonths, priorMonth];
    const uniqueYears = [...new Set(fetchMonths.map((m) => m.year))];
    const uniqueMonthNums = [...new Set(fetchMonths.map((m) => m.month))];

    const allBalances = await fetchAllGLBalances(
      admin,
      allEntityIds,
      uniqueYears,
      uniqueMonthNums
    );

    // Filter to mapped accounts (keep prior month for derivation)
    glBalances = allBalances.filter((b) =>
      mappedAccountIdSet.has(b.account_id)
    );
  }

  // Index GL balances: (entity_id, account_id) -> balances (includes prior month)
  const balanceIndex = new Map<string, RawGLBalance[]>();
  for (const b of glBalances) {
    const key = `${b.entity_id}::${b.account_id}`;
    const existing = balanceIndex.get(key) ?? [];
    existing.push(b);
    balanceIndex.set(key, existing);
  }

  // Month set for the actual requested range (excludes prior month)
  const rangeMonthSet = new Set(
    allMonths.map(
      (m) => `${m.year}-${String(m.month).padStart(2, "0")}`
    )
  );

  // Find last month in range (for Balance Sheet ending_balance)
  const sortedMonths = [...allMonths].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  );
  const lastMonth = sortedMonths[sortedMonths.length - 1];
  const lastMonthKey = lastMonth
    ? `${lastMonth.year}-${String(lastMonth.month).padStart(2, "0")}`
    : "";

  // ---------------------------------------------------------------------------
  // Build amounts per master account, aggregated by reporting entity.
  //
  // IMPORTANT: For P&L accounts, QBO stores cumulative YTD in ending_balance
  // and net_change. We must CONSOLIDATE first (sum ending_balances across
  // entities per period), THEN derive standalone monthly amounts from the
  // consolidated figures. This matches the main route's aggregateByBucket()
  // approach and avoids discrepancies when entities have different month
  // coverage.
  // ---------------------------------------------------------------------------
  const columnAmounts = new Map<string, ColumnAmounts>();

  // Helper: consolidate amounts for a set of entity IDs against a master account.
  // For P&L: consolidates ending_balances per period, then derives standalone
  // net_change from the consolidated figures (matching aggregateByBucket).
  // For BS: sums raw net_change directly.
  function sumEntityAmounts(
    maId: string,
    entityIds: string[],
    isPL: boolean
  ): { netChange: number; endingBalance: number } {
    // Step 1: Collect raw balances and consolidate ending_balance per period
    const periodEnding = new Map<string, number>();
    let bsNetChange = 0;

    for (const entityId of entityIds) {
      const mapKey = `${maId}::${entityId}`;
      const entityAccountIds = masterEntityToAccounts.get(mapKey) ?? [];

      for (const accountId of entityAccountIds) {
        const balKey = `${entityId}::${accountId}`;
        const bals = balanceIndex.get(balKey) ?? [];

        for (const b of bals) {
          const pKey = `${b.period_year}-${String(b.period_month).padStart(2, "0")}`;
          periodEnding.set(pKey, (periodEnding.get(pKey) ?? 0) + b.ending_balance);
          // For BS accounts, sum raw net_change (only for months in range)
          if (!isPL && rangeMonthSet.has(pKey)) {
            bsNetChange += b.net_change;
          }
        }
      }
    }

    if (periodEnding.size === 0) return { netChange: 0, endingBalance: 0 };

    // Step 2: For P&L, derive standalone net_change from consolidated
    // ending_balance differences (same logic as aggregateByBucket)
    let totalNetChange: number;

    if (isPL) {
      totalNetChange = 0;

      for (const [key, ending] of periodEnding) {
        // Skip the prior month — it's only here for derivation
        if (!rangeMonthSet.has(key)) continue;

        const [yearStr, monthStr] = key.split("-");
        const year = parseInt(yearStr);
        const month = parseInt(monthStr);

        if (month === fiscalYearStartMonth) {
          // P&L resets at fiscal year start — YTD IS standalone
          totalNetChange += ending;
        } else {
          // Look up the SPECIFIC prior month (month-1) by key,
          // exactly matching aggregateByBucket() in the main route.
          const pm = month === 1 ? 12 : month - 1;
          const py = month === 1 ? year - 1 : year;
          const priorKey = `${py}-${String(pm).padStart(2, "0")}`;
          const priorEnding = periodEnding.get(priorKey);

          if (priorEnding !== undefined) {
            totalNetChange += ending - priorEnding;
          } else {
            // No prior month data — use ending_balance as best available
            totalNetChange += ending;
          }
        }
      }
    } else {
      totalNetChange = bsNetChange;
    }

    const totalEndingBalance = periodEnding.get(lastMonthKey) ?? 0;
    return { netChange: totalNetChange, endingBalance: totalEndingBalance };
  }

  for (const ma of masterAccounts) {
    const ca: ColumnAmounts = { netChange: {}, endingBalance: {} };
    const isPL = plMasterAccountIds.has(ma.id);

    // Each reporting entity column
    for (const re of reportingEntities) {
      const memberIds = reMemberMap.get(re.id) ?? [];
      const { netChange, endingBalance } = sumEntityAmounts(ma.id, memberIds, isPL);
      ca.netChange[re.id] = netChange;
      ca.endingBalance[re.id] = endingBalance;
    }

    // Other (unassigned entities)
    if (unassignedEntityIds.length > 0) {
      const { netChange, endingBalance } = sumEntityAmounts(
        ma.id,
        unassignedEntityIds,
        isPL
      );
      ca.netChange["other"] = netChange;
      ca.endingBalance["other"] = endingBalance;
    }

    // Consolidated = sum across entities NOT belonging exclusively to an
    // excluded RE. This keeps the consolidated total internally consistent
    // with the visible RE columns + "Other" — excluding an RE should
    // actually reduce the total, not just hide a column.
    const { netChange, endingBalance } = sumEntityAmounts(
      ma.id,
      consolidatedEntityIds,
      isPL
    );
    ca.netChange["consolidated"] = netChange;
    ca.endingBalance["consolidated"] = endingBalance;

    columnAmounts.set(ma.id, ca);
  }

  // Pro forma adjustments
  if (includeProForma) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proFormaRows = await fetchAllPaginated<{
      master_account_id: string; entity_id: string;
      period_year: number; period_month: number; amount: number;
    }>((offset, limit) =>
      (admin as any)
        .from("pro_forma_adjustments")
        .select("master_account_id, entity_id, period_year, period_month, amount")
        .eq("organization_id", organizationId)
        .eq("is_excluded", false)
        .range(offset, offset + limit - 1)
    );

    if (proFormaRows.length > 0) {
      // Build entity_id -> reporting_entity_id lookup
      const entityToRE = new Map<string, string[]>();
      for (const [reId, memberIds] of reMemberMap) {
        for (const eid of memberIds) {
          const existing = entityToRE.get(eid) ?? [];
          existing.push(reId);
          entityToRE.set(eid, existing);
        }
      }

      for (const adj of proFormaRows) {
        const adjMonthKey = `${adj.period_year}-${String(adj.period_month).padStart(2, "0")}`;
        if (!allMonthsSet.has(adjMonthKey)) continue;

        const ca = columnAmounts.get(adj.master_account_id);
        if (!ca) continue;

        const amount = Number(adj.amount);

        // Add to the reporting entity column(s) this entity belongs to
        const reIdsForEntity = entityToRE.get(adj.entity_id) ?? [];
        for (const reId of reIdsForEntity) {
          ca.netChange[reId] = (ca.netChange[reId] ?? 0) + amount;
          if (adjMonthKey === lastMonthKey) {
            ca.endingBalance[reId] = (ca.endingBalance[reId] ?? 0) + amount;
          }
        }

        // If entity is unassigned, add to "other"
        if (reIdsForEntity.length === 0 && unassignedEntityIds.includes(adj.entity_id)) {
          ca.netChange["other"] = (ca.netChange["other"] ?? 0) + amount;
          if (adjMonthKey === lastMonthKey) {
            ca.endingBalance["other"] = (ca.endingBalance["other"] ?? 0) + amount;
          }
        }

        // Add to consolidated only if this entity isn't excluded from
        // breakdown — keeps consolidated in sync with the visible columns.
        if (!excludedEntityIds.has(adj.entity_id)) {
          ca.netChange["consolidated"] =
            (ca.netChange["consolidated"] ?? 0) + amount;
          if (adjMonthKey === lastMonthKey) {
            ca.endingBalance["consolidated"] =
              (ca.endingBalance["consolidated"] ?? 0) + amount;
          }
        }
      }
    }
  }

  // Allocation adjustments
  if (includeAllocations) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allocRows = await fetchAllPaginated<any>((offset, limit) =>
      (admin as any)
        .from("allocation_adjustments")
        .select("source_entity_id, destination_entity_id, master_account_id, destination_master_account_id, amount, schedule_type, period_year, period_month, start_year, start_month, end_year, end_month, is_repeating, repeat_end_year, repeat_end_month")
        .eq("organization_id", organizationId)
        .eq("is_excluded", false)
        .range(offset, offset + limit - 1)
    );

    if (allocRows.length > 0) {
      // Build entity_id -> reporting_entity_id lookup (same as pro forma above)
      const entityToRE = new Map<string, string[]>();
      for (const [reId, memberIds] of reMemberMap) {
        for (const eid of memberIds) {
          const existing = entityToRE.get(eid) ?? [];
          existing.push(reId);
          entityToRE.set(eid, existing);
        }
      }

      const expanded = expandAllocationEntries(allocRows);

      for (const entry of expanded) {
        const adjMonthKey = `${entry.period_year}-${String(entry.period_month).padStart(2, "0")}`;
        if (!allMonthsSet.has(adjMonthKey)) continue;

        const ca = columnAmounts.get(entry.master_account_id);
        if (!ca) continue;

        const amount = entry.amount;

        // Add to the reporting entity column(s) this entity belongs to
        const reIdsForEntity = entityToRE.get(entry.entity_id) ?? [];
        for (const reId of reIdsForEntity) {
          ca.netChange[reId] = (ca.netChange[reId] ?? 0) + amount;
          if (adjMonthKey === lastMonthKey) {
            ca.endingBalance[reId] = (ca.endingBalance[reId] ?? 0) + amount;
          }
        }

        // If entity is unassigned, add to "other"
        if (reIdsForEntity.length === 0 && unassignedEntityIds.includes(entry.entity_id)) {
          ca.netChange["other"] = (ca.netChange["other"] ?? 0) + amount;
          if (adjMonthKey === lastMonthKey) {
            ca.endingBalance["other"] = (ca.endingBalance["other"] ?? 0) + amount;
          }
        }

        // Add to consolidated only if this entity isn't excluded from
        // breakdown — keeps consolidated in sync with the visible columns.
        if (!excludedEntityIds.has(entry.entity_id)) {
          ca.netChange["consolidated"] =
            (ca.netChange["consolidated"] ?? 0) + amount;
          if (adjMonthKey === lastMonthKey) {
            ca.endingBalance["consolidated"] =
              (ca.endingBalance["consolidated"] ?? 0) + amount;
          }
        }
      }
    }
  }

  // Build accounts list
  const consolidatedAccounts: AccountInfo[] = masterAccounts.map((ma) => ({
    id: ma.id,
    name: ma.name,
    accountNumber: ma.account_number,
    classification: ma.classification,
    accountType: ma.account_type,
  }));

  // Column keys: RE IDs + optional "other" + "consolidated"
  const columnKeys: string[] = reportingEntities.map(
    (re: { id: string }) => re.id
  );
  if (unassignedEntityIds.length > 0) {
    columnKeys.push("other");
  }
  columnKeys.push("consolidated");

  // Build statements
  const incomeStatement = buildREStatement(
    "income_statement",
    "Income Statement — Reporting Entity Breakdown",
    INCOME_STATEMENT_SECTIONS,
    INCOME_STATEMENT_COMPUTED,
    consolidatedAccounts,
    columnAmounts,
    columnKeys,
    true
  );

  const balanceSheet = buildREStatement(
    "balance_sheet",
    "Balance Sheet — Reporting Entity Breakdown",
    BALANCE_SHEET_SECTIONS,
    BALANCE_SHEET_COMPUTED,
    consolidatedAccounts,
    columnAmounts,
    columnKeys,
    false
  );

  // Inject Net Income into BS equity so Assets = L + E
  injectNetIncomeIntoREBreakdownBS(
    balanceSheet,
    consolidatedAccounts,
    columnAmounts,
    columnKeys
  );

  // Build columns metadata
  const columns = [
    ...reportingEntities.map((re: { id: string; code: string; name: string }) => ({
      key: re.id,
      label: re.code,
      fullName: re.name,
    })),
    ...(unassignedEntityIds.length > 0
      ? [
          {
            key: "other",
            label: "Other",
            fullName: "Unassigned Entities",
          },
        ]
      : []),
    {
      key: "consolidated",
      label: "Consolidated",
      fullName: org?.name ?? "Consolidated",
    },
  ];

  return NextResponse.json({
    columns,
    incomeStatement,
    balanceSheet,
    metadata: {
      organizationName: org?.name,
      generatedAt: new Date().toISOString(),
      startPeriod: `${startYear}-${startMonth}`,
      endPeriod: `${endYear}-${endMonth}`,
    },
  });
}
