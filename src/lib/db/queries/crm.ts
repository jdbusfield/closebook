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

export type CrmProductionRow = {
  id: string;
  name: string;
  status: string;
  production_type: string | null;
  start_date: string | null;
  end_date: string | null;
  state: string | null;
  company: { name: string } | null;
  studio: { name: string } | null;
};

export async function getCrmProductions(opts?: { status?: string }): Promise<CrmProductionRow[]> {
  const supabase = await crmClient();
  let query = supabase
    .from("crm_productions")
    .select(`
      id, name, status, production_type, start_date, end_date, state,
      company:crm_companies!crm_productions_company_id_fkey ( name ),
      studio:crm_companies!crm_productions_studio_id_fkey ( name )
    `)
    .order("name", { ascending: true });

  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query;
  if (error) {
    console.error("getCrmProductions error", error);
    return [];
  }
  return (data ?? []) as unknown as CrmProductionRow[];
}

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
