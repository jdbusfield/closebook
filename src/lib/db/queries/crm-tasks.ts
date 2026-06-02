import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

async function client(): Promise<SupabaseClient> {
  return (await createClient()) as unknown as SupabaseClient;
}

export type TaskEntityType = "production" | "company" | "contact" | "opportunity";

const ENTITY_COLUMN: Record<TaskEntityType, string> = {
  production: "production_id",
  company: "company_id",
  contact: "contact_id",
  opportunity: "opportunity_id",
};

export interface CrmTaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  due_date: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  production_id: string | null;
  company_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  created_at: string;
  completed_at: string | null;
  production_name: string | null;
}

export async function getCrmTasksForEntity(entityType: TaskEntityType, entityId: string): Promise<CrmTaskRow[]> {
  const supabase = await client();
  const col = ENTITY_COLUMN[entityType];
  const { data } = await supabase
    .from("crm_tasks")
    .select(`
      id, title, description, status, due_date, assignee_id, created_at, completed_at,
      production_id, company_id, contact_id, opportunity_id,
      assignee:profiles ( id, full_name )
    `)
    .eq(col, entityId)
    .order("status")
    .order("due_date", { ascending: true, nullsFirst: false });
  return ((data ?? []) as unknown as Array<{
    id: string; title: string; description: string | null; status: string;
    due_date: string | null; assignee_id: string | null; created_at: string; completed_at: string | null;
    production_id: string | null; company_id: string | null; contact_id: string | null; opportunity_id: string | null;
    assignee: { id: string; full_name: string } | null;
  }>).map(t => ({
    ...t,
    assignee_name: t.assignee?.full_name ?? null,
    production_name: null,
  }));
}

export interface MyOpenTaskRow extends CrmTaskRow {
  production_name: string | null;
  is_overdue: boolean;
}

export async function getMyOpenTasks(userId: string): Promise<MyOpenTaskRow[]> {
  const supabase = await client();
  const { data } = await supabase
    .from("crm_tasks")
    .select(`
      id, title, description, status, due_date, assignee_id, created_at, completed_at,
      production_id, company_id, contact_id, opportunity_id,
      assignee:profiles ( id, full_name ),
      production:crm_productions ( id, name )
    `)
    .eq("assignee_id", userId)
    .in("status", ["open", "in_progress"])
    .order("due_date", { ascending: true, nullsFirst: false });
  const today = new Date().toISOString().slice(0, 10);
  return ((data ?? []) as unknown as Array<{
    id: string; title: string; description: string | null; status: string;
    due_date: string | null; assignee_id: string | null; created_at: string; completed_at: string | null;
    production_id: string | null; company_id: string | null; contact_id: string | null; opportunity_id: string | null;
    assignee: { id: string; full_name: string } | null;
    production: { id: string; name: string } | null;
  }>).map(t => ({
    ...t,
    assignee_name: t.assignee?.full_name ?? null,
    production_name: t.production?.name ?? null,
    is_overdue: !!t.due_date && t.due_date < today,
  }));
}
