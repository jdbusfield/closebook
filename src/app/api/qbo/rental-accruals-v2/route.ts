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
  // Pull anything invoiced up to 3 months after the period (catches late bills)
  // and with a BillingEndDate at least as late as the period start (to catch
  // rentals that span into the period).
  const invoiceFromDate = formatRWDate(
    new Date(Date.UTC(periodYear, periodMonth - 13, 1)),
  );
  const billingFromDate = formatRWDate(
    new Date(Date.UTC(periodYear, periodMonth - 1, 1)),
  );

  // Orders: pull a wider window so we can compute unbilled earned for any
  // active order whose rental period overlaps the target month. The existing
  // revenue-projection logic uses EstimatedStartDate/EstimatedStopDate.
  const orderFromDate = formatRWDate(
    new Date(Date.UTC(periodYear, periodMonth - 3, 1)),
  );

  const [byInvoiceDate, byBillingEnd, ordersRes] = await Promise.all([
    rw.browse<RWInvoiceRowWithLocation>("invoice", {
      pagesize: 2000,
      searchfields: ["InvoiceDate"],
      searchfieldoperators: [">="],
      searchfieldvalues: [invoiceFromDate],
      searchfieldtypes: ["date"],
      orderby: "InvoiceDate",
      orderbydirection: "desc",
    }),
    rw.browse<RWInvoiceRowWithLocation>("invoice", {
      pagesize: 2000,
      searchfields: ["BillingEndDate"],
      searchfieldoperators: [">="],
      searchfieldvalues: [billingFromDate],
      searchfieldtypes: ["date"],
      orderby: "BillingEndDate",
      orderbydirection: "desc",
    }),
    rw.browse<RWOrderRowWithLocation>("order", {
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
    if (!rentalOverlaps && !invoicedInPeriod) continue;
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

  // 4. Convert to InvoiceForAccrual shape and run per-account calc
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

    const perLine = accrueInvoiceByAccount(forCalc, periodYear, periodMonth);
    allLines.push(...perLine);

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
    if (end < periodStart || start > periodEnd) continue;

    const orderTotal = toNum(ord.Total);
    if (orderTotal <= 0) continue;
    const billedAgainst = ord.OrderNumber ? orderBilledMap.get(ord.OrderNumber) ?? 0 : 0;
    const unbilledRemainder = Math.max(0, orderTotal - billedAgainst);
    if (unbilledRemainder <= 0) continue;

    // Pro-rate the unbilled remainder to the target month by calendar days
    const totalDays = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / 86400000) + 1,
    );
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

  // 6. Match GL numbers to QBO accounts for this entity
  const accountNumbers = totals.map((t) => t.glAccountNo).filter(Boolean);
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

  return NextResponse.json({
    entityId,
    periodYear,
    periodMonth,
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
