import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolve the calling user's organization_id. Returns null if unauthenticated
 * or not a member of any organization.
 */
export async function getCallerOrg(): Promise<{ supabase: SupabaseClient; userId: string; organizationId: string } | null> {
  const supabase = (await createClient()) as unknown as SupabaseClient;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const organizationId = (membership as { organization_id: string } | null)?.organization_id;
  if (!organizationId) return null;
  return { supabase, userId: user.id, organizationId };
}
