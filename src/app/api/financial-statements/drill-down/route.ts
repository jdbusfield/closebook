import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPeriodsInRange, type PeriodBucket } from "@/lib/utils/dates";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { resolveChartIdOrDefault } from "@/lib/master-charts/resolve";
import {
  INCOME_STATEMENT_SECTIONS,
  INCOME_STATEMENT_COMPUTED,
  BALANCE_SHEET_SECTIONS,
  BALANCE_SHEET_COMPUTED,
  OPERATING_CURRENT_ASSET_TYPES,
  OPERATING_CURRENT_LIABILITY_TYPES,
  INVESTING_ACCOUNT_TYPES,
  FINANCING_LIABILITY_TYPES,
  FINANCING_EQUITY_TYPES,
  type StatementSectionConfig,
  type ComputedLineConfig,
} from "@/lib/config/statement-sections";
import type {
  Granularity,
  Scope,
  DrillDownResponse,
  DrillDownGroup,
  DrillDownEntityRow,
  DrillDownAdjustmentRow,
} from "@/components/financial-statements/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSectionConfigs(statementId: string): StatementSectionConfig[] {
  if (statementId === "income_statement") return INCOME_STATEMENT_SECTIONS;
  if (statementId === "balance_sheet") return BALANCE_SHEET_SECTIONS;
  return [];
}

function getComputedConfigs(statementId: string): ComputedLineConfig[] {
  if (statementId === "income_statement") return INCOME_STATEMENT_COMPUTED;
  if (statementId === "balance_sheet") return BALANCE_SHEET_COMPUTED;
  return [];
}

/** Resolve a section ID to the master account IDs in that section */
async function resolveSectionToMasterAccountIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  organizationId: string,
  chartId: string,
  sectionConfig: StatementSectionConfig
): Promise<string[]> {
  const { data: accounts } = await admin
    .from("master_accounts")
    .select("id, classification, account_type")
    .eq("organization_id", organizationId)
    .eq("chart_id", chartId)
    .eq("is_active", true)
    .eq("classification", sectionConfig.classification)
    .in("account_type", sectionConfig.accountTypes);

  return (accounts ?? []).map((a: { id: string }) => a.id);
}

/** Find the bucket matching a period key */
function findBucket(buckets: PeriodBucket[], periodKey: string): PeriodBucket | undefined {
  return buckets.find((b) => b.key === periodKey);
}

// ---------------------------------------------------------------------------
// GET /api/financial-statements/drill-down
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scope = (searchParams.get("scope") ?? "entity") as Scope;
  const entityId = searchParams.get("entityId");
  const organizationId = searchParams.get("organizationId");
  const reportingEntityId = searchParams.get("reportingEntityId");
  const startYear = parseInt(searchParams.get("startYear") ?? "2025");
  const startMonth = parseInt(searchParams.get("startMonth") ?? "1");
  const endYear = parseInt(searchParams.get("endYear") ?? "2025");
  const endMonth = parseInt(searchParams.get("endMonth") ?? "12");
  const granularity = (searchParams.get("granularity") ?? "monthly") as Granularity;
  const lineId = searchParams.get("lineId") ?? "";
  const statementId = searchParams.get("statementId") ?? "";
  const periodKey = searchParams.get("periodKey") ?? "";
  const columnType = (searchParams.get("columnType") ?? "actual") as "actual" | "budget";
  const includeProForma = searchParams.get("includeProForma") === "true";
  const includeAllocations = searchParams.get("includeAllocations") === "true";
  const chartIdParam = searchParams.get("chartId");

  if (!lineId || !statementId || !periodKey) {
    return NextResponse.json(
      { error: "lineId, statementId, and periodKey are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Generate period buckets and find the target bucket
  const buckets = getPeriodsInRange(startYear, startMonth, endYear, endMonth, granularity);
  const targetBucket = findBucket(buckets, periodKey);
  if (!targetBucket) {
    return NextResponse.json(
      { error: `Period key '${periodKey}' not found in range` },
      { status: 400 }
    );
  }

  // Resolve organization ID
  let resolvedOrgId = organizationId;
  if (scope === "entity" && entityId) {
    const { data: entity } = await admin
      .from("entities")
      .select("organization_id")
      .eq("id", entityId)
      .single();
    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }
    resolvedOrgId = entity.organization_id;
  }

  if (!resolvedOrgId) {
    return NextResponse.json(
      { error: "Could not resolve organization" },
      { status: 400 }
    );
  }

  let chartId: string;
  try {
    chartId = await resolveChartIdOrDefault(admin, resolvedOrgId, chartIdParam);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  // Resolve which entities are in scope
  let scopeEntityIds: string[] = [];
  if (scope === "entity" && entityId) {
    scopeEntityIds = [entityId];
  } else if (scope === "organization") {
    const { data: entities } = await admin
      .from("entities")
      .select("id")
      .eq("organization_id", resolvedOrgId)
      .eq("is_active", true);
    scopeEntityIds = (entities ?? []).map((e: { id: string }) => e.id);
  } else if (scope === "reporting_entity" && reportingEntityId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: members } = await (admin as any)
      .from("reporting_entity_members")
      .select("entity_id")
      .eq("reporting_entity_id", reportingEntityId);
    scopeEntityIds = (members ?? []).map((m: { entity_id: string }) => m.entity_id);
  }

  if (scopeEntityIds.length === 0) {
    return NextResponse.json(
      { error: "No entities in scope" },
      { status: 400 }
    );
  }

  // Fetch fiscal year end month for YTD→monthly conversion
  const { data: fyEntity } = await admin
    .from("entities")
    .select("fiscal_year_end_month")
    .eq("id", scopeEntityIds[0])
    .single();
  const fyEndMonth = fyEntity?.fiscal_year_end_month ?? 12;
  const fiscalYearStartMonth = (fyEndMonth % 12) + 1;

  // ---------------------------------------------------------------------------
  // Parse lineId to determine what to drill into
  // ---------------------------------------------------------------------------

  const sectionConfigs = getSectionConfigs(statementId);
  const computedConfigs = getComputedConfigs(statementId);

  // Structure: { masterAccountIds, sign, sectionLabel }[] grouped for display
  interface DrillTarget {
    masterAccountIds: string[];
    sign: 1 | -1;
    sectionLabel: string;
  }

  const drillTargets: DrillTarget[] = [];
  let isCashFlowLine = false;
  let useNetChange = statementId === "income_statement";

  // Check if it's a computed line (e.g., "gross_margin", "net_income", "total_assets")
  const computedConfig = computedConfigs.find((c) => c.id === lineId);
  if (computedConfig) {
    // Resolve each formula section to master account IDs
    for (const { sectionId, sign } of computedConfig.formula) {
      const sectionConfig = sectionConfigs.find((s) => s.id === sectionId);
      if (sectionConfig) {
        const maIds = await resolveSectionToMasterAccountIds(admin, resolvedOrgId, chartId, sectionConfig);
        drillTargets.push({
          masterAccountIds: maIds,
          sign,
          sectionLabel: sectionConfig.title || sectionId,
        });
      }
    }
  }
  // Check if it's a section total (e.g., "revenue-total")
  else if (lineId.endsWith("-total")) {
    const sectionId = lineId.replace(/-total$/, "");
    const sectionConfig = sectionConfigs.find((s) => s.id === sectionId);
    if (sectionConfig) {
      const maIds = await resolveSectionToMasterAccountIds(admin, resolvedOrgId, chartId, sectionConfig);
      drillTargets.push({
        masterAccountIds: maIds,
        sign: 1,
        sectionLabel: sectionConfig.title || sectionId,
      });
    }
  }
  // Check if it's a cash flow line
  else if (lineId.startsWith("cf-wc-") || lineId.startsWith("cf-inv-") || lineId.startsWith("cf-fin-")) {
    isCashFlowLine = true;
    useNetChange = false;
    const maId = lineId.replace(/^cf-(wc|inv|fin)-/, "");
    drillTargets.push({
      masterAccountIds: [maId],
      sign: 1,
      sectionLabel: "",
    });
  }
  // Otherwise it's a single account line (e.g., "revenue-{masterAccountId}")
  else {
    // Find the section prefix and extract master account ID
    const dashIndex = lineId.indexOf("-");
    if (dashIndex > 0) {
      const maId = lineId.substring(dashIndex + 1);
      drillTargets.push({
        masterAccountIds: [maId],
        sign: 1,
        sectionLabel: "",
      });
    } else {
      return NextResponse.json(
        { error: `Cannot parse lineId: ${lineId}` },
        { status: 400 }
      );
    }
  }

  // Collect all unique master account IDs
  const allMasterAccountIds = [...new Set(drillTargets.flatMap((t) => t.masterAccountIds))];

  if (allMasterAccountIds.length === 0) {
    return NextResponse.json({
      lineLabel: "",
      periodLabel: targetBucket.label,
      total: 0,
      groups: [],
      adjustments: [],
    } satisfies DrillDownResponse);
  }

  // ---------------------------------------------------------------------------
  // Fetch entity-level data for the drill-down
  // ---------------------------------------------------------------------------

  // Get master account info
  const masterAccounts = await fetchAllPaginated<any>((offset, limit) =>
    admin
      .from("master_accounts")
      .select("id, name, account_number, classification, account_type")
      .in("id", allMasterAccountIds)
      .range(offset, offset + limit - 1)
  );

  const maMap = new Map<string, { name: string; account_number: string | null; classification: string; accountType: string }>();
  for (const ma of masterAccounts) {
    maMap.set(ma.id, { name: ma.name, account_number: ma.account_number, classification: ma.classification, accountType: ma.account_type });
  }

  // Get mappings: master_account -> entity accounts (filtered to scope entities)
  const mappings = await fetchAllPaginated<any>((offset, limit) =>
    admin
      .from("master_account_mappings")
      .select("master_account_id, entity_id, account_id")
      .in("master_account_id", allMasterAccountIds)
      .in("entity_id", scopeEntityIds)
      .range(offset, offset + limit - 1)
  );

  const mappedAccountIds = mappings.map((m: { account_id: string }) => m.account_id);

  if (mappedAccountIds.length === 0) {
    return NextResponse.json({
      lineLabel: "",
      periodLabel: targetBucket.label,
      total: 0,
      groups: [],
      adjustments: [],
    } satisfies DrillDownResponse);
  }

  // Get entity info for display
  const { data: entitiesData } = await admin
    .from("entities")
    .select("id, name, code")
    .in("id", scopeEntityIds);

  const entityMap = new Map<string, { name: string; code: string }>();
  for (const e of entitiesData ?? []) {
    entityMap.set(e.id, { name: e.name, code: e.code });
  }

  // Get entity account info for display
  const { data: accountsData } = await admin
    .from("accounts")
    .select("id, name, account_number")
    .in("id", mappedAccountIds);

  const accountMap = new Map<string, { name: string; account_number: string | null }>();
  for (const a of accountsData ?? []) {
    accountMap.set(a.id, { name: a.name, account_number: a.account_number });
  }

  // ---------------------------------------------------------------------------
  // Fetch GL balances or budget amounts
  // ---------------------------------------------------------------------------

  const targetMonths = targetBucket.months;
  const uniqueYears = [...new Set(targetMonths.map((m) => m.year))];
  const uniqueMonthNums = [...new Set(targetMonths.map((m) => m.month))];
  const monthSet = new Set(
    targetMonths.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`)
  );

  // Compute prior months needed for YTD→monthly conversion.
  // QBO stores cumulative YTD in ending_balance/net_change for P&L accounts,
  // so we need the prior month's ending_balance to derive standalone monthly amounts.
  const priorMonths: Array<{ year: number; month: number }> = [];
  for (const m of targetMonths) {
    const pm = m.month === 1 ? 12 : m.month - 1;
    const py = m.month === 1 ? m.year - 1 : m.year;
    const key = `${py}-${String(pm).padStart(2, "0")}`;
    if (!monthSet.has(key)) {
      priorMonths.push({ year: py, month: pm });
    }
  }
  const glQueryMonths = [...targetMonths, ...priorMonths];
  const glQueryYears = [...new Set(glQueryMonths.map((m) => m.year))];
  const glQueryMonthNums = [...new Set(glQueryMonths.map((m) => m.month))];

  // Build mapping lookup: account_id -> { master_account_id, entity_id }
  const accountToMapping = new Map<string, { master_account_id: string; entity_id: string }>();
  for (const m of mappings ?? []) {
    accountToMapping.set(m.account_id, {
      master_account_id: m.master_account_id,
      entity_id: m.entity_id,
    });
  }

  if (columnType === "budget") {
    // Fetch budget data
    // Get active budget versions for entities in scope
    const { data: budgetVersions } = await admin
      .from("budget_versions")
      .select("id, entity_id")
      .in("entity_id", scopeEntityIds)
      .eq("is_active", true);

    const versionIds = (budgetVersions ?? []).map((v: { id: string }) => v.id);
    const entityToVersion = new Map<string, string>();
    for (const v of budgetVersions ?? []) {
      entityToVersion.set(v.entity_id, v.id);
    }

    if (versionIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const budgetAmounts = await fetchAllPaginated<any>((offset, limit) =>
        (admin as any)
          .from("budget_amounts")
          .select("budget_version_id, account_id, period_year, period_month, amount")
          .in("budget_version_id", versionIds)
          .in("account_id", mappedAccountIds)
          .in("period_year", uniqueYears)
          .in("period_month", uniqueMonthNums)
          .range(offset, offset + limit - 1)
      );

      // Build a version -> entity lookup
      const versionToEntity = new Map<string, string>();
      for (const v of budgetVersions ?? []) {
        versionToEntity.set(v.id, v.entity_id);
      }

      // Aggregate budget amounts by (master_account_id, entity_id)
      const budgetAgg = new Map<string, number>();
      for (const ba of budgetAmounts) {
        const key = `${ba.period_year}-${String(ba.period_month).padStart(2, "0")}`;
        if (!monthSet.has(key)) continue;

        const mapping = accountToMapping.get(ba.account_id);
        if (!mapping) continue;

        const aggKey = `${mapping.master_account_id}|${mapping.entity_id}|${ba.account_id}`;
        budgetAgg.set(aggKey, (budgetAgg.get(aggKey) ?? 0) + Number(ba.amount));
      }

      return buildDrillDownResponse(
        drillTargets,
        budgetAgg,
        maMap,
        entityMap,
        accountMap,
        accountToMapping,
        targetBucket,
        useNetChange,
        isCashFlowLine,
        lineId,
        sectionConfigs,
        admin,
        resolvedOrgId,
        scopeEntityIds,
        targetMonths,
        includeProForma,
        includeAllocations,
        allMasterAccountIds,
      );
    }

    // No budget data
    return NextResponse.json({
      lineLabel: "",
      periodLabel: targetBucket.label,
      total: 0,
      groups: [],
      adjustments: [],
    } satisfies DrillDownResponse);
  }

  // --- Actual column: fetch GL balances ---
  // Query includes prior months for YTD→monthly conversion
  const glRows = await fetchAllPaginated<any>((offset, limit) =>
    admin
      .from("gl_balances")
      .select("account_id, entity_id, period_year, period_month, beginning_balance, ending_balance, net_change")
      .in("account_id", mappedAccountIds)
      .in("period_year", glQueryYears)
      .in("period_month", glQueryMonthNums)
      .range(offset, offset + limit - 1)
  );

  // Index GL rows by (account_id, year-month) for prior balance lookup
  const glIndex = new Map<string, { ending_balance: number; beginning_balance: number }>();
  for (const row of glRows) {
    glIndex.set(
      `${row.account_id}|${row.period_year}-${row.period_month}`,
      { ending_balance: Number(row.ending_balance), beginning_balance: Number(row.beginning_balance) }
    );
  }

  // Filter to target months and aggregate by (master_account_id, entity_id, account_id)
  const glAgg = new Map<string, number>();
  // For cash flow we need beginning and ending balances
  const cfBeginAgg = new Map<string, number>();
  const cfEndAgg = new Map<string, number>();

  for (const row of glRows) {
    const key = `${row.period_year}-${String(row.period_month).padStart(2, "0")}`;
    if (!monthSet.has(key)) continue; // Only aggregate target months, skip prior months

    const mapping = accountToMapping.get(row.account_id);
    if (!mapping) continue;

    const aggKey = `${mapping.master_account_id}|${mapping.entity_id}|${row.account_id}`;

    if (isCashFlowLine) {
      // For cash flow: derive beginning balance from prior month's ending balance
      const pm = row.period_month === 1 ? 12 : row.period_month - 1;
      const py = row.period_month === 1 ? row.period_year - 1 : row.period_year;
      const priorRow = glIndex.get(`${row.account_id}|${py}-${pm}`);
      const beginBal = priorRow ? priorRow.ending_balance : Number(row.beginning_balance);
      cfBeginAgg.set(aggKey, (cfBeginAgg.get(aggKey) ?? 0) + beginBal);
      cfEndAgg.set(aggKey, (cfEndAgg.get(aggKey) ?? 0) + Number(row.ending_balance));
    } else if (useNetChange) {
      // P&L accounts: derive standalone monthly amount from ending balance
      // differences. QBO stores cumulative YTD in ending_balance/net_change,
      // so we subtract the prior month's ending balance to get the true
      // monthly activity (matching the main financial statements route).
      const pm = row.period_month === 1 ? 12 : row.period_month - 1;
      const py = row.period_month === 1 ? row.period_year - 1 : row.period_year;
      const priorRow = glIndex.get(`${row.account_id}|${py}-${pm}`);

      let monthlyAmount: number;
      if (row.period_month === fiscalYearStartMonth) {
        // First month of fiscal year: P&L resets, ending_balance IS standalone
        monthlyAmount = Number(row.ending_balance);
      } else if (priorRow) {
        monthlyAmount = Number(row.ending_balance) - priorRow.ending_balance;
      } else {
        // No prior month data — use ending_balance as best available
        monthlyAmount = Number(row.ending_balance);
      }

      glAgg.set(aggKey, (glAgg.get(aggKey) ?? 0) + monthlyAmount);
    } else {
      // Balance sheet: use ending balance of last month in bucket
      // We need the last month's ending balance, not a sum
      const isLastMonth =
        row.period_year === targetBucket.endYear &&
        row.period_month === targetBucket.endMonth;
      if (isLastMonth) {
        glAgg.set(aggKey, (glAgg.get(aggKey) ?? 0) + Number(row.ending_balance));
      }
    }
  }

  // For cash flow lines, compute the change and store in glAgg
  if (isCashFlowLine) {
    // Determine the sign based on the account type
    // Working capital assets: -(ending - beginning), liabilities: +(ending - beginning)
    // Investing: -(ending - beginning), Financing: +(ending - beginning)
    const isWC = lineId.startsWith("cf-wc-");
    const isInv = lineId.startsWith("cf-inv-");

    for (const aggKey of new Set([...cfBeginAgg.keys(), ...cfEndAgg.keys()])) {
      const beginBal = cfBeginAgg.get(aggKey) ?? 0;
      const endBal = cfEndAgg.get(aggKey) ?? 0;
      const change = endBal - beginBal;

      // For WC and investing, we need to check account type to determine sign
      const parts = aggKey.split("|");
      const maId = parts[0];
      const maInfo = maMap.get(maId);

      let signedChange: number;
      if (isWC) {
        // All balance sheet changes use -change to convert GL sign to cash impact.
        // Assets (debit-normal, positive in GL): increase → -change = negative (outflow) ✓
        // Liabilities (credit-normal, negative in GL): increase → -change = positive (inflow) ✓
        signedChange = -change;
      } else if (isInv) {
        signedChange = -change; // Asset increase = cash outflow
      } else {
        // Financing: liabilities & equity are credit-normal (negative in GL).
        // Negate so increase shows as cash inflow.
        signedChange = -change;
      }

      glAgg.set(aggKey, signedChange);
    }
  }

  return buildDrillDownResponse(
    drillTargets,
    glAgg,
    maMap,
    entityMap,
    accountMap,
    accountToMapping,
    targetBucket,
    useNetChange,
    isCashFlowLine,
    lineId,
    sectionConfigs,
    admin,
    resolvedOrgId,
    scopeEntityIds,
    targetMonths,
    includeProForma,
    includeAllocations,
    allMasterAccountIds,
  );
}

// ---------------------------------------------------------------------------
// Build the response
// ---------------------------------------------------------------------------

async function buildDrillDownResponse(
  drillTargets: Array<{ masterAccountIds: string[]; sign: 1 | -1; sectionLabel: string }>,
  amountAgg: Map<string, number>,
  maMap: Map<string, { name: string; account_number: string | null; classification: string }>,
  entityMap: Map<string, { name: string; code: string }>,
  accountMap: Map<string, { name: string; account_number: string | null }>,
  accountToMapping: Map<string, { master_account_id: string; entity_id: string }>,
  targetBucket: PeriodBucket,
  useNetChange: boolean,
  isCashFlowLine: boolean,
  lineId: string,
  sectionConfigs: StatementSectionConfig[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  organizationId: string,
  scopeEntityIds: string[],
  targetMonths: Array<{ year: number; month: number }>,
  includeProForma: boolean,
  includeAllocations: boolean,
  allMasterAccountIds: string[],
): Promise<NextResponse> {
  const groups: DrillDownGroup[] = [];
  let grandTotal = 0;

  for (const target of drillTargets) {
    for (const maId of target.masterAccountIds) {
      const maInfo = maMap.get(maId);
      const rows: DrillDownEntityRow[] = [];
      let subtotal = 0;

      // Find all agg entries for this master account
      for (const [aggKey, amount] of amountAgg) {
        const [keyMaId, keyEntityId, keyAccountId] = aggKey.split("|");
        if (keyMaId !== maId) continue;

        // Credit-normal accounts stored as negatives in GL, flip sign for display:
        // Revenue (P&L), Liability & Equity (Balance Sheet)
        let displayAmount = amount;
        if (useNetChange && maInfo?.classification === "Revenue") {
          displayAmount = -amount;
        } else if (!useNetChange && !isCashFlowLine && (maInfo?.classification === "Liability" || maInfo?.classification === "Equity")) {
          displayAmount = -amount;
        }

        const entityInfo = entityMap.get(keyEntityId);
        const accountInfo = accountMap.get(keyAccountId);

        rows.push({
          entityId: keyEntityId,
          entityCode: entityInfo?.code ?? keyEntityId,
          entityName: entityInfo?.name ?? keyEntityId,
          accountId: keyAccountId,
          accountName: accountInfo?.name ?? keyAccountId,
          accountNumber: accountInfo?.account_number ?? null,
          amount: displayAmount,
        });
        subtotal += displayAmount;
      }

      // Remove zero-dollar rows and sort by absolute amount descending
      const nonZeroRows = rows.filter((r) => Math.abs(r.amount) >= 0.005);

      // Sort by absolute amount descending (biggest first)
      nonZeroRows.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

      if (nonZeroRows.length > 0) {
        const filteredSubtotal = nonZeroRows.reduce((sum, r) => sum + r.amount, 0);
        const signedSubtotal = filteredSubtotal * target.sign;
        groups.push({
          masterAccountId: maId,
          masterAccountName: maInfo?.name ?? maId,
          masterAccountNumber: maInfo?.account_number ?? null,
          sectionLabel: target.sectionLabel || undefined,
          sign: target.sign,
          subtotal: signedSubtotal,
          rows: nonZeroRows,
        });
        grandTotal += signedSubtotal;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Adjustments
  // ---------------------------------------------------------------------------

  const adjustments: DrillDownAdjustmentRow[] = [];

  if (includeProForma) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const masterAccountIdSet = new Set(allMasterAccountIds);
    const maIdListPF = allMasterAccountIds.join(",");
    // Fetch adjustments where either primary or offset account is in scope
    // AND the adjustment's entity is within the current scope (entity/RE/org)
    const proFormaRows = await fetchAllPaginated<any>((offset, limit) =>
      (admin as any)
        .from("pro_forma_adjustments")
        .select(`
          id, entity_id, master_account_id, offset_master_account_id, period_year, period_month, amount, description,
          entities!inner(name, code)
        `)
        .eq("organization_id", organizationId)
        .or(`master_account_id.in.(${maIdListPF}),offset_master_account_id.in.(${maIdListPF})`)
        .eq("is_excluded", false)
        .in("entity_id", scopeEntityIds)
        .in("period_year", [...new Set(targetMonths.map((m) => m.year))])
        .in("period_month", [...new Set(targetMonths.map((m) => m.month))])
        .range(offset, offset + limit - 1)
    );

    for (const pf of proFormaRows) {
      const monthKey = `${pf.period_year}-${String(pf.period_month).padStart(2, "0")}`;
      const monthSet = new Set(
        targetMonths.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`)
      );
      if (!monthSet.has(monthKey)) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entity = pf.entities as any;

      // Primary side: if the primary account is in the drilled-down set
      if (masterAccountIdSet.has(pf.master_account_id)) {
        adjustments.push({
          type: "pro_forma",
          entityName: entity?.name ?? "",
          entityCode: entity?.code ?? "",
          description: pf.description,
          amount: Number(pf.amount),
        });
        grandTotal += Number(pf.amount);
      }

      // Offset side: if the offset account is in the drilled-down set
      if (pf.offset_master_account_id && masterAccountIdSet.has(pf.offset_master_account_id)) {
        adjustments.push({
          type: "pro_forma",
          entityName: entity?.name ?? "",
          entityCode: entity?.code ?? "",
          description: `${pf.description} (offset)`,
          amount: -Number(pf.amount),
        });
        grandTotal -= Number(pf.amount);
      }
    }
  }

  if (includeAllocations) {
    // Fetch allocations that touch any of the drilled-into master accounts
    // (either as source account or as reclass destination account)
    const maIdList = allMasterAccountIds.join(",");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allocRows = await fetchAllPaginated<any>((offset, limit) =>
      (admin as any)
        .from("allocation_adjustments")
        .select(`
          id, source_entity_id, destination_entity_id, master_account_id,
          destination_master_account_id,
          amount, description, schedule_type, period_year, period_month,
          start_year, start_month, end_year, end_month, is_repeating,
          repeat_end_year, repeat_end_month,
          source:entities!allocation_adjustments_source_entity_id_fkey(name, code),
          destination:entities!allocation_adjustments_destination_entity_id_fkey(name, code)
        `)
        .eq("organization_id", organizationId)
        .or(`master_account_id.in.(${maIdList}),destination_master_account_id.in.(${maIdList})`)
        .eq("is_excluded", false)
        .range(offset, offset + limit - 1)
    );

    for (const alloc of allocRows) {
      // Check if this allocation applies to the target months
      const appliesInPeriod = targetMonths.some((m) => {
        if (alloc.schedule_type === "single_month") {
          if (alloc.is_repeating) {
            if (alloc.period_month !== m.month) return false;
            if (alloc.period_year && m.year < alloc.period_year) return false;
            if (alloc.repeat_end_year && m.year > alloc.repeat_end_year) return false;
            return true;
          }
          return alloc.period_year === m.year && alloc.period_month === m.month;
        }
        if (alloc.schedule_type === "monthly_spread") {
          const startVal = (alloc.start_year ?? 0) * 12 + (alloc.start_month ?? 0);
          const endVal = (alloc.end_year ?? 0) * 12 + (alloc.end_month ?? 0);
          const currentVal = m.year * 12 + m.month;
          return currentVal >= startVal && currentVal <= endVal;
        }
        return false;
      });

      if (!appliesInPeriod) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const src = alloc.source as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dst = alloc.destination as any;

      // Calculate per-month amount for monthly_spread
      let monthlyAmount = Number(alloc.amount);
      if (alloc.schedule_type === "monthly_spread") {
        const startVal = (alloc.start_year ?? 0) * 12 + (alloc.start_month ?? 0);
        const endVal = (alloc.end_year ?? 0) * 12 + (alloc.end_month ?? 0);
        const totalMonths = endVal - startVal + 1;
        if (totalMonths > 0) monthlyAmount = Number(alloc.amount) / totalMonths;
      }

      // Count how many target months this allocation applies to
      const applicableMonths = targetMonths.filter((m) => {
        if (alloc.schedule_type === "single_month") {
          if (alloc.is_repeating) {
            if (alloc.period_month !== m.month) return false;
            if (alloc.period_year && m.year < alloc.period_year) return false;
            if (alloc.repeat_end_year && m.year > alloc.repeat_end_year) return false;
            return true;
          }
          return alloc.period_year === m.year && alloc.period_month === m.month;
        }
        if (alloc.schedule_type === "monthly_spread") {
          const startVal = (alloc.start_year ?? 0) * 12 + (alloc.start_month ?? 0);
          const endVal = (alloc.end_year ?? 0) * 12 + (alloc.end_month ?? 0);
          const currentVal = m.year * 12 + m.month;
          return currentVal >= startVal && currentVal <= endVal;
        }
        return false;
      });

      const totalAmount = monthlyAmount * applicableMonths.length;

      const masterAccountIdSet = new Set(allMasterAccountIds);

      if (alloc.destination_master_account_id) {
        // Intra-entity reclass: show the side that touches the drilled-into account
        const entityInScope = scopeEntityIds.includes(alloc.source_entity_id);
        if (!entityInScope) continue;

        const srcAccountMatches = masterAccountIdSet.has(alloc.master_account_id);
        const dstAccountMatches = masterAccountIdSet.has(alloc.destination_master_account_id);

        if (srcAccountMatches) {
          adjustments.push({
            type: "allocation",
            entityName: src?.name ?? "",
            entityCode: src?.code ?? "",
            description: `${alloc.description} (reclass)`,
            amount: -totalAmount,
            sourceEntityName: src?.name,
            destinationEntityName: src?.name,
          });
          grandTotal -= totalAmount;
        }

        if (dstAccountMatches) {
          adjustments.push({
            type: "allocation",
            entityName: src?.name ?? "",
            entityCode: src?.code ?? "",
            description: `${alloc.description} (reclass)`,
            amount: totalAmount,
            sourceEntityName: src?.name,
            destinationEntityName: src?.name,
          });
          grandTotal += totalAmount;
        }
      } else {
        // Inter-entity allocation (existing behavior)
        const srcInScope = scopeEntityIds.includes(alloc.source_entity_id);
        const dstInScope = scopeEntityIds.includes(alloc.destination_entity_id);

        if (srcInScope) {
          adjustments.push({
            type: "allocation",
            entityName: src?.name ?? "",
            entityCode: src?.code ?? "",
            description: alloc.description,
            amount: -totalAmount,
            sourceEntityName: src?.name,
            destinationEntityName: dst?.name,
          });
          grandTotal -= totalAmount;
        }

        if (dstInScope) {
          adjustments.push({
            type: "allocation",
            entityName: dst?.name ?? "",
            entityCode: dst?.code ?? "",
            description: alloc.description,
            amount: totalAmount,
            sourceEntityName: src?.name,
            destinationEntityName: dst?.name,
          });
          grandTotal += totalAmount;
        }
      }
    }
  }

  // Sort groups by absolute subtotal descending (biggest first)
  groups.sort((a, b) => Math.abs(b.subtotal) - Math.abs(a.subtotal));

  // Remove zero-dollar adjustments
  const nonZeroAdjustments = adjustments.filter((a) => Math.abs(a.amount) >= 0.005);

  const response: DrillDownResponse = {
    lineLabel: "",
    periodLabel: targetBucket.label,
    total: grandTotal,
    groups,
    adjustments: nonZeroAdjustments,
  };

  return NextResponse.json(response);
}
