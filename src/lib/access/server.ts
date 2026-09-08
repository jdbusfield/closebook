import { createClient } from "@/lib/supabase/server";
import type { MemberAccess } from "./modules";
import { parseAccessRow } from "./parse";

/**
 * The signed-in member's role plus entity/module allowlists. Falls back to
 * "everything" if the membership row can't be read, so a missing migration
 * never locks anyone out.
 */
export async function getMemberAccess(): Promise<MemberAccess | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("organization_members")
    .select("*")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return parseAccessRow(data as Record<string, unknown>);
}
