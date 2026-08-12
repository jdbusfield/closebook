import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { RentalWorksClient, type RWGLDistributionRow } from "@/lib/rentalworks/client";
import type { RWInvoiceRow, RWOrderRow } from "@/lib/utils/revenue-projection";

// RW invoice browse returns OfficeLocation ("VERSATILE - CAHUENGA") and
// WarehouseId ("A0001HBB"), but no plain "Warehouse" field. Keep a local
// alias so both are reachable without fighting the shared RWInvoiceRow type.
type RWInvoiceRowWithLocation = RWInvoiceRow & {
  OfficeLocation?: string;
  WarehouseId?: string;
};

type RWOrderRowWithLocation = RWOrderRow & {
  OfficeLocation?: string;
};

const TERMINAL_ORDER_STATUSES = new Set(["CANCELLED", "CLOSED", "VOID"]);
import {
  accrueInvoiceByAccount,
  aggregateByAccount,
  buildSplitProposedJEs,
  type InvoiceForAccrual,
  type GLDistLine,
  type AccountAccrualLine,
  type AccountAccrualTotal,
  type ProposedJELine,
} from "@/lib/utils/revenue-calc-by-account";

export const maxDuration = 120;

/**
 * POST /api/qbo/rental-accruals-v2
 *
 * Generates a proposed accrual JE for a given entity/period by:
 *   1. Pulling RW invoices whose rental period (BillingStartDate/EndDate)
 *      overlaps the target month
 *   2. Fetching the GL Distribution for each invoice (AR debit + revenue credits
 *      already mapped to GL account numbers by RentalWorks)
 *   3. Pro-rating each revenue credit by calendar days in the target month
 *      (so revenue recognition follows rental dates, not invoice dates)
 *   4. Aggregating earned/billed per GL account across all invoices
 *   5. Matching GL account numbers against the entity's synced QBO chart of
 *      accounts so a downstream JE post can reference QBO account IDs
 *
 * Body: { entityId, periodYear, periodMonth, warehouseKeywords? }
 *
 * This is preview-only. It does NOT write to Supabase or post to QBO.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { entityId, periodYear, periodMonth } = body as {
    entityId?: string;
    periodYear?: number;
    periodMonth?: number;
  };
  const warehouseKeywords: string[] = Array.isArray(body.warehouseKeywords)
    ? body.warehouseKeywords
    : ["VERSATILE", "CAHUENGA"];

  if (!entityId || !periodYear || !periodMonth) {
    return NextResponse.json(
      { error: "entityId, periodYear, and periodMonth are required" },
      { status: 400 },
    );
  }

  if (!process.env.RW_BASE_URL || !process.env.RW_USERNAME || !process.env.RW_PASSWORD) {
    return NextResponse.json(
      { error: "RentalWorks credentials not configured" },
      { status: 500 },
    );
  }

  const adminClient = createAdminClient();

  // 1. Pull invoices from RW. We widen the search window to catch invoices
  //    whose rental period overlaps the target month even if they were
  //    invoiced outside it.
  const rw = new RentalWorksClient(process.env.RW_BASE_URL);
  await rw.ensureAuth(process.env.RW_USERNAME, process.env.RW_PASSWORD);

  const periodStart = new Date(Date.UTC(periodYear, periodMonth - 1, 1));
  const periodEnd = new Date(Date.UTC(periodYear, periodMonth, 0));
  // Last day of the PRIOR month — the true-up JE reverses the prior
  // month-end balances and rebooks the current ones in a single entry.
  const priorEnd = new Date(Date.UTC(periodYear, periodMonth - 1, 0));
  const priorYear = periodMonth === 1 ? periodYear - 1 : periodYear;
  const priorMonth = periodMonth === 1 ? 12 : periodMonth - 1;
  // Pull anything invoiced up to 3 months after the period (catches late bills)
  // and with a BillingEndDate at least as late as the period start (to catch
  // rentals that span into the period).
  const invoiceFromDate = formatRWDate(
    new Date(Date.UTC(periodYear, periodMonth - 13, 1)),
  );
  const billingFromDate = formatRWDate(
    new Date(Date.UTC(periodYear, periodMonth - 1, 1)),
  );

  // Orders: pull a wide window so the point-in-time unbilled balance
  // catches old orders that finished months ago but still haven't been
  // invoiced (they stay in the Unbilled Receivable balance until billed or
  // written off). 18 months covers any realistic billing lag.
  const orderFromDate = formatRWDate(
    new Date(Date.UTC(periodYear, periodMonth - 19, 1)),
  );

  const [byInvoiceDate, byBillingEnd, ordersRes] = await Promise.all([
    rw.browseAll<RWInvoiceRowWithLocation>("invoice", {
      pagesize: 2000,
      searchfields: ["InvoiceDate"],
      searchfieldoperators: [">="],
      searchfieldvalues: [invoiceFromDate],
      searchfieldtypes: ["date"],
      orderby: "InvoiceDate",
      orderbydirection: "desc",
    }),
    rw.browseAll<RWInvoiceRowWithLocation>("invoice", {
      pagesize: 2000,
      searchfields: ["BillingEndDate"],
      searchfieldoperators: [">="],
      searchfieldvalues: [billingFromDate],
      searchfieldtypes: ["date"],
      orderby: "BillingEndDate",
      orderbydirection: "desc",
    }),
    rw.browseAll<RWOrderRowWithLocation>("order", {
      pagesize: 2000,
      searchfields: ["OrderDate"],
      searchfieldoperators: [">="],
      searchfieldvalues: [orderFromDate],
      searchfieldtypes: ["date"],
      orderby: "OrderDate",
      orderbydirection: "desc",
    }),
  ]);

  const invoiceMap = new Map<string, RWInvoiceRowWithLocation>();
  for (const r of byInvoiceDate.rows) invoiceMap.set(r.InvoiceId, r);
  for (const r of byBillingEnd.rows) {
    if (!invoiceMap.has(r.InvoiceId)) invoiceMap.set(r.InvoiceId, r);
  }

  // 2. Filter to target warehouse + relevant to target month.
  //    Assumption: ALL RW invoices flow through to QB on InvoiceDate, so
  //    status doesn't matter for the billed offset. Skip only VOID and
  //    no-charge/non-billable lines.
  //
  //    An invoice is relevant if EITHER:
  //      (a) its rental period overlaps the period → drives accruals
  //          (late-billed invoices whose revenue was earned in the period), or
  //      (b) its InvoiceDate falls inside the period → drives deferrals
  //          (billed this month but earned in a different month).
  //    Dropping (b) was the old bug: QB recognized those invoices in the
  //    period but the per-account calc never saw them, so the proposed
  //    deferral JE was short by the full prepaid/late-billed amount.
  const overlapping: RWInvoiceRowWithLocation[] = [];
  for (const inv of invoiceMap.values()) {
    const locationText = inv.OfficeLocation ?? inv.Warehouse ?? "";
    if (!matchesWarehouse(locationText, warehouseKeywords)) continue;
    const status = (inv.Status ?? "").toUpperCase();
    if (status === "VOID" || status === "VOIDED") continue;
    const isNoCharge = String(inv.IsNoCharge ?? "").toLowerCase() === "true";
    const isNonBillable = String(inv.IsNonBillable ?? "").toLowerCase() === "true";
    if (isNoCharge || isNonBillable) continue;
    const rentalStart = parseDate(inv.BillingStartDate) ?? parseDate(inv.InvoiceDate);
    const rentalEnd = parseDate(inv.BillingEndDate) ?? rentalStart;
    if (!rentalStart || !rentalEnd) continue;
    const rentalOverlaps = !(rentalEnd < periodStart || rentalStart > periodEnd);
    const invDate = parseDate(inv.InvoiceDate);
    const invoicedInPeriod =
      invDate !== null && invDate >= periodStart && invDate <= periodEnd;
    // Balance relevance for the month-end true-up:
    //   (c) billed on/before period end with rental days after period end
    //       → open deferral in the Deferred Revenue balance
    //   (d) billed after period end with rental days on/before period end
    //       → accrued at month-end (incl. old rentals billed late)
    const openDeferralAtEOM =
      invDate !== null && invDate <= periodEnd && rentalEnd > periodEnd;
    const accruedAtEOM =
      invDate !== null && invDate > periodEnd && rentalStart <= periodEnd;
    if (!rentalOverlaps && !invoicedInPeriod && !openDeferralAtEOM && !accruedAtEOM)
      continue;
    overlapping.push(inv);
  }

  // 3. Fetch GL Distribution for each overlapping invoice in batches of 5.
  //    If there are zero overlapping invoices we still continue, since unbilled
  //    earned (from active orders with no invoice yet) can still apply.
  type FetchResult =
    | { ok: true; invoice: RWInvoiceRowWithLocation; gl: RWGLDistributionRow[] }
    | { ok: false; invoice: RWInvoiceRowWithLocation; error: string };

  const fetchResults: FetchResult[] = [];
  const BATCH = 5;
  for (let i = 0; i < overlapping.length; i += BATCH) {
    const batch = overlapping.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async (inv) => {
        const res = await rw.getGLDistribution(inv.InvoiceId);
        return { invoice: inv, gl: res.rows };
      }),
    );
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      if (s.status === "fulfilled") {
        fetchResults.push({ ok: true, ...s.value });
      } else {
        fetchResults.push({
          ok: false,
          invoice: batch[j],
          error: s.reason instanceof Error ? s.reason.message : "GL fetch failed",
        });
      }
    }
  }

  // 4. Convert to InvoiceForAccrual shape and run per-account calc.
  //    Alongside the monthly FLOWS (legacy JEs), accumulate per-GL-account
  //    point-in-time BALANCES at the prior and current month-end for the
  //    true-up JE:
  //      deferred = billed on/before the as-of date, not yet earned by it
  //      accrued  = earned by the as-of date, billed after it
  const balanceSplit = new Map<
    string,
    {
      name: string;
      accruedPrior: number;
      deferredPrior: number;
      accruedCurr: number;
      deferredCurr: number;
    }
  >();
  const allLines: AccountAccrualLine[] = [];
  const invoiceDetails: Array<{
    invoiceNumber: string;
    invoiceDate: string;
    customer: string;
    status: string;
    rentalStart: string;
    rentalEnd: string;
    totalGross: number;
    earnedTotal: number;
    billedInPeriod: number;
    adjustmentAmount: number; // earnedTotal - billedInPeriod (positive = accrual, negative = deferral)
    adjustmentType: "accrual" | "deferral" | "none";
    daysInPeriod: number;
    totalRentalDays: number;
    lines: AccountAccrualLine[];
  }> = [];
  const fetchErrors: Array<{ invoiceNumber: string; error: string }> = [];

  for (const r of fetchResults) {
    if (!r.ok) {
      fetchErrors.push({ invoiceNumber: r.invoice.InvoiceNumber, error: r.error });
      continue;
    }
    const inv = r.invoice;
    const rentalStart = parseDate(inv.BillingStartDate) ?? parseDate(inv.InvoiceDate);
    const rentalEnd = parseDate(inv.BillingEndDate) ?? rentalStart;
    const invoiceDate = parseDate(inv.InvoiceDate);
    if (!rentalStart || !rentalEnd || !invoiceDate) continue;

    const glLines: GLDistLine[] = r.gl.map((g) => ({
      glAccountNo: String(g.GlAccountNo ?? ""),
      glAccountDescription: String(g.GlAccountDescription ?? ""),
      glAccountId: String(g.GlAccountId ?? ""),
      groupHeading: String(g.GroupHeading ?? ""),
      debit: toNum(g.Debit),
      credit: toNum(g.Credit),
    }));

    const forCalc: InvoiceForAccrual = {
      invoiceId: inv.InvoiceId,
      invoiceNumber: inv.InvoiceNumber,
      invoiceDate,
      rentalStart,
      rentalEnd,
      customerName: inv.Customer,
      orderDescription: inv.OrderDescription ?? "",
      glLines,
    };

    // Point-in-time balance contributions per revenue GL account
    const invTotalDays = Math.max(
      1,
      Math.round((rentalEnd.getTime() - rentalStart.getTime()) / 86400000) + 1,
    );
    const earnedFrac = (asOf: Date): number => {
      if (rentalStart > asOf) return 0;
      const capped = Math.min(rentalEnd.getTime(), asOf.getTime());
      const days = Math.round((capped - rentalStart.getTime()) / 86400000) + 1;
      return Math.min(1, days / invTotalDays);
    };
    for (const line of glLines) {
      if (!isRevenueAccount(line.glAccountNo, line.groupHeading)) continue;
      const net = (line.credit ?? 0) - (line.debit ?? 0);
      if (net === 0) continue;
      let split = balanceSplit.get(line.glAccountNo);
      if (!split) {
        split = {
          name: line.glAccountDescription,
          accruedPrior: 0,
          deferredPrior: 0,
          accruedCurr: 0,
          deferredCurr: 0,
        };
        balanceSplit.set(line.glAccountNo, split);
      }
      if (invoiceDate <= priorEnd) {
        split.deferredPrior += net * (1 - earnedFrac(priorEnd));
      } else {
        split.accruedPrior += net * earnedFrac(priorEnd);
      }
      if (invoiceDate <= periodEnd) {
        split.deferredCurr += net * (1 - earnedFrac(periodEnd));
      } else {
        split.accruedCurr += net * earnedFrac(periodEnd);
      }
    }

    const perLine = accrueInvoiceByAccount(forCalc, periodYear, periodMonth);
    // Invoices pulled in only for their balance contribution (no rental days
    // and no billing inside the period) produce all-zero flow lines — keep
    // those out of the flow aggregates so the per-GL summary stays clean.
    allLines.push(
      ...perLine.filter((l) => l.earnedRevenue !== 0 || l.billedAmount !== 0),
    );

    // Sum revenue credits (only actual revenue accounts — exclude AR, tax, etc.)
    const totalGross = glLines
      .filter((l) => isRevenueAccount(l.glAccountNo, l.groupHeading))
      .reduce((s, l) => s + (l.credit - l.debit), 0);
    const earnedTotal = perLine.reduce((s, l) => s + l.earnedRevenue, 0);
    const billedInPeriod = perLine.reduce((s, l) => s + l.billedAmount, 0);
    const daysInPeriod = perLine[0]?.daysInPeriod ?? 0;
    const totalRentalDays = perLine[0]?.totalContractValue
      ? Math.round(
          (perLine[0].totalContractValue / (perLine[0].dailyRate || 1)) * 100,
        ) / 100
      : 0;

    const adjustmentAmount = round2(earnedTotal - billedInPeriod);
    // Only show invoices where an adjustment is actually needed. If
    // earned == billed (invoice dated in period with rental fully in period,
    // or invoice dated outside with no overlap), no JE line is needed —
    // QB already has it right.
    if (Math.abs(adjustmentAmount) < 0.01) continue;

    invoiceDetails.push({
      invoiceNumber: inv.InvoiceNumber,
      invoiceDate: inv.InvoiceDate,
      customer: inv.Customer,
      status: inv.Status,
      rentalStart: inv.BillingStartDate,
      rentalEnd: inv.BillingEndDate,
      totalGross: round2(totalGross),
      earnedTotal: round2(earnedTotal),
      billedInPeriod: round2(billedInPeriod),
      adjustmentAmount,
      adjustmentType:
        adjustmentAmount > 0 ? "accrual" : adjustmentAmount < 0 ? "deferral" : "none",
      daysInPeriod,
      totalRentalDays: Math.round(totalRentalDays),
      lines: perLine,
    });
  }

  // 5. Aggregate per account
  const invoiceDrivenTotals: AccountAccrualTotal[] = aggregateByAccount(allLines);

  // 5a. Load the entity accrual config — realization rate plus the linked
  //     target accounts (Unbilled Receivables, Allowance, Accrued Revenue,
  //     Deferred Revenue, Unbilled Revenue catch-all). Falls back gracefully
  //     if migrations 20260420/20260421 haven't been applied.
  let accrualConfig:
    | {
        realization_rate: number | null;
        unbilled_receivables_account_id: string | null;
        allowance_account_id: string | null;
        accrued_revenue_account_id: string | null;
        deferred_revenue_account_id: string | null;
        unbilled_revenue_account_id: string | null;
      }
    | null = null;
  const fullCfg = await adminClient
    .from("entity_accrual_config")
    .select(
      "realization_rate, unbilled_receivables_account_id, allowance_account_id, accrued_revenue_account_id, deferred_revenue_account_id, unbilled_revenue_account_id",
    )
    .eq("entity_id", entityId)
    .maybeSingle();
  if (fullCfg.error) {
    const basicCfg = await adminClient
      .from("entity_accrual_config")
      .select("realization_rate")
      .eq("entity_id", entityId)
      .maybeSingle();
    if (basicCfg.data) {
      accrualConfig = {
        realization_rate: basicCfg.data.realization_rate,
        unbilled_receivables_account_id: null,
        allowance_account_id: null,
        accrued_revenue_account_id: null,
        deferred_revenue_account_id: null,
        unbilled_revenue_account_id: null,
      };
    }
  } else {
    accrualConfig = fullCfg.data;
  }
  const realizationRate = Number(accrualConfig?.realization_rate ?? 1);

  // OrderNumber → sum of closed invoice revenue, from the invoices we already
  // have. Mirrors the existing logic in revenue-projection.ts.
  const orderBilledMap = new Map<string, number>();
  const invByOrder = new Map<string, RWInvoiceRowWithLocation[]>();
  for (const inv of invoiceMap.values()) {
    const locText = inv.OfficeLocation ?? inv.Warehouse ?? "";
    if (!matchesWarehouse(locText, warehouseKeywords)) continue;
    const status = (inv.Status ?? "").toUpperCase();
    if (status === "VOID" || status === "VOIDED") continue;
    if (inv.OrderNumber) {
      orderBilledMap.set(
        inv.OrderNumber,
        (orderBilledMap.get(inv.OrderNumber) ?? 0) + toNum(inv.InvoiceSubTotal),
      );
      if (!invByOrder.has(inv.OrderNumber)) invByOrder.set(inv.OrderNumber, []);
      invByOrder.get(inv.OrderNumber)!.push(inv);
    }
  }

  // Active Versatile orders whose rental period overlaps the target month
  // and aren't in a terminal status. We use EstimatedStartDate/EstimatedStopDate
  // just like the existing calc does.
  const unbilledOrders: Array<{
    order: RWOrderRowWithLocation;
    orderTotal: number;
    billedAgainst: number;
    unbilledRemainder: number;
    earnedInMonth: number;
    daysInMonth: number;
    totalRentalDays: number;
    invoiceCount: number;
  }> = [];
  let unbilledEarnedGross = 0;

  // Point-in-time unbilled balances: cumulative earned-through-EOM on the
  // unbilled remainder of every non-terminal order with rental days on/before
  // the as-of date — including orders that ended months ago and were never
  // invoiced (they stay in the balance until billed or written off).
  let unbilledGrossPriorBal = 0;
  let unbilledGrossCurrBal = 0;
  const unbilledBalanceOrders: Array<{
    orderNumber: string;
    customer: string;
    description: string;
    rentalStart: string;
    rentalEnd: string;
    orderTotal: number;
    billedAgainst: number;
    unbilledRemainder: number;
    earnedThroughEOM: number;
  }> = [];

  for (const ord of ordersRes.rows) {
    if (!matchesWarehouse(ord.Warehouse ?? ord.OfficeLocation ?? "", warehouseKeywords))
      continue;
    const status = (ord.Status ?? "").toUpperCase();
    if (TERMINAL_ORDER_STATUSES.has(status)) continue;

    const startStr = (ord as unknown as { EstimatedStartDate?: string }).EstimatedStartDate;
    const stopStr = (ord as unknown as { EstimatedStopDate?: string }).EstimatedStopDate;
    const start = parseDate(startStr ?? null);
    const end = parseDate(stopStr ?? null);
    if (!start || !end) continue;
    if (start > periodEnd) continue; // no rental days by period end

    const orderTotal = toNum(ord.Total);
    if (orderTotal <= 0) continue;
    const billedAgainst = ord.OrderNumber ? orderBilledMap.get(ord.OrderNumber) ?? 0 : 0;
    const unbilledRemainder = Math.max(0, orderTotal - billedAgainst);
    if (unbilledRemainder <= 0) continue;

    const totalDays = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
    );

    // Balance contributions (cumulative through each as-of date)
    const fracThrough = (asOf: Date): number => {
      if (start > asOf) return 0;
      const capped = Math.min(end.getTime(), asOf.getTime());
      const days = Math.round((capped - start.getTime()) / 86400000) + 1;
      return Math.min(1, days / totalDays);
    };
    const earnedThroughEOM = round2(unbilledRemainder * fracThrough(periodEnd));
    unbilledGrossPriorBal += round2(unbilledRemainder * fracThrough(priorEnd));
    unbilledGrossCurrBal += earnedThroughEOM;
    if (earnedThroughEOM > 0) {
      unbilledBalanceOrders.push({
        orderNumber: ord.OrderNumber,
        customer: ord.Customer ?? "",
        description: (ord as unknown as { Description?: string }).Description ?? "",
        rentalStart: startStr ?? "",
        rentalEnd: stopStr ?? "",
        orderTotal: round2(orderTotal),
        billedAgainst: round2(billedAgainst),
        unbilledRemainder: round2(unbilledRemainder),
        earnedThroughEOM,
      });
    }

    // Monthly flow (legacy JEs): rental days inside the target month only
    if (end < periodStart) continue;
    const overlapStartMs = Math.max(start.getTime(), periodStart.getTime());
    const overlapEndMs = Math.min(end.getTime(), periodEnd.getTime());
    const daysInMonth =
      overlapEndMs >= overlapStartMs
        ? Math.round((overlapEndMs - overlapStartMs) / 86400000) + 1
        : 0;
    const dailyRate = unbilledRemainder / totalDays;
    const earnedInMonth = round2(dailyRate * daysInMonth);
    if (earnedInMonth <= 0) continue;

    unbilledEarnedGross += earnedInMonth;
    unbilledOrders.push({
      order: ord,
      orderTotal,
      billedAgainst,
      unbilledRemainder,
      earnedInMonth,
      daysInMonth,
      totalRentalDays: totalDays,
      invoiceCount: invByOrder.get(ord.OrderNumber)?.length ?? 0,
    });
  }

  const unbilledEarnedNet = round2(unbilledEarnedGross * realizationRate);
  const unbilledDiscount = round2(unbilledEarnedGross - unbilledEarnedNet);

  // 5b. Resolve configured "target" accounts (Unbilled Receivables,
  //     Allowance for Discounts, Accrued Revenue, Deferred Revenue, Unbilled
  //     Revenue catch-all) against the entity's chart. We need this BEFORE
  //     building the per-GL summary so the catch-all unbilled-revenue row
  //     can be appended with its real account number / QBO ID.
  const linkedAccountIds = [
    accrualConfig?.unbilled_receivables_account_id,
    accrualConfig?.allowance_account_id,
    accrualConfig?.accrued_revenue_account_id,
    accrualConfig?.deferred_revenue_account_id,
    accrualConfig?.unbilled_revenue_account_id,
  ].filter((id): id is string => Boolean(id));
  const linkedAccountsById: Record<
    string,
    { qbo_id: string | null; account_number: string | null; name: string; id: string }
  > = {};
  if (linkedAccountIds.length > 0) {
    const { data: linked } = await adminClient
      .from("accounts")
      .select("id, qbo_id, account_number, name")
      .in("id", linkedAccountIds);
    if (linked) {
      for (const a of linked) {
        linkedAccountsById[a.id] = {
          id: a.id,
          qbo_id: a.qbo_id ?? null,
          account_number: a.account_number ?? null,
          name: a.name,
        };
      }
    }
  }
  const linkedAccount = (id: string | null | undefined, fallbackName: string) => {
    if (!id)
      return {
        number: "",
        name: fallbackName,
        qboId: null as string | null,
        accountId: null as string | null,
      };
    const row = linkedAccountsById[id];
    if (!row)
      return { number: "", name: fallbackName, qboId: null, accountId: null };
    return {
      number: row.account_number ?? "",
      name: row.name,
      qboId: row.qbo_id,
      accountId: row.id,
    };
  };
  const unbilledArAcct = linkedAccount(
    accrualConfig?.unbilled_receivables_account_id,
    "Unbilled Receivables (Asset)",
  );
  const allowanceAcct = linkedAccount(
    accrualConfig?.allowance_account_id,
    "Allowance for Discounts (Contra-Revenue)",
  );
  const accruedRevAcct = linkedAccount(
    accrualConfig?.accrued_revenue_account_id,
    "Accrued Revenue (Asset)",
  );
  const deferredRevAcct = linkedAccount(
    accrualConfig?.deferred_revenue_account_id,
    "Deferred Revenue (Liability)",
  );
  const unbilledRevenueAcct = linkedAccount(
    accrualConfig?.unbilled_revenue_account_id,
    "Unbilled Revenue (Catch-All Income)",
  );

  // 5c. Per-account summary table merges invoice-driven exposure (timing
  //     accruals + deferrals, per real GL) with a single catch-all row for
  //     the unbilled-earned net so the Earned-this-month total ties to the
  //     JE: invoice revenue credits + catch-all revenue credit.
  const totalsWithCatchAll: AccountAccrualTotal[] = [...invoiceDrivenTotals];
  if (unbilledEarnedNet > 0) {
    const catchAllKey = unbilledRevenueAcct.number || "__catchall__";
    const existing = totalsWithCatchAll.find(
      (t) => t.glAccountNo === catchAllKey,
    );
    if (existing) {
      existing.earnedRevenue = round2(existing.earnedRevenue + unbilledEarnedNet);
      existing.accrualAmount = round2(existing.accrualAmount + unbilledEarnedNet);
      existing.lineCount += unbilledOrders.length;
    } else {
      totalsWithCatchAll.push({
        glAccountNo: unbilledRevenueAcct.number,
        glAccountDescription: unbilledRevenueAcct.name,
        glAccountId: unbilledRevenueAcct.accountId ?? "",
        earnedRevenue: unbilledEarnedNet,
        billedAmount: 0,
        accrualAmount: unbilledEarnedNet,
        deferralAmount: 0,
        lineCount: unbilledOrders.length,
      });
    }
  }
  const totals: AccountAccrualTotal[] = totalsWithCatchAll.sort((a, b) =>
    a.glAccountNo.localeCompare(b.glAccountNo),
  );

  // 6. Match GL numbers to QBO accounts for this entity (flow accounts plus
  //    any account carrying a point-in-time balance)
  const accountNumbers = Array.from(
    new Set(
      [...totals.map((t) => t.glAccountNo), ...balanceSplit.keys()].filter(Boolean),
    ),
  );
  const qboAccountMap: Record<string, { id: string; qbo_id: string | null; name: string }> = {};
  if (accountNumbers.length > 0) {
    const { data: qboAccounts } = await adminClient
      .from("accounts")
      .select("id, qbo_id, account_number, name")
      .eq("entity_id", entityId)
      .in("account_number", accountNumbers);
    if (qboAccounts) {
      for (const a of qboAccounts) {
        if (a.account_number) {
          qboAccountMap[a.account_number] = {
            id: a.id,
            qbo_id: a.qbo_id ?? null,
            name: a.name,
          };
        }
      }
    }
  }

  // For the catch-all row, we already have the linked-account QBO info from
  // the linkedAccount helper above — fall back to that when the GL number
  // doesn't show up in the per-entity accounts lookup (e.g. when the link
  // wasn't set up yet, the row uses the placeholder name with no number).
  const isCatchAllRow = (t: AccountAccrualTotal) =>
    t.glAccountDescription === unbilledRevenueAcct.name &&
    t.glAccountNo === unbilledRevenueAcct.number;
  const totalsWithQBO = totals.map((t) => {
    const direct = qboAccountMap[t.glAccountNo];
    if (direct) {
      return {
        ...t,
        qboAccountId: direct.id,
        qboQboId: direct.qbo_id,
        qboAccountName: direct.name,
        matchedToQBO: true,
      };
    }
    if (isCatchAllRow(t) && unbilledRevenueAcct.accountId) {
      return {
        ...t,
        qboAccountId: unbilledRevenueAcct.accountId,
        qboQboId: unbilledRevenueAcct.qboId,
        qboAccountName: unbilledRevenueAcct.name,
        matchedToQBO: true,
      };
    }
    return {
      ...t,
      qboAccountId: null,
      qboQboId: null,
      qboAccountName: null,
      matchedToQBO: false,
    };
  });

  // 7. Build proposed JEs — invoice timing accruals split per GL,
  //    unbilled-earned collapsed to a single catch-all credit, deferrals
  //    split per GL.
  const je = buildSplitProposedJEs(
    invoiceDrivenTotals,
    {
      grossAmount: unbilledEarnedGross,
      netAmount: unbilledEarnedNet,
    },
    periodYear,
    periodMonth,
    {
      realizationRate,
      accruedRevAccount: { number: accruedRevAcct.number, name: accruedRevAcct.name },
      unbilledArAccount: { number: unbilledArAcct.number, name: unbilledArAcct.name },
      unbilledRevenueAccount: {
        number: unbilledRevenueAcct.number,
        name: unbilledRevenueAcct.name,
      },
      deferredRevAccount: { number: deferredRevAcct.number, name: deferredRevAcct.name },
      allowanceAccount: { number: allowanceAcct.number, name: allowanceAcct.name },
    },
  );
  // Resolve each JE line's QBO ID: prefer the revenue-GL match (per-account
  // timing/deferral lines); fall back to the linked-account QBO ID for the
  // aggregate Unbilled Receivables / Accrued Revenue / Allowance / Deferred
  // Revenue / Unbilled Revenue catch-all lines.
  const qboForAggregate = (name: string): string | null => {
    if (name === unbilledArAcct.name) return unbilledArAcct.qboId;
    if (name === allowanceAcct.name) return allowanceAcct.qboId;
    if (name === accruedRevAcct.name) return accruedRevAcct.qboId;
    if (name === deferredRevAcct.name) return deferredRevAcct.qboId;
    if (name === unbilledRevenueAcct.name) return unbilledRevenueAcct.qboId;
    return null;
  };
  const withQbo = (l: ProposedJELine) => ({
    ...l,
    qboQboId: l.accountNumber
      ? qboAccountMap[l.accountNumber]?.qbo_id ?? null
      : qboForAggregate(l.accountName),
  });
  const proposedJE: {
    timingAccrual: (ProposedJELine & { qboQboId?: string | null })[];
    unbilledAccrual: (ProposedJELine & { qboQboId?: string | null })[];
    deferral: (ProposedJELine & { qboQboId?: string | null })[];
  } = {
    timingAccrual: je.timingAccrual.map(withQbo),
    unbilledAccrual: je.unbilledAccrual.map(withQbo),
    deferral: je.deferral.map(withQbo),
  };

  // 8. Month-end TRUE-UP JE. One entry that moves the four timing accounts
  //    from their prior month-end balances to the new point-in-time balances,
  //    with the offset to revenue. This single entry contains the reversal of
  //    the prior month's balances — no separate reversing entry is needed and
  //    it must NOT be set to auto-reverse.
  //
  //    Prior balances come from the snapshot saved when last month's report
  //    was generated (i.e., what the accountant was told to post). Falling
  //    back to recomputing the prior month from live RW data is only a rough
  //    approximation: orders that were unbilled at the prior close and have
  //    since been invoiced silently drop out of the recomputed balance.
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  const deferredCurrBal = round2(
    r4(Array.from(balanceSplit.values()).reduce((s, v) => s + v.deferredCurr, 0)),
  );
  const accruedCurrBal = round2(
    r4(Array.from(balanceSplit.values()).reduce((s, v) => s + v.accruedCurr, 0)),
  );
  const deferredPriorRecomputed = round2(
    r4(Array.from(balanceSplit.values()).reduce((s, v) => s + v.deferredPrior, 0)),
  );
  const accruedPriorRecomputed = round2(
    r4(Array.from(balanceSplit.values()).reduce((s, v) => s + v.accruedPrior, 0)),
  );
  const unbilledCurrBal = round2(unbilledGrossCurrBal);
  const allowanceCurrBal = round2(unbilledCurrBal * (1 - realizationRate));
  const unbilledPriorRecomputed = round2(unbilledGrossPriorBal);
  const allowancePriorRecomputed = round2(unbilledPriorRecomputed * (1 - realizationRate));

  type SnapshotSplitRow = { acct: string; name: string; accrued: number; deferred: number };
  let priorSnapshotRow: {
    deferred_balance: number;
    accrued_balance: number;
    unbilled_gross_balance: number;
    allowance_balance: number;
    revenue_split: unknown;
  } | null = null;
  let snapshotError: string | null = null;
  {
    const res = await adminClient
      .from("entity_accrual_snapshots")
      .select(
        "deferred_balance, accrued_balance, unbilled_gross_balance, allowance_balance, revenue_split",
      )
      .eq("entity_id", entityId)
      .eq("period_year", priorYear)
      .eq("period_month", priorMonth)
      .maybeSingle();
    if (res.error) snapshotError = res.error.message;
    else priorSnapshotRow = res.data;
  }

  const priorSource: "snapshot" | "recomputed" = priorSnapshotRow
    ? "snapshot"
    : "recomputed";
  const priorBal = priorSnapshotRow
    ? {
        deferred: round2(Number(priorSnapshotRow.deferred_balance)),
        accrued: round2(Number(priorSnapshotRow.accrued_balance)),
        unbilledGross: round2(Number(priorSnapshotRow.unbilled_gross_balance)),
        allowance: round2(Number(priorSnapshotRow.allowance_balance)),
      }
    : {
        deferred: deferredPriorRecomputed,
        accrued: accruedPriorRecomputed,
        unbilledGross: unbilledPriorRecomputed,
        allowance: allowancePriorRecomputed,
      };

  // Prior per-account revenue positions (accrued − deferred). From the
  // snapshot when it carries a split; from the recompute otherwise. A
  // snapshot without a split (e.g. the seeded July 2026 row, posted with a
  // single revenue line) reverses its net position on the catch-all account.
  let priorSplit: SnapshotSplitRow[] | null = null;
  if (priorSnapshotRow) {
    if (Array.isArray(priorSnapshotRow.revenue_split)) {
      priorSplit = (priorSnapshotRow.revenue_split as SnapshotSplitRow[]).filter(
        (r) => r && typeof r.acct === "string",
      );
    }
  } else {
    priorSplit = Array.from(balanceSplit.entries()).map(([acct, v]) => ({
      acct,
      name: v.name,
      accrued: round2(r4(v.accruedPrior)),
      deferred: round2(r4(v.deferredPrior)),
    }));
  }

  // Save the CURRENT month's balances as the snapshot next month reverses
  // from. Last generate wins — the accountant posts the last report sent.
  const currSplit: SnapshotSplitRow[] = Array.from(balanceSplit.entries())
    .map(([acct, v]) => ({
      acct,
      name: v.name,
      accrued: round2(r4(v.accruedCurr)),
      deferred: round2(r4(v.deferredCurr)),
    }))
    .filter((r) => r.accrued !== 0 || r.deferred !== 0);
  let snapshotSaved = false;
  if (!snapshotError) {
    const up = await adminClient.from("entity_accrual_snapshots").upsert(
      {
        entity_id: entityId,
        period_year: periodYear,
        period_month: periodMonth,
        deferred_balance: deferredCurrBal,
        accrued_balance: accruedCurrBal,
        unbilled_gross_balance: unbilledCurrBal,
        allowance_balance: allowanceCurrBal,
        realization_rate_used: realizationRate,
        revenue_split: currSplit,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "entity_id,period_year,period_month" },
    );
    if (up.error) snapshotError = up.error.message;
    else snapshotSaved = true;
  }

  // Assemble the JE lines
  const periodLabel = `${String(periodMonth).padStart(2, "0")}/${periodYear}`;
  const asOfDate = `${String(periodMonth).padStart(2, "0")}/${String(periodEnd.getUTCDate()).padStart(2, "0")}/${periodYear}`;
  const priorLabel = `${String(priorMonth).padStart(2, "0")}/${priorYear}`;
  const ratePct = Math.round(realizationRate * 1000) / 10;

  type TrueUpLine = {
    lineNo: number;
    accountNumber: string;
    accountName: string;
    qboQboId: string | null;
    debit: number;
    credit: number;
    memo: string;
  };
  const tuLines: TrueUpLine[] = [];
  const pushTU = (
    acct: { number: string; name: string; qboId: string | null },
    signedCredit: number, // positive = credit, negative = debit
    memo: string,
  ) => {
    const amt = round2(Math.abs(signedCredit));
    if (amt < 0.005) return;
    tuLines.push({
      lineNo: 0,
      accountNumber: acct.number,
      accountName: acct.name,
      qboQboId: acct.qboId,
      debit: signedCredit < 0 ? amt : 0,
      credit: signedCredit > 0 ? amt : 0,
      memo,
    });
  };

  // Balance-sheet lines: move each account from prior balance to target
  pushTU(
    { number: deferredRevAcct.number, name: deferredRevAcct.name, qboId: deferredRevAcct.qboId },
    deferredCurrBal - priorBal.deferred, // liability: increase = credit
    `Deferred Revenue to point-in-time balance ${deferredCurrBal.toFixed(2)} @ ${asOfDate}`,
  );
  pushTU(
    { number: accruedRevAcct.number, name: accruedRevAcct.name, qboId: accruedRevAcct.qboId },
    -(accruedCurrBal - priorBal.accrued), // asset: increase = debit
    `Accrued Revenue to point-in-time balance ${accruedCurrBal.toFixed(2)} @ ${asOfDate}`,
  );
  pushTU(
    { number: unbilledArAcct.number, name: unbilledArAcct.name, qboId: unbilledArAcct.qboId },
    -(unbilledCurrBal - priorBal.unbilledGross), // asset: increase = debit
    `Unbilled Receivable to gross balance ${unbilledCurrBal.toFixed(2)} @ ${asOfDate}`,
  );
  pushTU(
    { number: allowanceAcct.number, name: allowanceAcct.name, qboId: allowanceAcct.qboId },
    allowanceCurrBal - priorBal.allowance, // contra-asset: increase = credit
    `Allowance to ${(100 - ratePct).toFixed(1)}% of gross unbilled @ ${asOfDate}`,
  );

  // Revenue lines: per-account change in net timing position
  const priorPosByAcct = new Map<string, { name: string; pos: number }>();
  for (const r of priorSplit ?? []) {
    priorPosByAcct.set(r.acct, {
      name: r.name,
      pos: round2((r.accrued ?? 0) - (r.deferred ?? 0)),
    });
  }
  const revAccts = new Set<string>([
    ...Array.from(balanceSplit.keys()),
    ...Array.from(priorPosByAcct.keys()),
  ]);
  for (const acct of Array.from(revAccts).sort()) {
    const curr = balanceSplit.get(acct);
    const currPos = curr ? round2(r4(curr.accruedCurr) - r4(curr.deferredCurr)) : 0;
    const priorPos = priorPosByAcct.get(acct)?.pos ?? 0;
    const delta = round2(currPos - priorPos);
    if (Math.abs(delta) < 0.005) continue;
    const name =
      curr?.name ?? priorPosByAcct.get(acct)?.name ?? "Revenue";
    pushTU(
      {
        number: acct,
        name,
        qboId: qboAccountMap[acct]?.qbo_id ?? null,
      },
      delta, // position up = revenue credit
      `Net revenue timing change — ${periodLabel}`,
    );
  }
  // Snapshot without a per-account split: reverse its whole net position on
  // the catch-all account (the prior entry was posted with a single line).
  if (priorSnapshotRow && !priorSplit) {
    const priorNetPos = round2(priorBal.accrued - priorBal.deferred);
    pushTU(
      {
        number: unbilledRevenueAcct.number,
        name: unbilledRevenueAcct.name,
        qboId: unbilledRevenueAcct.qboId,
      },
      -priorNetPos,
      `Reversal of prior-month net revenue position (${priorLabel})`,
    );
  }

  // Catch-all plug: balances the entry. Economically this is the change in
  // net unbilled earned (gross − allowance) plus rounding cents.
  {
    const debits = round2(tuLines.reduce((s, l) => s + l.debit, 0));
    const credits = round2(tuLines.reduce((s, l) => s + l.credit, 0));
    const plug = round2(debits - credits);
    pushTU(
      {
        number: unbilledRevenueAcct.number,
        name: unbilledRevenueAcct.name,
        qboId: unbilledRevenueAcct.qboId,
      },
      plug,
      `Unbilled earned net change @ ${ratePct}% — ${periodLabel}`,
    );
  }
  tuLines.forEach((l, i) => (l.lineNo = i + 1));

  const netPos = (b: {
    deferred: number;
    accrued: number;
    unbilledGross: number;
    allowance: number;
  }) => round2(b.accrued + b.unbilledGross - b.allowance - b.deferred);
  const targetBal = {
    deferred: deferredCurrBal,
    accrued: accruedCurrBal,
    unbilledGross: unbilledCurrBal,
    allowance: allowanceCurrBal,
  };

  return NextResponse.json({
    entityId,
    periodYear,
    periodMonth,
    trueUp: {
      asOfDate,
      periodLabel,
      priorPeriod: { year: priorYear, month: priorMonth, label: priorLabel },
      priorSource,
      prior: { ...priorBal, net: netPos(priorBal) },
      target: { ...targetBal, net: netPos(targetBal) },
      // + = revenue increase this month from the entry, − = decrease
      revenueImpact: round2(netPos(targetBal) - netPos(priorBal)),
      lines: tuLines,
      snapshotSaved,
      snapshotError,
      unbilledBalanceOrders: unbilledBalanceOrders.sort(
        (a, b) => b.earnedThroughEOM - a.earnedThroughEOM,
      ),
    },
    invoicesFetched: invoiceMap.size,
    invoicesOverlapping: overlapping.length,
    glDistSuccess: fetchResults.filter((r) => r.ok).length,
    glDistFailed: fetchResults.filter((r) => !r.ok).length,
    fetchErrors: fetchErrors.slice(0, 20),
    totals: totalsWithQBO,
    proposedJE,
    invoiceDetails,
    unbilledEarned: {
      realizationRate,
      gross: round2(unbilledEarnedGross),
      discount: round2(unbilledDiscount),
      net: round2(unbilledEarnedNet),
      orderCount: unbilledOrders.length,
      catchAllAccount: {
        number: unbilledRevenueAcct.number,
        name: unbilledRevenueAcct.name,
        qboId: unbilledRevenueAcct.qboId,
        linked: Boolean(accrualConfig?.unbilled_revenue_account_id),
      },
      orders: unbilledOrders.map((u) => ({
        orderNumber: u.order.OrderNumber,
        customer: u.order.Customer ?? "",
        description:
          (u.order as unknown as { Description?: string }).Description ?? "",
        rentalStart:
          (u.order as unknown as { EstimatedStartDate?: string })
            .EstimatedStartDate ?? "",
        rentalEnd:
          (u.order as unknown as { EstimatedStopDate?: string })
            .EstimatedStopDate ?? "",
        orderTotal: round2(u.orderTotal),
        billedAgainst: round2(u.billedAgainst),
        unbilledRemainder: round2(u.unbilledRemainder),
        earnedInMonth: round2(u.earnedInMonth),
        daysInMonth: u.daysInMonth,
        totalRentalDays: u.totalRentalDays,
        invoiceCount: u.invoiceCount,
      })),
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRWDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  // RW returns ISO-like "2026-01-26" or sometimes "MM/DD/YYYY"
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return new Date(
      Date.UTC(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])),
    );
  }
  const usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    return new Date(
      Date.UTC(Number(usMatch[3]), Number(usMatch[1]) - 1, Number(usMatch[2])),
    );
  }
  return null;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function matchesWarehouse(
  warehouse: string | undefined | null,
  keywords: string[],
): boolean {
  if (!warehouse) return false;
  const w = String(warehouse).toUpperCase();
  return keywords.some((k) => w.includes(k.toUpperCase()));
}

/**
 * Only true revenue GL accounts (4xxxx in a standard US chart of accounts).
 * RentalWorks tags AR, tax payable, and COGS with GroupHeading="INCOME" too,
 * so we can't rely on group heading alone.
 */
function isRevenueAccount(glAccountNo: string, groupHeading: string): boolean {
  const acctNo = String(glAccountNo ?? "");
  if (/^[123]/.test(acctNo)) return false; // AR, inventory, liabilities, equity
  if (/^[5-9]/.test(acctNo)) return false; // COGS, expenses
  if (/^4/.test(acctNo)) return true; // revenue
  const g = (groupHeading ?? "").toUpperCase();
  return g === "REVENUE" || g === "SALES";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
