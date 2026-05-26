import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

async function client(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

export type NoteEntityType = "production" | "company" | "contact" | "opportunity";

const ENTITY_COLUMN: Record<NoteEntityType, string> = {
  production: "production_id",
  company: "company_id",
  contact: "contact_id",
  opportunity: "opportunity_id",
};

export interface CrmNoteRow {
  id: string;
  body: string;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
  author_name: string | null;
}

export async function getCrmNotesForEntity(entityType: NoteEntityType, entityId: string): Promise<CrmNoteRow[]> {
  const supabase = await client();
  const col = ENTITY_COLUMN[entityType];
  const { data } = await supabase
    .from("crm_notes")
    .select(`
      id, body, created_at, updated_at, created_by,
      author:profiles ( id, full_name )
    `)
    .eq(col, entityId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as Array<{
    id: string; body: string; created_at: string; updated_at: string | null; created_by: string | null;
    author: { id: string; full_name: string } | null;
  }>).map(n => ({
    id: n.id,
    body: n.body,
    created_at: n.created_at,
    updated_at: n.updated_at,
    created_by: n.created_by,
    author_name: n.author?.full_name ?? null,
  }));
}
