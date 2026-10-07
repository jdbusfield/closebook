import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPeriodsInRange } from "@/lib/utils/dates";
import { fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { resolveChartIdOrDefault } from "@/lib/master-charts/resolve";
import { getExcludedFromBreakdownEntityIds } from "@/lib/db/queries/reporting-entity-exclusions";
import {
  INCOME_STATEMENT_SECTIONS,
  INCOME_STATEMENT_COMPUTED,
  BALANCE_SHEET_SECTIONS,
  BALANCE_SHEET_COMPUTED,
} from "@/lib/config/statement-sections";
import { fetchAssetCashFlows } from "@/lib/utils/asset-cash-flows";
import { fetchScheduleCashFlows } from "@/lib/utils/fixed-asset-schedule";
import type { Period, Granularity, Scope } from "@/components/financial-statements/types";
import {
  RawGLBalance,
  fetchAllGLBalances,
  collectAllMonths,
  createPriorYearBuckets,
  loadBudgetByAccount,
  RawProFormaAdjustment,
  applyProFormaPostAggregation,
  buildProFormaDetails,
  RawAllocationAdjustment,
  AllocationEntry,
  expandAllocationAdjustments,
  makeAllocDueToFromAccount,
  buildAllocationDueToFromOffsets,
  AccountInfo,
  BucketedAmounts,
  applyParentRollup,
  aggregateByBucket,
  buildStatement,
  injectNetIncomeIntoBalanceSheet,
  injectProFormaAdjustmentsIntoBalanceSheet,
  CashFlowSupplementalEntry,
  buildAllocationSupplementalEntries,
  buildCashFlowStatement,
  buildConsolidatedStatements,
} from "@/lib/financial-statements/statements-engine";

// ---------------------------------------------------------------------------
// GET handler
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
  const includeBudget = searchParams.get("includeBudget") === "true";
  const budgetKind: "budget" | "forecast" = searchParams.get("budgetKind") === "forecast" ? "forecast" : "budget";
  const includeYoY = searchParams.get("includeYoY") === "true";
  const includeProForma = searchParams.get("includeProForma") === "true";
  const includeAllocations = searchParams.get("includeAllocations") === "true";
  // Fixed-Asset Activity schedule reclass is on by default; pass "false" to hide.
  const includeFixedAssetSchedule =
    searchParams.get("includeFixedAssetSchedule") !== "false";
  const includeTotal = searchParams.get("includeTotal") === "true";
  const chartIdParam = searchParams.get("chartId");

  if (scope === "entity" && !entityId) {
    return NextResponse.json(
      { error: "entityId is required for entity scope" },
      { status: 400 }
    );
  }

  if (scope === "reporting_entity" && !reportingEntityId) {
    return NextResponse.json(
      { error: "reportingEntityId is required for reporting_entity scope" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Generate period buckets
  const buckets = getPeriodsInRange(
    startYear,
    startMonth,
    endYear,
    endMonth,
    granularity
  );

  if (buckets.length === 0) {
    return NextResponse.json(
      { error: "No periods in the specified range" },
      { status: 400 }
    );
  }

  // Append a synthetic "Total" bucket that spans all months when requested
  if (includeTotal && buckets.length > 1) {
    const allBucketMonths = buckets.flatMap((b) => b.months);
    buckets.push({
      key: "TOTAL",
      label: "Total",
      year: endYear,
      startMonth: buckets[0].startMonth,
      endMonth: buckets[buckets.length - 1].endMonth,
      endYear,
      months: allBucketMonths,
    });
  }

  // Collect all months we need to query
  const allMonths = collectAllMonths(buckets, includeYoY);

  // --- ENTITY SCOPE ---
  if (scope === "entity") {
    // Verify access
    const { data: entity } = await admin
      .from("entities")
      .select("id, name, code, organization_id, fiscal_year_end_month")
      .eq("id", entityId!)
      .single();

    if (!entity) {
      return NextResponse.json({ error: "Entity not found" }, { status: 404 });
    }

    const fyEndMonth = entity.fiscal_year_end_month ?? 12;
    const fiscalYearStartMonth = (fyEndMonth % 12) + 1;

    // Get org info
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", entity.organization_id)
      .single();

    let chartId: string;
    try {
      chartId = await resolveChartIdOrDefault(
        admin,
        entity.organization_id,
        chartIdParam,
      );
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 400 },
      );
    }

    // Get master accounts in the active chart (paginated to avoid row-limit truncation)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const masterAccounts = await fetchAllPaginated<any>((offset, limit) =>
      admin
        .from("master_accounts")
        .select("*")
        .eq("organization_id", entity.organization_id)
        .eq("chart_id", chartId)
        .eq("is_active", true)
        .order("display_order")
        .order("account_number")
        .range(offset, offset + limit - 1)
    );

    if (masterAccounts.length === 0) {
      return NextResponse.json({
        periods: [],
        incomeStatement: { id: "income_statement", title: "Income Statement", sections: [] },
        balanceSheet: { id: "balance_sheet", title: "Balance Sheet", sections: [] },
        cashFlowStatement: { id: "cash_flow", title: "Statement of Cash Flows", sections: [] },
        metadata: {
          entityName: entity.name,
          organizationName: org?.name ?? undefined,
          generatedAt: new Date().toISOString(),
          scope,
          granularity,
          startPeriod: `${startYear}-${startMonth}`,
          endPeriod: `${endYear}-${endMonth}`,
        },
      });
    }

    // Get mappings for THIS entity only
    const masterAccountIds = masterAccounts.map((ma) => ma.id);
    const mappings = await fetchAllPaginated<any>((offset, limit) =>
      admin
        .from("master_account_mappings")
        .select("master_account_id, entity_id, account_id")
        .in("master_account_id", masterAccountIds)
        .eq("entity_id", entityId!)
        .range(offset, offset + limit - 1)
    );

    // Get GL balances for mapped accounts (paginated to avoid row limit truncation)
    const mappedAccountIds = mappings.map((m) => m.account_id);
    let glBalances: RawGLBalance[] = [];
    let entityGlRawCount = 0;
    let entityGlHadErrors = false;

    if (mappedAccountIds.length > 0) {
      const uniqueYears = [...new Set(allMonths.map((m) => m.year))];
      const uniqueMonthNums = [...new Set(allMonths.map((m) => m.month))];

      const glResult = await fetchAllGLBalances(admin, {
        filterColumn: "account_id",
        filterValues: mappedAccountIds,
        years: uniqueYears,
        months: uniqueMonthNums,
      });
      entityGlRawCount = glResult.rows.length;
      entityGlHadErrors = glResult.hadErrors;

      const monthSet = new Set(
        allMonths.map(
          (m) => `${m.year}-${String(m.month).padStart(2, "0")}`
        )
      );
      // Filter to exact (year,month) pairs needed
      glBalances = glResult.rows.filter((b) =>
        monthSet.has(
          `${b.period_year}-${String(b.period_month).padStart(2, "0")}`
        )
      );
    }

    // Build mapping: master account ID -> list of entity account_ids
    const masterToEntityAccounts = new Map<string, string[]>();
    for (const m of mappings ?? []) {
      const existing = masterToEntityAccounts.get(m.master_account_id) ?? [];
      existing.push(m.account_id);
      masterToEntityAccounts.set(m.master_account_id, existing);
    }

    // Consolidate: For each master account, sum the GL balances of mapped entity accounts
    const consolidatedAccounts: AccountInfo[] = masterAccounts.map((ma) => ({
      id: ma.id,
      name: ma.name,
      accountNumber: ma.account_number,
      classification: ma.classification,
      accountType: ma.account_type,
      isIntercompany: ma.is_intercompany ?? false,
      parentAccountId: ma.parent_account_id ?? null,
    }));

    const consolidatedBalances: RawGLBalance[] = [];

    for (const ma of masterAccounts) {
      const entityAccountIds = masterToEntityAccounts.get(ma.id) ?? [];
      const entityBalances = glBalances.filter((b) =>
        entityAccountIds.includes(b.account_id)
      );

      // Group by period
      const periodMap = new Map<
        string,
        { beginning: number; ending: number; netChange: number }
      >();

      for (const b of entityBalances) {
        const key = `${b.period_year}-${b.period_month}`;
        const existing = periodMap.get(key) ?? {
          beginning: 0,
          ending: 0,
          netChange: 0,
        };
        existing.beginning += b.beginning_balance;
        existing.ending += b.ending_balance;
        existing.netChange += b.net_change;
        periodMap.set(key, existing);
      }

      for (const [key, vals] of periodMap) {
        const [y, m] = key.split("-").map(Number);
        consolidatedBalances.push({
          account_id: ma.id, // use master account ID
          entity_id: entityId!,
          period_year: y,
          period_month: m,
          beginning_balance: vals.beginning,
          ending_balance: vals.ending,
          net_change: vals.netChange,
        });
      }
    }

    // --- Pro Forma Adjustments (entity scope) ---
    // Fetch now, apply AFTER aggregation so each adjustment only appears
    // in its target period (not subsequent ones).
    let entityProFormaRows: RawProFormaAdjustment[] = [];
    if (includeProForma) {
      // Paginated to avoid PostgREST row-limit truncation
      entityProFormaRows = await fetchAllPaginated<RawProFormaAdjustment>((offset, limit) =>
        (admin as any)
          .from("pro_forma_adjustments")
          .select("id, entity_id, master_account_id, offset_master_account_id, period_year, period_month, amount, description, notes")
          .eq("entity_id", entityId!)
          .eq("is_excluded", false)
          .range(offset, offset + limit - 1)
      );
      // NOTE: intentionally NOT injected into consolidatedBalances here.
      // Applied post-aggregation below via applyProFormaPostAggregation().
    }

    // --- Allocation Adjustments (entity scope) ---
    // Applied post-aggregation (like pro forma) to avoid corrupting adjacent
    // months' net change via the ending_balance diff calculation.
    let entityAllocReclassEntries: CashFlowSupplementalEntry[] = [];
    let entityAllocEntries: AllocationEntry[] = [];
    if (includeAllocations) {
      // Fetch allocations where this entity is source or destination (paginated)
      const allocRows = await fetchAllPaginated<RawAllocationAdjustment>((offset, limit) =>
        (admin as any)
          .from("allocation_adjustments")
          .select("source_entity_id, destination_entity_id, master_account_id, destination_master_account_id, amount, description, schedule_type, period_year, period_month, start_year, start_month, end_year, end_month, is_repeating, repeat_end_year, repeat_end_month")
          .or(`source_entity_id.eq.${entityId!},destination_entity_id.eq.${entityId!}`)
          .eq("is_excluded", false)
          .range(offset, offset + limit - 1)
      );

      if (allocRows.length > 0) {
        const expanded = expandAllocationAdjustments(allocRows);
        // Only keep entries that belong to this entity
        entityAllocEntries = expanded.filter((e) => e.entity_id === entityId!);

        // Inter-entity legs are one-sided at entity scope: the counterpart
        // lives in another entity, so the net-income shift has no balance-
        // sheet offset.  Add the "Due to/from affiliates" leg to balance.
        const dueToFromOffsets = buildAllocationDueToFromOffsets(
          entityAllocEntries,
          (eid) => eid === entityId!
        );
        if (dueToFromOffsets.length > 0) {
          entityAllocEntries.push(...dueToFromOffsets);
          consolidatedAccounts.push(makeAllocDueToFromAccount());
        }

        // Build supplemental entries for intra-entity reclass allocations
        entityAllocReclassEntries = buildAllocationSupplementalEntries(allocRows, buckets);
      }
    }

    // Aggregate into buckets
    const aggregated = aggregateByBucket(
      consolidatedAccounts,
      consolidatedBalances,
      buckets,
      fiscalYearStartMonth
    );

    // Apply pro forma adjustments post-aggregation (target period only)
    if (entityProFormaRows.length > 0) {
      applyProFormaPostAggregation(aggregated, entityProFormaRows, buckets, consolidatedAccounts);
    }

    // Apply allocation adjustments post-aggregation (same reason as consolidated)
    if (entityAllocEntries.length > 0) {
      applyProFormaPostAggregation(aggregated, entityAllocEntries, buckets, consolidatedAccounts);
    }

    // Prior year aggregation for YoY
    let pyAggregated: Map<string, BucketedAmounts> | undefined;
    if (includeYoY) {
      const pyBuckets = createPriorYearBuckets(buckets);
      pyAggregated = aggregateByBucket(consolidatedAccounts, consolidatedBalances, pyBuckets, fiscalYearStartMonth);
      // Apply pro forma to prior year buckets so YoY comparisons include adjustments
      if (entityProFormaRows.length > 0) {
        applyProFormaPostAggregation(pyAggregated, entityProFormaRows, pyBuckets, consolidatedAccounts);
      }
      if (entityAllocEntries.length > 0) {
        applyProFormaPostAggregation(pyAggregated, entityAllocEntries, pyBuckets, consolidatedAccounts);
      }
    }

    // --------------- Budget data (entity scope) ---------------
    let budgetByAccount: Map<string, Record<string, number>> | undefined;

    if (includeBudget) {
      budgetByAccount = await loadBudgetByAccount(admin, {
        organizationId: entity.organization_id,
        scope: "entity",
        entityId: entityId!,
        buckets,
        accounts: consolidatedAccounts,
        kind: budgetKind,
      });
    }

    // Roll children's amounts into their parent rows. No-op when no
    // parent_account_id is set (the management chart).
    const displayAccounts = applyParentRollup(consolidatedAccounts, aggregated, buckets);
    if (pyAggregated) applyParentRollup(consolidatedAccounts, pyAggregated, buckets);

    // Build Income Statement
    const incomeStatement = buildStatement(
      "income_statement",
      "Income Statement",
      INCOME_STATEMENT_SECTIONS,
      INCOME_STATEMENT_COMPUTED,
      displayAccounts,
      aggregated,
      buckets,
      true, // use net_change
      budgetByAccount,
      pyAggregated
    );

    // Extract net income by bucket for cash flow
    const netIncomeByBucket: Record<string, number> = {};
    const pyNetIncomeByBucket: Record<string, number> = {};
    const netIncomeSection = incomeStatement.sections.find(
      (s) => s.id === "net_income"
    );
    if (netIncomeSection?.subtotalLine) {
      for (const bucket of buckets) {
        netIncomeByBucket[bucket.key] =
          netIncomeSection.subtotalLine.amounts[bucket.key] ?? 0;
        pyNetIncomeByBucket[bucket.key] =
          netIncomeSection.subtotalLine.priorYearAmounts?.[bucket.key] ?? 0;
      }
    } else {
      for (const bucket of buckets) {
        netIncomeByBucket[bucket.key] = 0;
        pyNetIncomeByBucket[bucket.key] = 0;
      }
    }

    // Build Balance Sheet (no budget data — budgets are P&L only)
    const balanceSheet = buildStatement(
      "balance_sheet",
      "Balance Sheet",
      BALANCE_SHEET_SECTIONS,
      BALANCE_SHEET_COMPUTED,
      displayAccounts,
      aggregated,
      buckets,
      false, // use ending_balance
      undefined, // no budget for BS
      pyAggregated
    );

    // Inject Net Income into BS equity so Assets = L + E
    injectNetIncomeIntoBalanceSheet(
      balanceSheet,
      displayAccounts,
      aggregated,
      buckets,
      pyAggregated
    );

    // Inject "Pro Forma Adjustments" line for amounts redirected from bank accounts
    injectProFormaAdjustmentsIntoBalanceSheet(
      balanceSheet,
      aggregated,
      buckets,
      pyAggregated
    );

    // Build supplemental entries for cash flow pro forma section
    const entityCfSupplementalEntries: CashFlowSupplementalEntry[] = [
      ...entityProFormaRows
        .map((pf) => ({
          description: pf.description,
          primaryAccountId: pf.master_account_id,
          ...(pf.offset_master_account_id ? { offsetAccountId: pf.offset_master_account_id } : {}),
          periodYear: Number(pf.period_year),
          periodMonth: Number(pf.period_month),
          amount: Number(pf.amount),
        })),
      ...entityAllocReclassEntries,
    ];

    // Build Cash Flow Statement
    // Gross capex / disposal proceeds from the fixed-asset subledger (Investing).
    const assetCashFlows = await fetchAssetCashFlows(admin, [entityId!], buckets);
    // Hand-entered Fixed-Asset Activity schedule (explains GL-only movements).
    const scheduleCashFlows = includeFixedAssetSchedule
      ? await fetchScheduleCashFlows(admin, [entityId!], buckets)
      : undefined;
    const cashFlowStatement = buildCashFlowStatement(
      displayAccounts,
      aggregated,
      buckets,
      netIncomeByBucket,
      includeYoY ? pyAggregated : undefined,
      includeYoY ? pyNetIncomeByBucket : undefined,
      entityCfSupplementalEntries.length > 0 ? entityCfSupplementalEntries : undefined,
      assetCashFlows,
      scheduleCashFlows
    );

    // Build periods array
    const periods: Period[] = buckets.map((b) => ({
      key: b.key,
      label: b.label,
      year: b.year,
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      endYear: b.endYear,
      ...(b.key === "TOTAL" ? { isTotal: true } : {}),
    }));

    // Compute server-side balance sheet check for entity scope
    const entityBsCheck: Record<string, number> = {};
    const entityTotalAssetsLine = balanceSheet.sections
      .find((s) => s.id === "total_assets")?.subtotalLine;
    const entityTotalLELine = balanceSheet.sections
      .find((s) => s.id === "total_liabilities_equity")?.subtotalLine;
    if (entityTotalAssetsLine && entityTotalLELine) {
      for (const b of buckets) {
        const assets = entityTotalAssetsLine.amounts[b.key] ?? 0;
        const le = entityTotalLELine.amounts[b.key] ?? 0;
        entityBsCheck[b.key] = Math.round((assets - le) * 100) / 100;
      }
    }

    // Build pro forma detail records for entity scope
    const entityPfLookup = new Map<string, { name: string; code: string }>();
    entityPfLookup.set(entityId!, { name: entity.name, code: entity.code });
    const entityProFormaDetails = entityProFormaRows.length > 0
      ? buildProFormaDetails(entityProFormaRows, masterAccounts, entityPfLookup, buckets)
      : undefined;

    const response = {
      periods,
      incomeStatement,
      balanceSheet,
      cashFlowStatement,
      metadata: {
        entityName: entity.name,
        organizationName: org?.name ?? undefined,
        generatedAt: new Date().toISOString(),
        scope,
        granularity,
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
      ...(entityProFormaDetails ? { proFormaAdjustments: entityProFormaDetails } : {}),
      diagnostics: {
        masterAccountsLoaded: masterAccounts.length,
        mappingsLoaded: mappings.length,
        glRowsFetchedRaw: entityGlRawCount,
        glRowsAfterFilter: glBalances.length,
        uniqueAccountsWithData: new Set(glBalances.map((b) => b.account_id)).size,
        entityCount: 1,
        paginationErrors: entityGlHadErrors,
        bsCheck: entityBsCheck,
      },
    };

    return NextResponse.json(response);
  }

  // --- ORGANIZATION SCOPE ---
  if (scope === "organization") {
    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId is required for organization scope" },
        { status: 400 }
      );
    }

    // Verify membership
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get org info
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .single();

    // Get all active entities for this org
    const { data: orgEntities } = await admin
      .from("entities")
      .select("id, fiscal_year_end_month")
      .eq("organization_id", organizationId)
      .eq("is_active", true);
    const allOrgEntityIds = (orgEntities ?? []).map(
      (e: { id: string }) => e.id,
    );
    const orgFyEnd = (orgEntities ?? [])[0]?.fiscal_year_end_month ?? 12;
    const orgFiscalYearStartMonth = (orgFyEnd % 12) + 1;

    // Drop entities that belong only to reporting entities flagged
    // `exclude_from_breakdown`. The dashboard and any other consumer of the
    // organization-scope statements treats this flag as authoritative, so
    // those entities should not contribute to consolidated revenue, EBITDA,
    // or net income totals.
    const excludedFromBreakdown = await getExcludedFromBreakdownEntityIds(
      admin,
      organizationId,
    );
    const orgEntityIds = allOrgEntityIds.filter(
      (id: string) => !excludedFromBreakdown.has(id),
    );

    let orgChartId: string;
    try {
      orgChartId = await resolveChartIdOrDefault(
        admin,
        organizationId,
        chartIdParam,
      );
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 400 },
      );
    }

    const result = await buildConsolidatedStatements({
      admin,
      organizationId,
      chartId: orgChartId,
      entityIds: orgEntityIds,
      buckets,
      allMonths,
      includeYoY,
      includeBudget,
      budgetKind,
      includeProForma,
      includeAllocations,
      includeFixedAssetSchedule,
      granularity,
      scope,
      startYear,
      startMonth,
      endYear,
      endMonth,
      fiscalYearStartMonth: orgFiscalYearStartMonth,
    });

    return NextResponse.json({
      ...result,
      metadata: {
        organizationName: org?.name ?? undefined,
        generatedAt: new Date().toISOString(),
        scope,
        granularity,
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

  // --- REPORTING ENTITY SCOPE ---
  if (scope === "reporting_entity") {
    // Fetch the reporting entity and its organization
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: reportingEntity } = await (admin as any)
      .from("reporting_entities")
      .select("id, name, code, organization_id")
      .eq("id", reportingEntityId!)
      .single();

    if (!reportingEntity) {
      return NextResponse.json(
        { error: "Reporting entity not found" },
        { status: 404 }
      );
    }

    // Verify membership
    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("organization_id", reportingEntity.organization_id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get org info
    const { data: org } = await admin
      .from("organizations")
      .select("name")
      .eq("id", reportingEntity.organization_id)
      .single();

    // Fetch member entity IDs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memberRows } = await (admin as any)
      .from("reporting_entity_members")
      .select("entity_id")
      .eq("reporting_entity_id", reportingEntityId!);

    const memberEntityIds = (memberRows ?? []).map(
      (r: { entity_id: string }) => r.entity_id
    );

    if (memberEntityIds.length === 0) {
      return NextResponse.json({
        periods: [],
        incomeStatement: { id: "income_statement", title: "Income Statement", sections: [] },
        balanceSheet: { id: "balance_sheet", title: "Balance Sheet", sections: [] },
        cashFlowStatement: { id: "cash_flow", title: "Statement of Cash Flows", sections: [] },
        metadata: {
          reportingEntityName: reportingEntity.name,
          organizationName: org?.name ?? undefined,
          generatedAt: new Date().toISOString(),
          scope,
          granularity,
          startPeriod: `${startYear}-${startMonth}`,
          endPeriod: `${endYear}-${endMonth}`,
        },
      });
    }

    // Get fiscal year end month from member entities
    const { data: reMemberEntities } = await admin
      .from("entities")
      .select("fiscal_year_end_month")
      .in("id", memberEntityIds)
      .limit(1);
    const reFyEnd = (reMemberEntities ?? [])[0]?.fiscal_year_end_month ?? 12;
    const reFiscalYearStartMonth = (reFyEnd % 12) + 1;

    let reChartId: string;
    try {
      reChartId = await resolveChartIdOrDefault(
        admin,
        reportingEntity.organization_id,
        chartIdParam,
      );
    } catch (e) {
      return NextResponse.json(
        { error: (e as Error).message },
        { status: 400 },
      );
    }

    const result = await buildConsolidatedStatements({
      admin,
      organizationId: reportingEntity.organization_id,
      chartId: reChartId,
      entityIds: memberEntityIds,
      reportingEntityId: reportingEntityId!,
      buckets,
      allMonths,
      includeYoY,
      includeBudget,
      budgetKind,
      includeProForma,
      includeAllocations,
      includeFixedAssetSchedule,
      granularity,
      scope,
      startYear,
      startMonth,
      endYear,
      endMonth,
      fiscalYearStartMonth: reFiscalYearStartMonth,
    });

    return NextResponse.json({
      ...result,
      metadata: {
        reportingEntityName: reportingEntity.name,
        organizationName: org?.name ?? undefined,
        generatedAt: new Date().toISOString(),
        scope,
        granularity,
        startPeriod: `${startYear}-${startMonth}`,
        endPeriod: `${endYear}-${endMonth}`,
      },
    });
  }

  return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
}
