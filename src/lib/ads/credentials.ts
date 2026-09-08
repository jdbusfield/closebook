// Tokens obtained through Closebook's own OAuth flows, stored server-side in
// ad_platform_credentials (service role only). Env vars still win when set,
// so a token can be pinned per environment.

import { createAdminClient } from "@/lib/supabase/admin";
import type { AdPlatform } from "./platforms";

export async function getStoredCredential(platform: AdPlatform, key: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ad_platform_credentials")
    .select("value")
    .eq("platform", platform)
    .eq("key", key)
    .maybeSingle();
  if (error || !data) return null;
  return data.value || null;
}

export async function storeCredential(
  platform: AdPlatform,
  key: string,
  value: string,
  meta: { granted_scope?: string | null; account_hint?: string | null; connected_by?: string | null } = {}
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("ad_platform_credentials").upsert(
    { platform, key, value, ...meta, updated_at: new Date().toISOString() },
    { onConflict: "platform,key" }
  );
  if (error) throw new Error(`Could not store ${platform} ${key}: ${error.message}`);
}
