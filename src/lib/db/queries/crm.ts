import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The generated Database type in `src/lib/types/database.types.ts` doesn't
 * yet include the `crm_*` tables — regenerating it requires a Supabase
 * access token we don't have in CI. Cast through the untyped client so
 * `.from("crm_productions")` etc. compile; the SQL is verified by the
 * migration in `supabase/migrations/20260521_crm_initial.sql`. Drop this
 * cast next time `database.types.ts` is regenerated.
 */
async function crmClient(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CrmProductionRow = {
  id: string;
  name: string;
  status: string;
  production_type: string | null;
  production_category: string | null;
  start_date: string | null;
  end_date: string | null;
  state: string | null;
  status_changed_at: string | null;
  is_399_production: boolean | null;
  ca_spend_level: number | null;
  avon_customer_number: string | null;
  company: { id: string; name: string } | null;
  studio: { id: string; name: string } | null;
};

export type CrmCompanyRow = {
  id: string;
  name: string;
  type: string;
  parent_studio_id: string | null;
  production_count?: number;
};

export type CrmContactRow = {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  status: string;
  salesperson: string | null;
  last_contact_date: string | null;
  last_contact_type: string | null;
  company: { id: string; name: string } | null;
};

export type CrmOpportunityRow = {
  id: string;
  description: string;
  current_segment: string;
  status: string;
  priority: string;
  amount: number | null;
  salesperson: string | null;
  status_comment: string | null;
  created_at: string;
  production: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
};

export type CrmCommunicationRow = {
  id: string;
  type: string;
  date: string;
  notes: string | null;
  salesperson: string | null;
  has_opportunity: boolean | null;
  contact: { id: string; name: string } | null;
  production: { id: string; name: string } | null;
  commercial_company: { id: string; name: string } | null;
};

export type CrmCommercialCompanyRow = {
  id: string;
  name: string;
  avon_customer_number: string | null;
  location: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Productions
// ---------------------------------------------------------------------------

export interface ProductionFilters {
  status?: string | string[];
  is399?: boolean;
  category?: string;
  search?: string;
}

export async function getCrmProductions(filters: ProductionFilters = {}): Promise<CrmProductionRow[]> {
  const supabase = await crmClient();
  let query = supabase
    .from("crm_productions")
    .select(`
      id, name, status, production_type, production_category, start_date, end_date,
      state, status_changed_at, is_399_production, ca_spend_level, avon_customer_number,
      company:crm_companies!crm_productions_company_id_fkey ( id, name ),
      studio:crm_companies!crm_productions_studio_id_fkey ( id, name )
    `)
    .order("name", { ascending: true });

  if (filters.status) {
    if (Array.isArray(filters.status)) query = query.in("status", filters.status);
    else query = query.eq("status", filters.status);
  }
  if (filters.is399 !== undefined) query = query.eq("is_399_production", filters.is399);
  if (filters.category) query = query.eq("production_category", filters.category);
  if (filters.search) query = query.ilike("name", `%${filters.search}%`);

  const { data, error } = await query;
  if (error) {
    console.error("getCrmProductions error", error);
    return [];
  }
  return (data ?? []) as unknown as CrmProductionRow[];
}

export async function getCrmProduction(id: string) {
  const supabase = await crmClient();
  const { data, error } = await supabase
    .from("crm_productions")
    .select(`
      *,
      company:crm_companies!crm_productions_company_id_fkey ( id, name, type ),
      studio:crm_companies!crm_productions_studio_id_fkey ( id, name, type ),
      primary_transportation_contact:crm_contacts!crm_productions_primary_transportation_contact_id_fkey ( id, name, role, email, phone ),
      primary_locations_contact:crm_contacts!crm_productions_primary_locations_contact_id_fkey ( id, name, role, email, phone )
    `)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getCrmProduction error", error);
    return null;
  }
  return data as unknown as Record<string, unknown> | null;
}

export async function getCrmProductionContacts(productionId: string) {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_contact_productions")
    .select(`contact:crm_contacts ( id, name, role, email, phone, salesperson )`)
    .eq("production_id", productionId);
  return (data ?? []).map((r: { contact: unknown }) => r.contact).filter(Boolean) as Array<{
    id: string; name: string; role: string; email: string | null; phone: string | null; salesperson: string | null;
  }>;
}

export async function getCrmProductionAliases(productionId: string) {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_production_aliases")
    .select("id, alias_name, created_at")
    .eq("production_id", productionId)
    .order("created_at");
  return (data ?? []) as Array<{ id: string; alias_name: string; created_at: string }>;
}

export async function getCrmProductionStatusHistory(productionId: string) {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_production_status_history")
    .select("id, old_status, new_status, changed_at, notes")
    .eq("production_id", productionId)
    .order("changed_at", { ascending: false });
  return (data ?? []) as Array<{ id: string; old_status: string | null; new_status: string; changed_at: string; notes: string | null }>;
}

export async function getCrmProductionOpportunities(productionId: string): Promise<CrmOpportunityRow[]> {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_opportunities")
    .select(`
      id, description, current_segment, status, priority, amount, salesperson, status_comment, created_at,
      contact:crm_contacts ( id, name )
    `)
    .eq("production_id", productionId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({ ...r, production: null })) as unknown as CrmOpportunityRow[];
}

export async function getCrmProductionCommunications(productionId: string): Promise<CrmCommunicationRow[]> {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_communications")
    .select(`
      id, type, date, notes, salesperson, has_opportunity,
      contact:crm_contacts ( id, name )
    `)
    .eq("production_id", productionId)
    .order("date", { ascending: false });
  return (data ?? []).map((r) => ({ ...r, production: null, commercial_company: null })) as unknown as CrmCommunicationRow[];
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export async function getCrmCompanies(opts?: { type?: string; search?: string }): Promise<CrmCompanyRow[]> {
  const supabase = await crmClient();
  let query = supabase
    .from("crm_companies")
    .select("id, name, type, parent_studio_id")
    .order("name");
  if (opts?.type) query = query.eq("type", opts.type);
  if (opts?.search) query = query.ilike("name", `%${opts.search}%`);
  const { data, error } = await query;
  if (error) { console.error(error); return []; }
  return (data ?? []) as CrmCompanyRow[];
}

export async function getCrmCompany(id: string) {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_companies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data as unknown as { id: string; name: string; type: string; parent_studio_id: string | null; created_at: string } | null;
}

export async function getCrmCompanyProductions(companyId: string): Promise<CrmProductionRow[]> {
  return getCrmProductions().then(rows =>
    rows.filter(r => r.company?.id === companyId || r.studio?.id === companyId)
  );
}

export async function getCrmCompanyContacts(companyId: string): Promise<CrmContactRow[]> {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_contacts")
    .select(`
      id, name, role, phone, email, status, salesperson, last_contact_date, last_contact_type,
      company:crm_companies ( id, name )
    `)
    .eq("company_id", companyId)
    .order("name");
  return (data ?? []) as unknown as CrmContactRow[];
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface ContactFilters {
  role?: string;
  status?: string;
  search?: string;
}

export async function getCrmContacts(filters: ContactFilters = {}): Promise<CrmContactRow[]> {
  const supabase = await crmClient();
  let query = supabase
    .from("crm_contacts")
    .select(`
      id, name, role, phone, email, status, salesperson, last_contact_date, last_contact_type,
      company:crm_companies ( id, name )
    `)
    .order("name");
  if (filters.role) query = query.eq("role", filters.role);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.search) query = query.or(`name.ilike.%${filters.search}%,email.ilike.%${filters.search}%`);
  const { data, error } = await query;
  if (error) { console.error(error); return []; }
  return (data ?? []) as unknown as CrmContactRow[];
}

export async function getCrmContact(id: string) {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_contacts")
    .select(`
      *,
      company:crm_companies ( id, name, type )
    `)
    .eq("id", id)
    .maybeSingle();
  return data as unknown as Record<string, unknown> | null;
}

export async function getCrmContactProductions(contactId: string): Promise<CrmProductionRow[]> {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_contact_productions")
    .select(`
      production:crm_productions (
        id, name, status, production_type, production_category, start_date, end_date,
        state, status_changed_at, is_399_production, ca_spend_level, avon_customer_number,
        company:crm_companies!crm_productions_company_id_fkey ( id, name ),
        studio:crm_companies!crm_productions_studio_id_fkey ( id, name )
      )
    `)
    .eq("contact_id", contactId);
  return (data ?? []).map((r: { production: unknown }) => r.production).filter(Boolean) as unknown as CrmProductionRow[];
}

export async function getCrmContactOpportunities(contactId: string): Promise<CrmOpportunityRow[]> {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_opportunities")
    .select(`
      id, description, current_segment, status, priority, amount, salesperson, status_comment, created_at,
      production:crm_productions ( id, name )
    `)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({ ...r, contact: null })) as unknown as CrmOpportunityRow[];
}

export async function getCrmContactCommunications(contactId: string): Promise<CrmCommunicationRow[]> {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_communications")
    .select(`
      id, type, date, notes, salesperson, has_opportunity,
      production:crm_productions ( id, name ),
      commercial_company:crm_commercial_companies ( id, name )
    `)
    .eq("contact_id", contactId)
    .order("date", { ascending: false });
  return (data ?? []).map((r) => ({ ...r, contact: null })) as unknown as CrmCommunicationRow[];
}

// ---------------------------------------------------------------------------
// Opportunities
// ---------------------------------------------------------------------------

export interface OpportunityFilters {
  status?: string;
  segment?: string;
  priority?: string;
  salesperson?: string;
}

export async function getCrmOpportunities(filters: OpportunityFilters = {}): Promise<CrmOpportunityRow[]> {
  const supabase = await crmClient();
  let query = supabase
    .from("crm_opportunities")
    .select(`
      id, description, current_segment, status, priority, amount, salesperson, status_comment, created_at,
      production:crm_productions ( id, name ),
      contact:crm_contacts ( id, name )
    `)
    .order("created_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.segment) query = query.eq("current_segment", filters.segment);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.salesperson) query = query.eq("salesperson", filters.salesperson);
  const { data, error } = await query;
  if (error) { console.error(error); return []; }
  return (data ?? []) as unknown as CrmOpportunityRow[];
}

export async function getCrmOpportunity(id: string) {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_opportunities")
    .select(`
      *,
      production:crm_productions ( id, name, status ),
      contact:crm_contacts ( id, name, role, email, phone )
    `)
    .eq("id", id)
    .maybeSingle();
  return data as unknown as Record<string, unknown> | null;
}

export async function getCrmOpportunityComments(opportunityId: string) {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_opportunity_comments")
    .select("id, comment, created_at")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Array<{ id: string; comment: string; created_at: string }>;
}

// ---------------------------------------------------------------------------
// Communications
// ---------------------------------------------------------------------------

export interface CommunicationFilters {
  type?: string;
  salesperson?: string;
  from?: string;
  to?: string;
}

export async function getCrmCommunications(filters: CommunicationFilters = {}): Promise<CrmCommunicationRow[]> {
  const supabase = await crmClient();
  let query = supabase
    .from("crm_communications")
    .select(`
      id, type, date, notes, salesperson, has_opportunity,
      contact:crm_contacts ( id, name ),
      production:crm_productions ( id, name ),
      commercial_company:crm_commercial_companies ( id, name )
    `)
    .order("date", { ascending: false })
    .limit(500);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.salesperson) query = query.eq("salesperson", filters.salesperson);
  if (filters.from) query = query.gte("date", filters.from);
  if (filters.to) query = query.lte("date", filters.to);
  const { data, error } = await query;
  if (error) { console.error(error); return []; }
  return (data ?? []) as unknown as CrmCommunicationRow[];
}

// ---------------------------------------------------------------------------
// Commercial companies
// ---------------------------------------------------------------------------

export async function getCrmCommercialCompanies(): Promise<CrmCommercialCompanyRow[]> {
  const supabase = await crmClient();
  const { data, error } = await supabase
    .from("crm_commercial_companies")
    .select("id, name, avon_customer_number, location, created_at")
    .order("name");
  if (error) { console.error(error); return []; }
  return (data ?? []) as CrmCommercialCompanyRow[];
}

export async function getCrmCommercialCompany(id: string) {
  const supabase = await crmClient();
  const { data } = await supabase
    .from("crm_commercial_companies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data as unknown as { id: string; name: string; avon_customer_number: string | null; location: string | null; created_at: string } | null;
}

// ---------------------------------------------------------------------------
// Counts / dashboard
// ---------------------------------------------------------------------------

export async function getCrmStatusCounts(): Promise<Record<string, number>> {
  const supabase = await crmClient();
  const { data, error } = await supabase
    .from("crm_productions")
    .select("status");
  if (error) return {};
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ status: string }>) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

export async function getCrmContactCount(): Promise<number> {
  const supabase = await crmClient();
  const { count } = await supabase
    .from("crm_contacts")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

export async function getCrmCompanyCount(): Promise<number> {
  const supabase = await crmClient();
  const { count } = await supabase
    .from("crm_companies")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

export async function getCrmOpportunityCount(opts?: { status?: string }): Promise<number> {
  const supabase = await crmClient();
  let q = supabase.from("crm_opportunities").select("id", { count: "exact", head: true });
  if (opts?.status) q = q.eq("status", opts.status);
  const { count } = await q;
  return count ?? 0;
}
