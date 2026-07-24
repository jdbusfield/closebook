/**
 * Sync RentalWorks invoice headers + line items into the Supabase cache
 * (rw_invoices_cache, rw_invoice_items).
 *
 * Strategy:
 *   1. Pull invoice headers from RW for the configured window (default: 13 mo).
 *   2. For each header, compare RW's ModifiedDateTime against the cached value.
 *      Skip if unchanged. Otherwise re-fetch line items and upsert.
 *   3. Concurrency capped to 5 to stay within RW rate limits.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { RentalWorksClient } from "@/lib/rentalworks/client";

interface RWInvoiceHeaderRow {
  InvoiceId: string;
  InvoiceNumber: string;
  InvoiceDate: string;
  BillingStartDate: string;
  BillingEndDate: string;
  Status: string;
  Customer: string;
  CustomerId: string;
  Warehouse: string;
  Deal: string;
  OrderNumber: string;
  OrderDescription: string;
  InvoiceDescription: string;
  InvoiceListTotal: string;
  InvoiceGrossTotal: string;
  InvoiceSubTotal: string;
  InvoiceTax: string;
  InvoiceDiscountTotal: string;
  ModifiedDateTime: string;
}

interface RWInvoiceItemRow {
  InvoiceItemId: string;
  ICode: string;
  Description: string;
  Quantity: string;
  Rate: string;
  Extended: string;
  RecType: string;
  ItemClass: string;
  AvailableFor: string;
  InventoryId: string;
  ItemId: string;
  Deal: string;
  OrderNumber: string;
}

const RW_DATE_FMT = (d: Date) => {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
};

const ISO_DATE = (s: string | null | undefined): string | null => {
  if (!s) return null;
  // RW returns "YYYY-MM-DD" or "MM/DD/YYYY"
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
};

const ISO_TIMESTAMP = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
};

const num = (v: string | null | undefined): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

interface SyncOptions {
  /** Months of history to keep in sync. Defaults to 13. */
  monthsBack?: number;
  /** Hard cap on invoices processed in a single run (safety). Defaults to 5000. */
  maxInvoices?: number;
  /** Concurrent invoice-item fetches. Defaults to 5. */
  concurrency?: number;
  /** If true, re-fetch every invoice's items even when ModifiedDateTime is unchanged. */
  force?: boolean;
}

export interface SyncResult {
  invoicesScanned: number;
  invoicesUpdated: number;
  invoicesSkipped: number;
  itemsUpserted: number;
  errors: { invoiceId: string; message: string }[];
  durationMs: number;
}

export async function syncRwInvoiceItems(
  options: SyncOptions = {},
): Promise<SyncResult> {
  const { monthsBack = 13, maxInvoices = 5000, concurrency = 5, force = false } = options;
  const startedAt = Date.now();

  const supabase = createAdminClient();
  const rw = new RentalWorksClient(process.env.RW_BASE_URL!);
  await rw.ensureAuth(process.env.RW_USERNAME!, process.env.RW_PASSWORD!);

  // Fetch invoice headers in the chosen window
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);
  since.setDate(1);

  const headerResult = await rw.browseAll<RWInvoiceHeaderRow>("invoice", {
    pagesize: 2000,
    searchfields: ["InvoiceDate"],
    searchfieldoperators: [">="],
    searchfieldvalues: [RW_DATE_FMT(since)],
    searchfieldtypes: ["date"],
    orderby: "InvoiceDate",
    orderbydirection: "desc",
  });

  const headers = headerResult.rows.slice(0, maxInvoices);

  // Pull existing cache rows for diff
  const ids = headers.map((h) => h.InvoiceId);
  const existingMap = new Map<string, { rw_modified_at: string | null }>();
  if (ids.length > 0) {
    // Supabase has a limit on .in() arg size — chunk to be safe
    const chunkSize = 500;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const { data } = await supabase
        .from("rw_invoices_cache")
        .select("rw_invoice_id, rw_modified_at")
        .in("rw_invoice_id", chunk);
      for (const row of data ?? []) {
        existingMap.set(row.rw_invoice_id as string, {
          rw_modified_at: row.rw_modified_at as string | null,
        });
      }
    }
  }

  const result: SyncResult = {
    invoicesScanned: headers.length,
    invoicesUpdated: 0,
    invoicesSkipped: 0,
    itemsUpserted: 0,
    errors: [],
    durationMs: 0,
  };

  // Process headers in concurrency-limited batches
  const queue = [...headers];
  async function worker() {
    while (queue.length > 0) {
      const inv = queue.shift();
      if (!inv) break;

      const modAt = ISO_TIMESTAMP(inv.ModifiedDateTime);
      const cached = existingMap.get(inv.InvoiceId);
      const unchanged =
        !force &&
        cached?.rw_modified_at &&
        modAt &&
        new Date(cached.rw_modified_at).getTime() === new Date(modAt).getTime();

      if (unchanged) {
        result.invoicesSkipped += 1;
        continue;
      }

      try {
        // Fetch line items for this invoice
        const items = await rw.browseAll<RWInvoiceItemRow>("invoiceitem", {
          pagesize: 500,
          uniqueids: { InvoiceId: inv.InvoiceId },
        });

        const invoiceDate = ISO_DATE(inv.InvoiceDate);
        const billingStart = ISO_DATE(inv.BillingStartDate);
        const billingEnd = ISO_DATE(inv.BillingEndDate);

        // Upsert header
        await supabase.from("rw_invoices_cache").upsert(
          {
            rw_invoice_id: inv.InvoiceId,
            invoice_number: inv.InvoiceNumber || null,
            invoice_date: invoiceDate,
            billing_start_date: billingStart,
            billing_end_date: billingEnd,
            status: inv.Status || null,
            customer: inv.Customer || null,
            customer_id: inv.CustomerId || null,
            warehouse: inv.Warehouse || null,
            deal: inv.Deal || null,
            order_number: inv.OrderNumber || null,
            order_description: inv.OrderDescription || null,
            invoice_description: inv.InvoiceDescription || null,
            list_total: num(inv.InvoiceListTotal),
            gross_total: num(inv.InvoiceGrossTotal),
            sub_total: num(inv.InvoiceSubTotal),
            tax_amount: num(inv.InvoiceTax),
            discount_amount: num(inv.InvoiceDiscountTotal),
            rw_modified_at: modAt,
            items_synced_at: new Date().toISOString(),
            header_synced_at: new Date().toISOString(),
          },
          { onConflict: "rw_invoice_id" },
        );

        // Replace line items for this invoice
        await supabase
          .from("rw_invoice_items")
          .delete()
          .eq("rw_invoice_id", inv.InvoiceId);

        if (items.rows.length > 0) {
          // RW occasionally returns multiple line items with the same
          // InvoiceItemId (kit subitems, blank IDs). Make the per-invoice key
          // unique by appending the row index when we detect a collision.
          const seen = new Set<string>();
          const rows = items.rows.map((it, idx) => {
            const baseId = it.InvoiceItemId || `idx-${idx}`;
            let itemId = baseId;
            if (seen.has(itemId)) itemId = `${baseId}-${idx}`;
            seen.add(itemId);
            return {
              rw_invoice_id: inv.InvoiceId,
              rw_invoice_item_id: itemId,
              invoice_number: inv.InvoiceNumber || null,
              invoice_date: invoiceDate,
              billing_start_date: billingStart,
              billing_end_date: billingEnd,
              customer: inv.Customer || null,
              warehouse: inv.Warehouse || null,
              status: inv.Status || null,
              i_code: (it.ICode || "").trim() || null,
              description: it.Description || null,
              quantity: num(it.Quantity),
              rate: num(it.Rate),
              extended: num(it.Extended),
              rec_type: (it.RecType || "").trim() || null,
              item_class: (it.ItemClass || "").trim() || null,
              inventory_id: it.InventoryId || null,
              item_id: it.ItemId || null,
              deal: it.Deal || null,
              order_number: it.OrderNumber || null,
            };
          });

          // Insert in chunks to avoid request-size limits
          const chunkSize = 200;
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const { error } = await supabase.from("rw_invoice_items").insert(chunk);
            if (error) throw new Error(error.message);
            result.itemsUpserted += chunk.length;
          }
        }

        result.invoicesUpdated += 1;
      } catch (err) {
        result.errors.push({
          invoiceId: inv.InvoiceId,
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  result.durationMs = Date.now() - startedAt;
  return result;
}
