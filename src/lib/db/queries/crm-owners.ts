import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export interface CrmOrgMember {
  id: string;
  full_name: string;
}

/** Profiles of every user in the calling user's organization. */
export async function getOrgMembers(): Promise<CrmOrgMember[]> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: myMember } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const orgId = (myMember as { organization_id: string } | null)?.organization_id;
  if (!orgId) return [];
  const { data: members } = await supabase
    .from("organization_members")
    .select("user:profiles ( id, full_name )")
    .eq("organization_id", orgId);
  return ((members ?? []) as unknown as Array<{ user: { id: string; full_name: string } | null }>)
    .map(m => m.user)
    .filter((u): u is CrmOrgMember => !!u)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
