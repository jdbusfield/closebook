import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export interface StaleProductionRow {
  production_id: string;
  name: string;
  status: string;
  owner_id: string | null;
  last_activity_at: string;
  days_stale: number;
}

const STALE_DAYS = 30;

export async function getStaleProductions(): Promise<StaleProductionRow[]> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data } = await supabase
    .from("crm_stale_productions")
    .select("production_id, name, status, owner_id, last_activity_at");
  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  return ((data ?? []) as Array<{ production_id: string; name: string; status: string; owner_id: string | null; last_activity_at: string }>)
    .map(r => ({
      ...r,
      days_stale: Math.floor((Date.now() - new Date(r.last_activity_at).getTime()) / (24 * 60 * 60 * 1000)),
    }))
    .filter(r => new Date(r.last_activity_at).getTime() < cutoff)
    .sort((a, b) => b.days_stale - a.days_stale);
}
