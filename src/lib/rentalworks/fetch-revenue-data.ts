/**
 * Shared helper to fetch revenue-related data from the RentalWorks API.
 * Used by both the on-demand revenue projection route and the daily cron snapshot.
 */

import type {
  RWInvoiceRow,
  RWOrderRow,
  RWQuoteRow,
} from "@/lib/utils/revenue-projection";

export interface RentalWorksRevenueData {
  invoices: RWInvoiceRow[];
  orders: RWOrderRow[];
  quotes: RWQuoteRow[];
}

function formatRWDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Authenticates to RentalWorks and fetches invoices (two date windows),
 * orders, and quotes in parallel. Deduplicates invoices by InvoiceId.
 */
export async function fetchRentalWorksRevenueData(): Promise<RentalWorksRevenueData> {
  const { RentalWorksClient } = await import("@/lib/rentalworks/client");
  const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
  await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

  // Date boundaries
  const now = new Date();
  const thirteenMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 13, 1);
  const thirtySixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 36, 1);
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);

  const invoiceStartDate = formatRWDate(thirteenMonthsAgo);
  const billingStartDate = formatRWDate(thirtySixMonthsAgo);

  // Fetch two sets of invoices + orders + quotes in parallel
  const [invoiceByDate, invoiceByBilling, orderResult, quoteResult] =
    await Promise.all([
      rw.browseAll<RWInvoiceRow>("invoice", {
        pagesize: 2000,
        searchfields: ["InvoiceDate"],
        searchfieldoperators: [">="],
        searchfieldvalues: [invoiceStartDate],
        searchfieldtypes: ["date"],
        orderby: "InvoiceDate",
        orderbydirection: "desc",
      }),
      rw.browseAll<RWInvoiceRow>("invoice", {
        pagesize: 2000,
        searchfields: ["BillingEndDate"],
        searchfieldoperators: [">="],
        searchfieldvalues: [billingStartDate],
        searchfieldtypes: ["date"],
        orderby: "BillingEndDate",
        orderbydirection: "desc",
      }),
      // Month-windowed: a single 3-month order browse exceeds the 60s function cap.
      rw.browseAllByMonthWindows<RWOrderRow>("order", "OrderDate", threeMonthsAgo, {
        pagesize: 2000,
        orderby: "OrderDate",
        orderbydirection: "desc",
      }),
      rw.browseAllByMonthWindows<RWQuoteRow>("quote", "QuoteDate", threeMonthsAgo, {
        pagesize: 2000,
        orderby: "QuoteDate",
        orderbydirection: "desc",
      }),
    ]);

  // Merge and deduplicate invoices by InvoiceId
  const invoiceMap = new Map<string, RWInvoiceRow>();
  for (const inv of invoiceByDate.rows) {
    invoiceMap.set(inv.InvoiceId, inv);
  }
  for (const inv of invoiceByBilling.rows) {
    if (!invoiceMap.has(inv.InvoiceId)) {
      invoiceMap.set(inv.InvoiceId, inv);
    }
  }

  return {
    invoices: Array.from(invoiceMap.values()),
    orders: orderResult.rows,
    quotes: quoteResult.rows,
  };
}
