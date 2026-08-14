import { classifyEquipmentType } from "./rebate-calculations";

// ─── Raw RW Browse Row Types ────────────────────────────────────────────────

export interface RWInvoiceRow {
  InvoiceId: string;
  InvoiceNumber: string;
  InvoiceDate: string;
  BillingStartDate: string;
  BillingEndDate: string;
  Status: string;
  Customer: string;
  CustomerId: string;
  Deal: string;
  OrderNumber: string;
  OrderDescription: string;
  InvoiceDescription: string;
  InvoiceListTotal: string;
  InvoiceGrossTotal: string;
  InvoiceSubTotal: string;
  InvoiceTax: string;
  InvoiceDiscountTotal: string;
  IsNoCharge: string;
  IsNonBillable: string;
  Warehouse: string;
}

export interface RWOrderRow {
  OrderId: string;
  OrderNumber: string;
  OrderDate: string;
  EstimatedStartDate: string;
  EstimatedStopDate: string;
  Description: string;
  Customer: string;
  CustomerId: string;
  Deal: string;
  Warehouse: string;
  Status: string;
  Total: string;
  NoCharge: string | boolean;
  NoChargeReason: string;
}

export interface RWQuoteRow {
  QuoteId: string;
  QuoteNumber: string;
  QuoteDate: string;
  Customer: string;
  Status: string;
  Total: string;
  Warehouse: string;
  Description: string;
}

// ─── Processed Output Types ─────────────────────────────────────────────────

export interface MonthlyRevenue {
  month: string; // "2026-01"
  label: string; // "Jan 26"
  closed: number;
  pending: number;
  pipeline: number;
  forecast: number | null; // null = no forecast for this month
  billed: number; // revenue grouped by invoice date
  earned: number; // revenue pro-rata by rental period (closed invoices only)
  accrued: number; // earned > billed → recognize extra revenue
  deferred: number; // billed > earned → defer excess to future
  unbilledEarned: number; // active orders: rental in period, not covered by any live invoice (list rate)
  unbilledOrderCount: number; // count of orders contributing to unbilledEarned
}

export interface UnbilledEarnedLine {
  orderNumber: string;
  customer: string;
  orderDescription: string;
  rentalStartDate: string;
  rentalEndDate: string;
  orderTotal: number;
  billedAgainstOrder: number; // closed + pending invoices, at list basis (subtotal + discount)
  unbilledRemainder: number;  // orderTotal - billedAgainstOrder, floored at 0
  amountInMonth: number;      // allocated portion of unbilledRemainder to this month
  month: string;              // "2026-03"
}

export interface PipelineOrder {
  orderId: string;
  orderNumber: string;
  customer: string;
  deal: string;
  description: string;
  total: number;
  status: string;
  orderDate: string;
  estimatedStartDate: string;
  estimatedStopDate: string;
  equipmentType: string;
  warehouse: string;
}

export interface PipelineQuote {
  quoteId: string;
  quoteNumber: string;
  customer: string;
  total: number;
  status: string;
  quoteDate: string;
  description: string;
  warehouse: string;
}

export interface MonthAllocation {
  month: string; // "2026-01"
  label: string; // "Jan 26"
  amount: number;
  percentage: number;
  days: number;
}

export interface ClosedInvoice {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  billingStartDate: string;
  billingEndDate: string;
  customer: string;
  deal: string;
  orderNumber: string;
  orderDescription: string;
  listTotal: number;
  grossTotal: number;
  subTotal: number;
  tax: number;
  equipmentType: string;
  status: string;
  month: string; // primary month key (start month for rental_period, group date otherwise)
  allocations?: MonthAllocation[]; // per-month breakdown (rental_period mode only)
}

export interface EquipmentBreakdown {
  type: string;
  label: string;
  amount: number;
  percentage: number;
}

export type DateMode = "invoice_date" | "billing_date" | "rental_period";

export interface RevenueProjectionResponse {
  ytdRevenue: number;
  currentMonthActual: number;
  currentMonthProjected: number;
  pipelineValue: number;
  quoteOpportunities: number;
  monthlyData: MonthlyRevenue[];
  pipelineOrders: PipelineOrder[];
  pipelineQuotes: PipelineQuote[];
  closedInvoices: ClosedInvoice[];
  unbilledOrders: PipelineOrder[];
  overdueActiveOrders: PipelineOrder[];
  equipmentBreakdown: EquipmentBreakdown[];
  unbilledEarnedLines: UnbilledEarnedLine[];
  dataAsOf: string;
  dateMode: DateMode;
}

// ─── Entity Filter Config ───────────────────────────────────────────────────
//
// Revenue data is fetched from RentalWorks org-wide (every warehouse), then
// narrowed to a single accounting entity by matching the prefix on each
// record's number. Versatile records carry a "V" prefix; the Avon Studios /
// Avon Cahuenga business — booked under "Silverco Enterprises, LLC" — carries
// "AS" / "AC" prefixes. Quotes lack a stable prefix for Versatile, so a
// warehouse-keyword fallback is supported there.

export interface EntityRevenueFilter {
  /** InvoiceNumber must start with one of these (case-insensitive). */
  invoicePrefixes: string[];
  /** OrderNumber must start with one of these (case-insensitive). */
  orderPrefixes: string[];
  /** If set, QuoteNumber must start with one of these. */
  quotePrefixes?: string[];
  /** Fallback for quotes when quotePrefixes is not set: match Warehouse. */
  quoteWarehouseKeywords?: string[];
}

export const VERSATILE_REVENUE_FILTER: EntityRevenueFilter = {
  invoicePrefixes: ["V"],
  orderPrefixes: ["V"],
  quoteWarehouseKeywords: ["VERSATILE", "CAHUENGA"],
};

export const SILVERCO_REVENUE_FILTER: EntityRevenueFilter = {
  invoicePrefixes: ["AS", "AC"],
  orderPrefixes: ["AS", "AC"],
  quotePrefixes: ["AS", "AC"],
};

/** Pick the right revenue filter for an entity by name. Defaults to Versatile. */
export function getRevenueFilterForEntity(
  entityName: string | null | undefined,
): EntityRevenueFilter {
  const name = (entityName || "").toLowerCase();
  if (name.includes("silverco")) return SILVERCO_REVENUE_FILTER;
  return VERSATILE_REVENUE_FILTER;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TERMINAL_ORDER_STATUSES = new Set([
  "CANCELLED",
  "CLOSED",
  "VOID",
]);

export const EQUIPMENT_TYPE_LABELS: Record<string, string> = {
  vehicle: "Vehicle",
  grip_lighting: "Grip & Lighting",
  studio: "Studio",
  pro_supplies: "Pro Supplies",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function warehouseMatches(
  warehouse: string | undefined | null,
  keywords: string[] | undefined,
): boolean {
  if (!warehouse || !keywords?.length) return false;
  const upper = warehouse.toUpperCase();
  return keywords.some((kw) => upper.includes(kw.toUpperCase()));
}

/** True if `s`, trimmed, starts with any of the given prefixes (case-insensitive). */
function startsWithAnyPrefix(
  s: string | undefined | null,
  prefixes: string[],
): boolean {
  if (!s) return false;
  const upper = s.trim().toUpperCase();
  return prefixes.some((p) => upper.startsWith(p.toUpperCase()));
}

function toNum(val: string | number | undefined | null): number {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

export function getMonthKey(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  // Use parseDateParts for consistent UTC handling across server & client
  const parts = parseDateParts(dateStr);
  if (!parts) return "";
  const y = parts.y;
  const m = String(parts.m + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function getMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${monthNames[Number(m) - 1]} ${y.slice(2)}`;
}

function generateMonthKeys(startMonthsAgo: number, endMonthsAhead: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let offset = -startMonthsAgo; offset <= endMonthsAhead; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    keys.push(`${y}-${m}`);
  }
  return keys;
}

interface AllocationEntry {
  amount: number;
  days: number;
}

/**
 * Parse a date string into { year, month (0-based), day } integers.
 * Handles ISO ("2026-03-01"), US slash ("03/01/2026"), and other formats.
 * Returns null if unparseable.
 */
function parseDateParts(dateStr: string): { y: number; m: number; d: number } | null {
  // Try ISO format first: "2026-03-01" or "2026-03-01T..."
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return { y: Number(isoMatch[1]), m: Number(isoMatch[2]) - 1, d: Number(isoMatch[3]) };
  }
  // Try US slash format: "03/01/2026"
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    return { y: Number(slashMatch[3]), m: Number(slashMatch[1]) - 1, d: Number(slashMatch[2]) };
  }
  // Fallback: let Date parse it, then extract UTC parts
  const fallback = new Date(dateStr);
  if (isNaN(fallback.getTime())) return null;
  return { y: fallback.getUTCFullYear(), m: fallback.getUTCMonth(), d: fallback.getUTCDate() };
}

/** Create a UTC-midnight date from year, month (0-based), day. */
function utcDate(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d);
}

const MS_PER_DAY = 86400000;

/**
 * Pro-rata allocate an amount across months based on rental period days.
 * All arithmetic uses UTC timestamps to avoid any timezone ambiguity.
 * Returns a Map of monthKey → { amount, days }.
 */
function allocateToMonths(
  startDateStr: string | null | undefined,
  endDateStr: string | null | undefined,
  amount: number,
  fallbackDateStr: string | null | undefined,
): Map<string, AllocationEntry> {
  const result = new Map<string, AllocationEntry>();
  if (amount === 0) return result;

  const startParts = startDateStr ? parseDateParts(startDateStr) : null;
  const endParts = endDateStr ? parseDateParts(endDateStr) : null;

  if (!startParts || !endParts) {
    const mk = getMonthKey(fallbackDateStr);
    if (mk) result.set(mk, { amount, days: 1 });
    return result;
  }

  const startMs = utcDate(startParts.y, startParts.m, startParts.d);
  const endMs = utcDate(endParts.y, endParts.m, endParts.d);

  if (endMs < startMs) {
    const mk = getMonthKey(fallbackDateStr);
    if (mk) result.set(mk, { amount, days: 1 });
    return result;
  }

  const totalDays = (endMs - startMs) / MS_PER_DAY + 1;
  const dailyRate = amount / totalDays;
  let allocated = 0;

  // Walk month by month from start to end
  let curY = startParts.y;
  let curM = startParts.m;
  const endY = endParts.y;
  const endM = endParts.m;

  while (curY < endY || (curY === endY && curM <= endM)) {
    const monthStartMs = utcDate(curY, curM, 1);
    // Last day of this month = day 0 of next month
    const monthEndMs = utcDate(curY, curM + 1, 0);

    const overlapStartMs = Math.max(startMs, monthStartMs);
    const overlapEndMs = Math.min(endMs, monthEndMs);
    const daysInMonth = overlapEndMs >= overlapStartMs
      ? (overlapEndMs - overlapStartMs) / MS_PER_DAY + 1
      : 0;

    if (daysInMonth > 0) {
      const mk = `${curY}-${String(curM + 1).padStart(2, "0")}`;
      const isLastMonth = curY === endY && curM === endM;
      if (isLastMonth) {
        // Assign remainder to avoid rounding drift
        result.set(mk, { amount: Math.round((amount - allocated) * 100) / 100, days: daysInMonth });
      } else {
        const monthAmount = Math.round(dailyRate * daysInMonth * 100) / 100;
        result.set(mk, { amount: monthAmount, days: daysInMonth });
        allocated += monthAmount;
      }
    }

    // Advance to next month
    curM++;
    if (curM > 11) { curM = 0; curY++; }
  }

  return result;
}

// ─── Main Processing ────────────────────────────────────────────────────────

export function processRevenueData(
  rawInvoices: RWInvoiceRow[],
  rawOrders: RWOrderRow[],
  rawQuotes: RWQuoteRow[],
  dateMode: DateMode = "invoice_date",
  filter: EntityRevenueFilter = VERSATILE_REVENUE_FILTER,
): RevenueProjectionResponse {
  const now = new Date();
  const currentMonthKey = getMonthKey(now.toISOString());
  const currentYear = now.getUTCFullYear();

  const useRentalPeriod = dateMode === "rental_period";

  // Date selector: which date to use for grouping invoices into months
  // (used for non-rental_period modes and as fallback)
  const getInvoiceGroupDate = (inv: RWInvoiceRow) =>
    dateMode === "billing_date"
      ? inv.BillingEndDate || inv.BillingStartDate || inv.InvoiceDate
      : inv.InvoiceDate;

  // --- Filter to this entity's records ---
  //
  // Orders and invoices are identified by a prefix on their number (e.g. "V"
  // for Versatile, "AS"/"AC" for Silverco's Avon Studios / Avon Cahuenga
  // business). The prefix is the authoritative entity marker — warehouse
  // matching alone would let records from other entities through when they
  // happen to share a warehouse.
  // No Charge orders never bill (e.g. Avon rentals already billed through
  // CarsPlus, marked "BILLED VIA CARSPLUS RA ..."), but RW keeps their Total
  // populated — exclude them or they inflate pipeline and unbilled earned.
  const vsOrders = rawOrders.filter(
    (o) =>
      startsWithAnyPrefix(o.OrderNumber, filter.orderPrefixes) &&
      String(o.NoCharge) !== "true",
  );

  const vsInvoices = rawInvoices.filter((inv) =>
    startsWithAnyPrefix(inv.InvoiceNumber, filter.invoicePrefixes),
  );

  // Quotes: prefer a QuoteNumber prefix match; fall back to warehouse keywords
  // for entities (like Versatile) whose quotes lack a stable prefix.
  const vsQuotes = rawQuotes.filter((q) =>
    filter.quotePrefixes?.length
      ? startsWithAnyPrefix(q.QuoteNumber, filter.quotePrefixes)
      : warehouseMatches(q.Warehouse, filter.quoteWarehouseKeywords),
  );

  // --- Filter out void/no-charge invoices ---
  const validInvoices = vsInvoices.filter((inv) => {
    const status = (inv.Status || "").toUpperCase();
    if (status === "VOID") return false;
    if (inv.IsNoCharge === "true" || inv.IsNonBillable === "true") return false;
    return true;
  });

  // --- Categorize invoices ---
  // "Processed" is a finalized status in RW, same as "Closed"
  const CLOSED_STATUSES = new Set(["CLOSED", "PROCESSED"]);
  const PENDING_STATUSES = new Set(["NEW", "APPROVED"]);

  const closedInvoices = validInvoices.filter((inv) =>
    CLOSED_STATUSES.has((inv.Status || "").toUpperCase()),
  );
  const pendingInvoices = validInvoices.filter((inv) =>
    PENDING_STATUSES.has((inv.Status || "").toUpperCase()),
  );

  // --- Build monthly buckets (12 months back + current + 3 forward) ---
  const monthKeys = generateMonthKeys(12, 3);
  const monthMap = new Map<
    string,
    { closed: number; pending: number; pipeline: number; billed: number; earned: number; unbilledEarned: number; unbilledOrderCount: number }
  >();
  for (const mk of monthKeys) {
    monthMap.set(mk, { closed: 0, pending: 0, pipeline: 0, billed: 0, earned: 0, unbilledEarned: 0, unbilledOrderCount: 0 });
  }

  // --- Compute billed (by invoice date) and earned (by rental period) for all closed invoices ---
  for (const inv of closedInvoices) {
    const amount = toNum(inv.InvoiceSubTotal);
    // Billed: always grouped by invoice date
    const billedMk = getMonthKey(inv.InvoiceDate);
    if (billedMk && monthMap.has(billedMk)) {
      monthMap.get(billedMk)!.billed += amount;
    }
    // Earned: pro-rata by rental period
    const earnedAllocs = allocateToMonths(
      inv.BillingStartDate, inv.BillingEndDate, amount, inv.InvoiceDate,
    );
    for (const [mk, entry] of earnedAllocs) {
      if (monthMap.has(mk)) monthMap.get(mk)!.earned += entry.amount;
    }
  }

  // Aggregate closed invoices by the selected date mode
  for (const inv of closedInvoices) {
    if (useRentalPeriod) {
      const allocations = allocateToMonths(
        inv.BillingStartDate, inv.BillingEndDate,
        toNum(inv.InvoiceSubTotal), inv.InvoiceDate,
      );
      for (const [mk, entry] of allocations) {
        if (monthMap.has(mk)) monthMap.get(mk)!.closed += entry.amount;
      }
    } else {
      const mk = getMonthKey(getInvoiceGroupDate(inv));
      if (mk && monthMap.has(mk)) {
        monthMap.get(mk)!.closed += toNum(inv.InvoiceSubTotal);
      }
    }
  }

  // Aggregate pending invoices by the selected date mode
  for (const inv of pendingInvoices) {
    if (useRentalPeriod) {
      const allocations = allocateToMonths(
        inv.BillingStartDate, inv.BillingEndDate,
        toNum(inv.InvoiceSubTotal), inv.InvoiceDate,
      );
      for (const [mk, entry] of allocations) {
        if (monthMap.has(mk)) monthMap.get(mk)!.pending += entry.amount;
      }
    } else {
      const mk = getMonthKey(getInvoiceGroupDate(inv));
      if (mk && monthMap.has(mk)) {
        monthMap.get(mk)!.pending += toNum(inv.InvoiceSubTotal);
      }
    }
  }

  // --- Pipeline: open orders not yet fully invoiced ---
  const activeOrders = vsOrders.filter(
    (o) => !TERMINAL_ORDER_STATUSES.has((o.Status || "").toUpperCase()),
  );

  for (const ord of activeOrders) {
    const amount = toNum(ord.Total);
    if (useRentalPeriod && ord.EstimatedStartDate && ord.EstimatedStopDate) {
      const allocations = allocateToMonths(
        ord.EstimatedStartDate, ord.EstimatedStopDate, amount, ord.OrderDate,
      );
      for (const [mk, entry] of allocations) {
        if (monthMap.has(mk)) monthMap.get(mk)!.pipeline += entry.amount;
      }
    } else if (dateMode === "billing_date" && ord.EstimatedStartDate) {
      const mk = getMonthKey(ord.EstimatedStopDate || ord.EstimatedStartDate);
      if (mk && monthMap.has(mk)) monthMap.get(mk)!.pipeline += amount;
    } else {
      const mk = getMonthKey(ord.OrderDate);
      if (mk && monthMap.has(mk)) monthMap.get(mk)!.pipeline += amount;
    }
  }

  // --- Unbilled Earned: rental occurred in-month, not yet covered by invoices ─
  // Build OrderNumber → billed-against lookup. Two deliberate choices:
  //  - Pending (NEW/APPROVED) invoices count as billed: they already appear in
  //    the "pending" series, so leaving their order fully "unbilled" too would
  //    double-count the same dollars.
  //  - Billed amounts are taken at list basis (subtotal + discount added back):
  //    Order.Total is at list rate while InvoiceSubTotal is post-discount, so
  //    differencing them directly leaves a phantom remainder on discounted
  //    orders that are in fact fully billed.
  const orderBilledMap = new Map<string, number>();
  for (const inv of [...closedInvoices, ...pendingInvoices]) {
    if (!inv.OrderNumber) continue;
    const billedAtList =
      toNum(inv.InvoiceSubTotal) + toNum(inv.InvoiceDiscountTotal);
    const prev = orderBilledMap.get(inv.OrderNumber) ?? 0;
    orderBilledMap.set(inv.OrderNumber, prev + billedAtList);
  }

  const unbilledEarnedLines: UnbilledEarnedLine[] = [];
  const monthOrderSeen = new Map<string, Set<string>>();

  for (const ord of activeOrders) {
    if (!ord.OrderNumber || !ord.EstimatedStartDate || !ord.EstimatedStopDate) continue;
    const orderTotal = toNum(ord.Total);
    if (orderTotal <= 0) continue;
    const billedAgainst = orderBilledMap.get(ord.OrderNumber) ?? 0;
    const unbilledRemainder = Math.max(0, orderTotal - billedAgainst);
    if (unbilledRemainder <= 0) continue;

    // Allocate the unbilled remainder proportionally across the rental period
    const allocations = allocateToMonths(
      ord.EstimatedStartDate, ord.EstimatedStopDate, unbilledRemainder, ord.OrderDate,
    );
    for (const [mk, entry] of allocations) {
      if (!monthMap.has(mk)) continue;
      // Only count rental activity in months at or before the current month —
      // future months are still "pipeline" forecast, not earned revenue.
      if (mk > currentMonthKey) continue;

      monthMap.get(mk)!.unbilledEarned += entry.amount;

      // Dedup order-count per month
      if (!monthOrderSeen.has(mk)) monthOrderSeen.set(mk, new Set());
      const seen = monthOrderSeen.get(mk)!;
      if (!seen.has(ord.OrderNumber)) {
        seen.add(ord.OrderNumber);
        monthMap.get(mk)!.unbilledOrderCount += 1;
      }

      unbilledEarnedLines.push({
        orderNumber: ord.OrderNumber,
        customer: ord.Customer || "",
        orderDescription: ord.Description || "",
        rentalStartDate: ord.EstimatedStartDate,
        rentalEndDate: ord.EstimatedStopDate,
        orderTotal,
        billedAgainstOrder: billedAgainst,
        unbilledRemainder,
        amountInMonth: Math.round(entry.amount * 100) / 100,
        month: mk,
      });
    }
  }

  // --- Forecast: 6-month SMA of closed revenue projected 3 months forward ---
  // Get last 6 completed months (excluding current month)
  const completedMonths = monthKeys.filter((mk) => mk < currentMonthKey);
  const last6 = completedMonths.slice(-6);
  const last6Totals = last6.map((mk) => monthMap.get(mk)?.closed ?? 0);
  const smaSum = last6Totals.reduce((a, b) => a + b, 0);
  const smaAvg = last6.length > 0 ? smaSum / last6.length : 0;

  // Future months get the forecast value
  const futureMonths = monthKeys.filter((mk) => mk > currentMonthKey);

  // --- Build MonthlyRevenue array ---
  const monthlyData: MonthlyRevenue[] = monthKeys.map((mk) => {
    const bucket = monthMap.get(mk)!;
    const isFuture = futureMonths.includes(mk);
    const diff = bucket.earned - bucket.billed;
    return {
      month: mk,
      label: getMonthLabel(mk),
      closed: bucket.closed,
      pending: bucket.pending,
      pipeline: bucket.pipeline,
      forecast: isFuture ? smaAvg : null,
      billed: Math.round(bucket.billed * 100) / 100,
      earned: Math.round(bucket.earned * 100) / 100,
      accrued: diff > 0 ? Math.round(diff * 100) / 100 : 0,
      deferred: diff < 0 ? Math.round(Math.abs(diff) * 100) / 100 : 0,
      unbilledEarned: Math.round(bucket.unbilledEarned * 100) / 100,
      unbilledOrderCount: bucket.unbilledOrderCount,
    };
  });

  // --- KPIs ---
  let ytdRevenue = 0;
  if (useRentalPeriod) {
    // Sum only the portions of revenue that fall in the current year
    const ytdMonths = monthKeys.filter((mk) => mk.startsWith(String(currentYear)));
    for (const mk of ytdMonths) {
      const bucket = monthMap.get(mk);
      ytdRevenue += (bucket?.closed ?? 0) + (bucket?.pending ?? 0);
    }
  } else {
    const allInvoicesForYtd = [...closedInvoices, ...pendingInvoices];
    ytdRevenue = allInvoicesForYtd
      .filter((inv) => {
        const parts = parseDateParts(getInvoiceGroupDate(inv));
        return parts !== null && parts.y === currentYear;
      })
      .reduce((sum, inv) => sum + toNum(inv.InvoiceSubTotal), 0);
  }

  const currentMonthBucket = monthMap.get(currentMonthKey);
  const currentMonthActual =
    (currentMonthBucket?.closed ?? 0) + (currentMonthBucket?.pending ?? 0);
  const currentMonthProjected =
    currentMonthActual +
    (currentMonthBucket?.pipeline ?? 0);

  const pipelineValue = activeOrders.reduce(
    (sum, o) => sum + toNum(o.Total),
    0,
  );

  // Active quotes
  const activeQuotes = vsQuotes.filter((q) => {
    const s = (q.Status || "").toUpperCase();
    return s === "ACTIVE" || s === "PROSPECT" || s === "OPEN";
  });
  const quoteOpportunities = activeQuotes.reduce(
    (sum, q) => sum + toNum(q.Total),
    0,
  );

  // --- Equipment breakdown (YTD invoices — closed + pending) ---
  const allInvoices = [...closedInvoices, ...pendingInvoices];
  const equipTotals: Record<string, number> = {};
  for (const inv of allInvoices) {
    const type = classifyEquipmentType(
      inv.OrderDescription || inv.InvoiceDescription || "",
    );
    if (useRentalPeriod) {
      // Only count the portion of revenue allocated to current-year months
      const allocations = allocateToMonths(
        inv.BillingStartDate, inv.BillingEndDate,
        toNum(inv.InvoiceSubTotal), inv.InvoiceDate,
      );
      for (const [mk, entry] of allocations) {
        if (mk.startsWith(String(currentYear))) {
          equipTotals[type] = (equipTotals[type] || 0) + entry.amount;
        }
      }
    } else {
      const dp = parseDateParts(getInvoiceGroupDate(inv));
      if (!dp || dp.y !== currentYear) continue;
      equipTotals[type] = (equipTotals[type] || 0) + toNum(inv.InvoiceSubTotal);
    }
  }

  const equipTotal = Object.values(equipTotals).reduce((a, b) => a + b, 0);
  const equipmentBreakdown: EquipmentBreakdown[] = Object.entries(equipTotals)
    .map(([type, amount]) => ({
      type,
      label: EQUIPMENT_TYPE_LABELS[type] || type,
      amount,
      percentage: equipTotal > 0 ? (amount / equipTotal) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // --- Pipeline tables ---
  const pipelineOrders: PipelineOrder[] = activeOrders
    .map((o) => ({
      orderId: o.OrderId,
      orderNumber: o.OrderNumber,
      customer: o.Customer,
      deal: o.Deal || "",
      description: o.Description || "",
      total: toNum(o.Total),
      status: o.Status,
      orderDate: o.OrderDate,
      estimatedStartDate: o.EstimatedStartDate || "",
      estimatedStopDate: o.EstimatedStopDate || "",
      equipmentType: classifyEquipmentType(o.Description || ""),
      warehouse: o.Warehouse,
    }))
    .sort((a, b) => b.total - a.total);

  // --- Unbilled: COMPLETE orders with no matching invoice ---
  const invoicedOrderNumbers = new Set(
    validInvoices.map((inv) => inv.OrderNumber).filter(Boolean),
  );
  const unbilledOrders: PipelineOrder[] = vsOrders
    .filter((o) => {
      const status = (o.Status || "").toUpperCase();
      return status === "COMPLETE" && !invoicedOrderNumbers.has(o.OrderNumber);
    })
    .map((o) => ({
      orderId: o.OrderId,
      orderNumber: o.OrderNumber,
      customer: o.Customer,
      deal: o.Deal || "",
      description: o.Description || "",
      total: toNum(o.Total),
      status: o.Status,
      orderDate: o.OrderDate,
      estimatedStartDate: o.EstimatedStartDate || "",
      estimatedStopDate: o.EstimatedStopDate || "",
      equipmentType: classifyEquipmentType(o.Description || ""),
      warehouse: o.Warehouse,
    }))
    .sort((a, b) => b.total - a.total);

  // --- Overdue active: non-complete active orders whose rental period has ended ---
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const overdueActiveOrders: PipelineOrder[] = vsOrders
    .filter((o) => {
      const status = (o.Status || "").toUpperCase();
      if (TERMINAL_ORDER_STATUSES.has(status) || status === "COMPLETE") return false;
      if (!o.EstimatedStopDate) return false;
      const endParts = parseDateParts(o.EstimatedStopDate);
      if (!endParts) return false;
      const endMs = utcDate(endParts.y, endParts.m, endParts.d);
      return endMs < todayMs;
    })
    .map((o) => ({
      orderId: o.OrderId,
      orderNumber: o.OrderNumber,
      customer: o.Customer,
      deal: o.Deal || "",
      description: o.Description || "",
      total: toNum(o.Total),
      status: o.Status,
      orderDate: o.OrderDate,
      estimatedStartDate: o.EstimatedStartDate || "",
      estimatedStopDate: o.EstimatedStopDate || "",
      equipmentType: classifyEquipmentType(o.Description || ""),
      warehouse: o.Warehouse,
    }))
    .sort((a, b) => b.total - a.total);

  // --- Invoices table (closed + pending) ---
  const allDisplayInvoices = [...closedInvoices, ...pendingInvoices];
  const closedInvoiceRows: ClosedInvoice[] = allDisplayInvoices
    .map((inv) => {
      let month: string;
      let allocations: MonthAllocation[] | undefined;

      if (useRentalPeriod) {
        month = getMonthKey(inv.BillingStartDate) || getMonthKey(inv.InvoiceDate);
        const allocationMap = allocateToMonths(
          inv.BillingStartDate, inv.BillingEndDate,
          toNum(inv.InvoiceSubTotal), inv.InvoiceDate,
        );
        // Only include allocations if the invoice spans multiple months
        if (allocationMap.size > 1) {
          const total = toNum(inv.InvoiceSubTotal);
          allocations = Array.from(allocationMap.entries()).map(([mk, entry]) => ({
            month: mk,
            label: getMonthLabel(mk),
            amount: entry.amount,
            percentage: total > 0 ? Math.round((entry.amount / total) * 1000) / 10 : 0,
            days: entry.days,
          }));
        }
      } else {
        month = getMonthKey(getInvoiceGroupDate(inv));
      }

      return {
        invoiceId: inv.InvoiceId,
        invoiceNumber: inv.InvoiceNumber,
        invoiceDate: inv.InvoiceDate,
        billingStartDate: inv.BillingStartDate || "",
        billingEndDate: inv.BillingEndDate || "",
        customer: inv.Customer,
        deal: inv.Deal || "",
        orderNumber: inv.OrderNumber || "",
        orderDescription: inv.OrderDescription || inv.InvoiceDescription || "",
        listTotal: toNum(inv.InvoiceSubTotal),
        grossTotal: toNum(inv.InvoiceGrossTotal),
        subTotal: toNum(inv.InvoiceSubTotal),
        tax: toNum(inv.InvoiceTax),
        equipmentType: classifyEquipmentType(
          inv.OrderDescription || inv.InvoiceDescription || "",
        ),
        status: (inv.Status || "").toUpperCase(),
        month,
        allocations,
      };
    })
    .sort((a, b) => {
      // Sort by invoice date descending (most recent first)
      return b.invoiceDate.localeCompare(a.invoiceDate);
    });

  const pipelineQuotes: PipelineQuote[] = activeQuotes
    .map((q) => ({
      quoteId: q.QuoteId || "",
      quoteNumber: q.QuoteNumber,
      customer: q.Customer,
      total: toNum(q.Total),
      status: q.Status,
      quoteDate: q.QuoteDate,
      description: q.Description || "",
      warehouse: q.Warehouse,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    ytdRevenue,
    currentMonthActual,
    currentMonthProjected,
    pipelineValue,
    quoteOpportunities,
    monthlyData,
    pipelineOrders,
    pipelineQuotes,
    closedInvoices: closedInvoiceRows,
    unbilledOrders,
    overdueActiveOrders,
    equipmentBreakdown,
    unbilledEarnedLines,
    dataAsOf: new Date().toISOString(),
    dateMode,
  };
}
