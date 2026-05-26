import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

async function crmClient(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

export type RevenueSource = "rw" | "cars_plus";

export interface ProductionInvoiceRow {
  id: string;
  date: string;
  source: RevenueSource;
  invoice_number: string | null;
  customer: string | null;
  amount: number;
  description: string | null;
}

export interface ProductionRevenueSummary {
  ytd_revenue: number;
  lifetime_revenue: number;
  rw_lifetime: number;
  cars_plus_lifetime: number;
  invoice_count: number;
  last_invoice_date: string | null;
}

export interface RwCustomerLink {
  id: string;
  rw_customer_id: string;
  label: string | null;
  customer_name: string | null;
  created_at: string;
}

export interface ExternalCustomerLink {
  id: string;
  source: string;
  external_customer_id: string;
  label: string | null;
  created_at: string;
}

// ----------------------------------------------------------------------------
// Customer-link CRUD
// ----------------------------------------------------------------------------

export async function getProductionRwCustomerLinks(productionId: string): Promise<RwCustomerLink[]> {
  const supabase = await crmClient();
  const { data, error } = await supabase
    .from("crm_production_rw_customers")
    .select("id, rw_customer_id, label, created_at")
    .eq("production_id", productionId)
    .order("created_at");
  if (error) {
    console.error("getProductionRwCustomerLinks", error);
    return [];
  }
  const links = (data ?? []) as Array<{ id: string; rw_customer_id: string; label: string | null; created_at: string }>;
  if (links.length === 0) return [];

  // Resolve a friendly customer name from the cache (best-effort)
  const ids = Array.from(new Set(links.map(l => l.rw_customer_id)));
  const { data: cust } = await supabase
    .from("rw_invoices_cache")
    .select("customer_id, customer")
    .in("customer_id", ids);
  const nameById = new Map<string, string>();
  for (const row of (cust ?? []) as Array<{ customer_id: string | null; customer: string | null }>) {
    if (row.customer_id && row.customer && !nameById.has(row.customer_id)) {
      nameById.set(row.customer_id, row.customer);
    }
  }
  return links.map(l => ({ ...l, customer_name: nameById.get(l.rw_customer_id) ?? null }));
}

export async function getProductionExternalCustomerLinks(productionId: string): Promise<ExternalCustomerLink[]> {
  const supabase = await crmClient();
  const { data, error } = await supabase
    .from("crm_production_external_customers")
    .select("id, source, external_customer_id, label, created_at")
    .eq("production_id", productionId)
    .order("created_at");
  if (error) {
    console.error("getProductionExternalCustomerLinks", error);
    return [];
  }
  return (data ?? []) as ExternalCustomerLink[];
}

// ----------------------------------------------------------------------------
// Combined revenue queries
// ----------------------------------------------------------------------------

export async function getProductionRevenueSummary(productionId: string): Promise<ProductionRevenueSummary> {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_production_revenue_summary")
    .select("ytd_revenue, lifetime_revenue, rw_revenue_lifetime, external_revenue_lifetime, invoice_count, last_invoice_date")
    .eq("production_id", productionId)
    .maybeSingle();
  const row = data as {
    ytd_revenue: string | number | null;
    lifetime_revenue: string | number | null;
    rw_revenue_lifetime: string | number | null;
    external_revenue_lifetime: string | number | null;
    invoice_count: number | null;
    last_invoice_date: string | null;
  } | null;
  return {
    ytd_revenue: Number(row?.ytd_revenue ?? 0),
    lifetime_revenue: Number(row?.lifetime_revenue ?? 0),
    rw_lifetime: Number(row?.rw_revenue_lifetime ?? 0),
    cars_plus_lifetime: Number(row?.external_revenue_lifetime ?? 0),
    invoice_count: Number(row?.invoice_count ?? 0),
    last_invoice_date: row?.last_invoice_date && row.last_invoice_date.startsWith("1900-") ? null : (row?.last_invoice_date ?? null),
  };
}

export async function getProductionInvoices(productionId: string, opts?: { from?: string; to?: string }): Promise<ProductionInvoiceRow[]> {
  const supabase = await crmClient();
  const [rwLinks, extLinks] = await Promise.all([
    supabase.from("crm_production_rw_customers").select("rw_customer_id").eq("production_id", productionId),
    supabase.from("crm_production_external_customers").select("source, external_customer_id").eq("production_id", productionId),
  ]);
  const rwIds = ((rwLinks.data ?? []) as Array<{ rw_customer_id: string }>).map(r => r.rw_customer_id);
  const extKeys = ((extLinks.data ?? []) as Array<{ source: string; external_customer_id: string }>);

  const rwQueryP = rwIds.length === 0
    ? Promise.resolve({ data: [] as Array<{ rw_invoice_id: string; invoice_number: string | null; invoice_date: string | null; customer: string | null; gross_total: string | number | null; invoice_description: string | null }> })
    : (async () => {
        let q = supabase
          .from("rw_invoices_cache")
          .select("rw_invoice_id, invoice_number, invoice_date, customer, gross_total, invoice_description")
          .in("customer_id", rwIds)
          .order("invoice_date", { ascending: false });
        if (opts?.from) q = q.gte("invoice_date", opts.from);
        if (opts?.to)   q = q.lte("invoice_date", opts.to);
        const { data } = await q;
        return { data: (data ?? []) as Array<{ rw_invoice_id: string; invoice_number: string | null; invoice_date: string | null; customer: string | null; gross_total: string | number | null; invoice_description: string | null }> };
      })();

  const extQueryP = extKeys.length === 0
    ? Promise.resolve({ data: [] as Array<{ id: string; invoice_number: string | null; invoice_date: string; customer_name: string | null; amount: string | number; description: string | null }> })
    : (async () => {
        const ids = extKeys.map(k => k.external_customer_id);
        let q = supabase
          .from("crm_external_invoices")
          .select("id, invoice_number, invoice_date, customer_name, amount, description")
          .in("external_customer_id", ids)
          .order("invoice_date", { ascending: false });
        if (opts?.from) q = q.gte("invoice_date", opts.from);
        if (opts?.to)   q = q.lte("invoice_date", opts.to);
        const { data } = await q;
        return { data: (data ?? []) as Array<{ id: string; invoice_number: string | null; invoice_date: string; customer_name: string | null; amount: string | number; description: string | null }> };
      })();

  const [rwRes, extRes] = await Promise.all([rwQueryP, extQueryP]);

  const rwRows: ProductionInvoiceRow[] = rwRes.data
    .filter(r => r.invoice_date)
    .map(r => ({
      id: `rw:${r.rw_invoice_id}`,
      date: r.invoice_date!,
      source: "rw" as const,
      invoice_number: r.invoice_number,
      customer: r.customer,
      amount: Number(r.gross_total ?? 0),
      description: r.invoice_description,
    }));

  const extRows: ProductionInvoiceRow[] = extRes.data.map(r => ({
    id: `ext:${r.id}`,
    date: r.invoice_date,
    source: "cars_plus" as const,
    invoice_number: r.invoice_number,
    customer: r.customer_name,
    amount: Number(r.amount ?? 0),
    description: r.description,
  }));

  return [...rwRows, ...extRows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export interface MonthlyRevenueBucket {
  month: string; // YYYY-MM
  rw: number;
  cars_plus: number;
  total: number;
}

export async function getProductionRevenueByMonth(productionId: string, months = 12): Promise<MonthlyRevenueBucket[]> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const from = start.toISOString().slice(0, 10);

  const invoices = await getProductionInvoices(productionId, { from });
  const map = new Map<string, MonthlyRevenueBucket>();

  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, { month: key, rw: 0, cars_plus: 0, total: 0 });
  }

  for (const inv of invoices) {
    const key = inv.date.slice(0, 7);
    const bucket = map.get(key);
    if (!bucket) continue;
    if (inv.source === "rw") bucket.rw += inv.amount;
    else bucket.cars_plus += inv.amount;
    bucket.total += inv.amount;
  }

  return Array.from(map.values());
}

// ----------------------------------------------------------------------------
// CRM-wide revenue list
// ----------------------------------------------------------------------------

export interface ProductionRevenueListRow {
  production_id: string;
  name: string;
  status: string;
  ytd_revenue: number;
  lifetime_revenue: number;
  invoice_count: number;
  last_invoice_date: string | null;
  owner_id: string | null;
  owner_name: string | null;
}

export async function getProductionRevenueList(): Promise<ProductionRevenueListRow[]> {
  const supabase = await crmClient();
  const { data: rev } = await supabase
    .from("crm_production_revenue_summary")
    .select("production_id, name, status, ytd_revenue, lifetime_revenue, invoice_count, last_invoice_date")
    .order("ytd_revenue", { ascending: false });
  const summaries = (rev ?? []) as Array<{
    production_id: string;
    name: string;
    status: string;
    ytd_revenue: string | number;
    lifetime_revenue: string | number;
    invoice_count: number;
    last_invoice_date: string | null;
  }>;
  if (summaries.length === 0) return [];

  // Pull owner_id for each production in one go, then resolve names.
  const ids = summaries.map(s => s.production_id);
  const { data: prods } = await supabase
    .from("crm_productions")
    .select("id, owner_id")
    .in("id", ids);
  const ownerByProd = new Map<string, string | null>();
  for (const p of (prods ?? []) as Array<{ id: string; owner_id: string | null }>) {
    ownerByProd.set(p.id, p.owner_id);
  }
  const ownerIds = Array.from(new Set(Array.from(ownerByProd.values()).filter((x): x is string => !!x)));
  const nameByOwner = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ownerIds);
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string }>) {
      nameByOwner.set(p.id, p.full_name);
    }
  }

  return summaries.map(s => {
    const ownerId = ownerByProd.get(s.production_id) ?? null;
    return {
      production_id: s.production_id,
      name: s.name,
      status: s.status,
      ytd_revenue: Number(s.ytd_revenue ?? 0),
      lifetime_revenue: Number(s.lifetime_revenue ?? 0),
      invoice_count: Number(s.invoice_count ?? 0),
      last_invoice_date: s.last_invoice_date && s.last_invoice_date.startsWith("1900-") ? null : s.last_invoice_date,
      owner_id: ownerId,
      owner_name: ownerId ? (nameByOwner.get(ownerId) ?? null) : null,
    };
  });
}

// ----------------------------------------------------------------------------
// RW customer typeahead for the "Add RW account" form
// ----------------------------------------------------------------------------

export interface RwCustomerOption {
  rw_customer_id: string;
  customer: string;
  invoice_count: number;
  already_linked_production: { id: string; name: string } | null;
}

export async function searchUnlinkedRwCustomers(query: string, limit = 25): Promise<RwCustomerOption[]> {
  const supabase = await crmClient();
  const trimmed = query.trim();

  // Pull distinct (customer_id, customer) pairs from the cache, filtered by name search.
  let q = supabase
    .from("rw_invoices_cache")
    .select("customer_id, customer")
    .not("customer_id", "is", null)
    .limit(500);
  if (trimmed.length > 0) {
    q = q.ilike("customer", `%${trimmed}%`);
  }
  const { data } = await q;
  const rows = (data ?? []) as Array<{ customer_id: string | null; customer: string | null }>;

  const byId = new Map<string, { customer: string; count: number }>();
  for (const r of rows) {
    if (!r.customer_id || !r.customer) continue;
    const existing = byId.get(r.customer_id);
    if (existing) {
      existing.count += 1;
    } else {
      byId.set(r.customer_id, { customer: r.customer, count: 1 });
    }
  }

  const customerIds = Array.from(byId.keys());
  if (customerIds.length === 0) return [];

  // Find which RW customers are already linked, and to which production.
  const { data: linksRaw } = await supabase
    .from("crm_production_rw_customers")
    .select("rw_customer_id, production:crm_productions ( id, name )")
    .in("rw_customer_id", customerIds);
  const linkedById = new Map<string, { id: string; name: string }>();
  for (const l of (linksRaw ?? []) as unknown as Array<{ rw_customer_id: string; production: { id: string; name: string } | null }>) {
    if (l.production) linkedById.set(l.rw_customer_id, l.production);
  }

  return Array.from(byId.entries())
    .map(([id, v]) => ({
      rw_customer_id: id,
      customer: v.customer,
      invoice_count: v.count,
      already_linked_production: linkedById.get(id) ?? null,
    }))
    .sort((a, b) => a.customer.localeCompare(b.customer))
    .slice(0, limit);
}
