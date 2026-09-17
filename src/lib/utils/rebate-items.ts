import type { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/types/database.types";

type InvoiceItemRow = Database["public"]["Tables"]["rebate_invoice_items"]["Row"];

const PAGE = 1000;

// Supabase returns at most 1000 rows per query. A customer with more line
// items than that (Jason Roberts has 1,041) used to get a different 1000-row
// subset on every recalculation, so their rebate drifted between runs. Page
// through the items in a stable order so every line is read every time.
export async function loadAllInvoiceItems(
  admin: ReturnType<typeof createAdminClient>,
  invoiceIds: string[],
) {
  if (invoiceIds.length === 0) return [] as InvoiceItemRow[];
  const all: InvoiceItemRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("rebate_invoice_items")
      .select("*")
      .in("rebate_invoice_id", invoiceIds)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}
