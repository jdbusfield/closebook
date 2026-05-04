import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllMappings, fetchAllAccounts, fetchAllPaginated } from "@/lib/utils/paginated-fetch";
import { resolveChartIdOrDefault } from "@/lib/master-charts/resolve";

// ---------------------------------------------------------------------------
// Paginated GL balance fetcher.
// Supabase PostgREST caps responses via PGRST_DB_MAX_ROWS (often 1000).
// Page size must not exceed this limit so pagination detects when more
// rows remain.
// ---------------------------------------------------------------------------

const GL_PAGE_SIZE = 1000;

interface ConsolidatedGLBalance {
  account_id: string;
  entity_id: string;
  ending_balance: number;
  debit_total: number;
  credit_total: number;
  net_change: number;
  beginning_balance: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllConsolidatedGL(
  admin: any,
  accountIds: string[],
  periodYear: number,
  periodMonth: number
): Promise<ConsolidatedGLBalance[]> {
  const allRows: ConsolidatedGLBalance[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await admin
      .from("gl_balances")
      .select(
        "account_id, entity_id, ending_balance, debit_total, credit_total, net_change, beginning_balance"
      )
      .in("account_id", accountIds)
      .eq("period_year", periodYear)
      .eq("period_month", periodMonth)
      .range(offset, offset + GL_PAGE_SIZE - 1);

    if (error) {
      console.error("GL balance pagination error:", error);
      break;
    }

    const rows = (data ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (b: any): ConsolidatedGLBalance => ({
        account_id: b.account_id,
        entity_id: b.entity_id,
        ending_balance: Number(b.ending_balance),
        debit_total: Number(b.debit_total),
        credit_total: Number(b.credit_total),
        net_change: Number(b.net_change),
        beginning_balance: Number(b.beginning_balance),
      })
    );
    allRows.push(...rows);

    if (rows.length < GL_PAGE_SIZE) {
      hasMore = false;
    } else {
      offset += GL_PAGE_SIZE;
    }
  }

  return allRows;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const organizationId = searchParams.get("organizationId");
  const periodYear = searchParams.get("periodYear");
  const periodMonth = searchParams.get("periodMonth");
  const chartIdParam = searchParams.get("chartId");

  if (!organizationId || !periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "organizationId, periodYear, and periodMonth are required" },
      { status: 400 }
    );
  }

  // Verify user has access to this organization
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("organization_id", organizationId)
    .single();

  if (!membership) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  let chartId: string;
  try {
    chartId = await resolveChartIdOrDefault(supabase, organizationId, chartIdParam);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  const adminClient = createAdminClient();

  // Get all master accounts for the organization in the selected chart
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const masterAccounts = await fetchAllPaginated<any>((offset, limit) =>
    adminClient
      .from("master_accounts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("chart_id", chartId)
      .eq("is_active", true)
      .order("classification")
      .order("display_order")
      .order("account_number")
      .range(offset, offset + limit - 1)
  );

  // Get all mappings for this organization's master accounts
  const masterAccountIds = masterAccounts.map((ma) => ma.id);

  if (masterAccountIds.length === 0) {
    return NextResponse.json({
      consolidated: [],
      totals: {
        totalAssets: 0,
        totalLiabilities: 0,
        totalEquity: 0,
        totalRevenue: 0,
        totalExpenses: 0,
      },
      unmappedAccounts: [],
    });
  }

  // Paginate mappings to avoid PostgREST max_rows (default 1000) truncation
  const mappings = await fetchAllMappings(
    adminClient,
    masterAccountIds,
    "id, master_account_id, entity_id, account_id"
  );

  // Get GL balances for the mapped accounts in the specified period (paginated)
  const accountIds = mappings.map((m) => m.account_id);

  let glBalances: ConsolidatedGLBalance[] = [];

  if (accountIds.length > 0) {
    glBalances = await fetchAllConsolidatedGL(
      adminClient,
      accountIds,
      parseInt(periodYear),
      parseInt(periodMonth)
    );
  }

  // Get entities for entity names
  const entities = await fetchAllPaginated<any>((offset, limit) =>
    adminClient
      .from("entities")
      .select("id, name, code")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .range(offset, offset + limit - 1)
  );

  // Year-end adjustments scoped to this chart. Treat each as a Dec-31 entry
  // on its master account. For Asset/Liability/Equity, the impact carries
  // forward to all subsequent periods. For Revenue/Expense, the impact
  // applies only within that fiscal year (showing on Dec accumulation).
  const reqYear = parseInt(periodYear);
  const reqMonth = parseInt(periodMonth);
  const yearAdjRows = await fetchAllPaginated<{
    master_account_id: string;
    period_year: number;
    amount: number;
  }>((offset, limit) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adminClient as any)
      .from("master_account_year_adjustments")
      .select("master_account_id, period_year, amount")
      .eq("organization_id", organizationId)
      .eq("chart_id", chartId)
      .range(offset, offset + limit - 1),
  );

  const masterById = new Map(masterAccounts.map((ma) => [ma.id, ma]));
  const yearAdjByMaster = new Map<string, number>();
  for (const adj of yearAdjRows) {
    const ma = masterById.get(adj.master_account_id);
    if (!ma) continue;
    const cls = ma.classification as string;
    const amount = Number(adj.amount);
    const adjYear = Number(adj.period_year);

    let applies = false;
    if (cls === "Asset" || cls === "Liability" || cls === "Equity") {
      // BS: applies on Dec 31 of adjYear forward
      if (reqYear > adjYear) applies = true;
      else if (reqYear === adjYear && reqMonth >= 12) applies = true;
    } else {
      // P&L: applies within adjYear only (ending_balance is YTD cumulative)
      if (reqYear === adjYear) applies = true;
    }
    if (!applies) continue;
    yearAdjByMaster.set(
      adj.master_account_id,
      (yearAdjByMaster.get(adj.master_account_id) ?? 0) + amount,
    );
  }

  // Build consolidated data: for each master account, sum the balances
  // of all mapped entity accounts
  const balancesByAccountId = new Map<
    string,
    {
      ending_balance: number;
      debit_total: number;
      credit_total: number;
      net_change: number;
      beginning_balance: number;
    }
  >();

  for (const bal of glBalances) {
    const existing = balancesByAccountId.get(bal.account_id);
    if (existing) {
      existing.ending_balance += bal.ending_balance;
      existing.debit_total += bal.debit_total;
      existing.credit_total += bal.credit_total;
      existing.net_change += bal.net_change;
      existing.beginning_balance += bal.beginning_balance;
    } else {
      balancesByAccountId.set(bal.account_id, {
        ending_balance: bal.ending_balance,
        debit_total: bal.debit_total,
        credit_total: bal.credit_total,
        net_change: bal.net_change,
        beginning_balance: bal.beginning_balance,
      });
    }
  }

  // Group mappings by master account
  const mappingsByMaster = new Map<
    string,
    Array<{ entity_id: string; account_id: string }>
  >();
  for (const m of mappings ?? []) {
    const existing = mappingsByMaster.get(m.master_account_id) ?? [];
    existing.push({ entity_id: m.entity_id, account_id: m.account_id });
    mappingsByMaster.set(m.master_account_id, existing);
  }

  // Build entity balance breakdowns for each master account
  const glBalancesByKey = new Map<string, ConsolidatedGLBalance>();
  for (const bal of glBalances) {
    glBalancesByKey.set(`${bal.account_id}:${bal.entity_id}`, bal);
  }

  const entityMap = new Map(
    (entities ?? []).map((e) => [e.id, e])
  );

  const consolidated = masterAccounts.map((ma) => {
    const accountMappings = mappingsByMaster.get(ma.id) ?? [];
    let totalEndingBalance = 0;
    let totalDebitTotal = 0;
    let totalCreditTotal = 0;
    let totalNetChange = 0;
    let totalBeginningBalance = 0;

    const entityBreakdown = accountMappings.map((mapping) => {
      const bal = glBalancesByKey.get(
        `${mapping.account_id}:${mapping.entity_id}`
      );
      const entity = entityMap.get(mapping.entity_id);

      const endingBalance = bal?.ending_balance ?? 0;
      const debitTotal = bal?.debit_total ?? 0;
      const creditTotal = bal?.credit_total ?? 0;
      const netChange = bal?.net_change ?? 0;
      const beginningBalance = bal?.beginning_balance ?? 0;

      totalEndingBalance += endingBalance;
      totalDebitTotal += debitTotal;
      totalCreditTotal += creditTotal;
      totalNetChange += netChange;
      totalBeginningBalance += beginningBalance;

      return {
        entityId: mapping.entity_id,
        entityName: entity?.name ?? "Unknown",
        entityCode: entity?.code ?? "???",
        accountId: mapping.account_id,
        endingBalance,
        debitTotal,
        creditTotal,
        netChange,
        beginningBalance,
      };
    });

    const yearAdjAmount = yearAdjByMaster.get(ma.id) ?? 0;

    return {
      masterAccountId: ma.id,
      accountNumber: ma.account_number,
      name: ma.name,
      description: ma.description,
      classification: ma.classification,
      accountType: ma.account_type,
      normalBalance: ma.normal_balance,
      mappedEntities: entityBreakdown.length,
      entityBreakdown,
      endingBalance: totalEndingBalance + yearAdjAmount,
      debitTotal: totalDebitTotal,
      creditTotal: totalCreditTotal,
      netChange: totalNetChange + yearAdjAmount,
      beginningBalance: totalBeginningBalance,
      yearAdjAmount,
    };
  });

  // Compute classification totals
  const totals = {
    totalAssets: 0,
    totalLiabilities: 0,
    totalEquity: 0,
    totalRevenue: 0,
    totalExpenses: 0,
  };

  for (const item of consolidated) {
    switch (item.classification) {
      case "Asset":
        totals.totalAssets += item.endingBalance;
        break;
      case "Liability":
        totals.totalLiabilities += item.endingBalance;
        break;
      case "Equity":
        totals.totalEquity += item.endingBalance;
        break;
      case "Revenue":
        totals.totalRevenue += item.endingBalance;
        break;
      case "Expense":
        totals.totalExpenses += item.endingBalance;
        break;
    }
  }

  // Find unmapped accounts across all entities
  const allMappedAccountIds = new Set(accountIds);
  const entityIds = (entities ?? []).map((e) => e.id);

  let unmappedAccounts: Array<{
    id: string;
    entityId: string;
    entityName: string;
    entityCode: string;
    name: string;
    accountNumber: string | null;
    classification: string;
    currentBalance: number;
  }> = [];

  if (entityIds.length > 0) {
    // Paginate accounts to avoid PostgREST max_rows truncation
    const allAccounts = await fetchAllAccounts(adminClient, entityIds);

    unmappedAccounts = (allAccounts ?? [])
      .filter((a) => !allMappedAccountIds.has(a.id))
      .map((a) => {
        const entity = entityMap.get(a.entity_id);
        return {
          id: a.id,
          entityId: a.entity_id,
          entityName: entity?.name ?? "Unknown",
          entityCode: entity?.code ?? "???",
          name: a.name,
          accountNumber: a.account_number,
          classification: a.classification,
          currentBalance: a.current_balance ?? 0,
        };
      });
  }

  return NextResponse.json({
    consolidated,
    totals,
    unmappedAccounts,
  });
}
