import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Like the CRM query layer, the diligence_* tables are not in the generated
// database.types.ts, so we work through an untyped client. RLS scopes all
// reads to the caller's organization via user_org_ids().
async function diligenceClient(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

export interface DiligenceDealRow {
  id: string;
  name: string;
  counterparty: string | null;
  deal_type: string;
  stage: string;
  description: string | null;
  target_close_date: string | null;
  nda_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiligenceItemRow {
  id: string;
  deal_id: string;
  category: string;
  title: string;
  details: string | null;
  status: string;
  priority: string;
  internal_owner: string | null;
  counterparty_owner: string | null;
  requested_date: string | null;
  received_date: string | null;
  due_date: string | null;
  red_flag: boolean;
  finding: string | null;
  doc_url: string | null;
  sort_order: number;
}

export interface DealProgress {
  total: number;
  complete: number;
  redFlags: number;
  openFollowUps: number;
}

const DONE_STATUSES = new Set(["complete", "not_applicable"]);

export function summarizeItems(items: Pick<DiligenceItemRow, "status" | "red_flag">[]): DealProgress {
  return {
    total: items.length,
    complete: items.filter(i => DONE_STATUSES.has(i.status)).length,
    redFlags: items.filter(i => i.red_flag).length,
    openFollowUps: items.filter(i => i.status === "follow_up").length,
  };
}

/** All deals for the caller's org, with per-deal progress rollups. */
export async function getDiligenceDeals(): Promise<Array<DiligenceDealRow & { progress: DealProgress }>> {
  const supabase = await diligenceClient();
  const [dealsRes, itemsRes] = await Promise.all([
    supabase
      .from("diligence_deals")
      .select("id, name, counterparty, deal_type, stage, description, target_close_date, nda_date, notes, created_at, updated_at")
      .order("updated_at", { ascending: false }),
    supabase.from("diligence_items").select("deal_id, status, red_flag"),
  ]);
  // Tolerate the tables not existing yet (code can deploy ahead of the migration).
  if (dealsRes.error || itemsRes.error) return [];

  const itemsByDeal = new Map<string, Array<{ status: string; red_flag: boolean }>>();
  for (const item of (itemsRes.data ?? []) as Array<{ deal_id: string; status: string; red_flag: boolean }>) {
    const list = itemsByDeal.get(item.deal_id) ?? [];
    list.push(item);
    itemsByDeal.set(item.deal_id, list);
  }
  return ((dealsRes.data ?? []) as DiligenceDealRow[]).map(deal => ({
    ...deal,
    progress: summarizeItems(itemsByDeal.get(deal.id) ?? []),
  }));
}

export async function getDiligenceDeal(id: string): Promise<DiligenceDealRow | null> {
  const supabase = await diligenceClient();
  const { data, error } = await supabase
    .from("diligence_deals")
    .select("id, name, counterparty, deal_type, stage, description, target_close_date, nda_date, notes, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return data as DiligenceDealRow | null;
}

export async function getDiligenceItems(dealId: string): Promise<DiligenceItemRow[]> {
  const supabase = await diligenceClient();
  const { data, error } = await supabase
    .from("diligence_items")
    .select(
      "id, deal_id, category, title, details, status, priority, internal_owner, counterparty_owner, requested_date, received_date, due_date, red_flag, finding, doc_url, sort_order"
    )
    .eq("deal_id", dealId)
    .order("sort_order")
    .order("created_at");
  if (error) return [];
  return (data ?? []) as DiligenceItemRow[];
}
