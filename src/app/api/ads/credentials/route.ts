import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { storeCredential } from "@/lib/ads/credentials";
import { syncEntityAds } from "@/lib/ads/sync";
import { AD_PLATFORMS, type AdPlatform } from "@/lib/ads/platforms";

export const runtime = "nodejs";
export const maxDuration = 300;

// "Paste token" on the Ads tab. A signed-in user with access to the entity
// stores a platform token (Meta system-user token, ChatGPT Ads API key) in
// ad_platform_credentials, then a sync runs immediately so the tab shows
// whether the token works. The value is never echoed back.
const KEY_FOR: Record<AdPlatform, string> = {
  meta: "access_token",
  google: "refresh_token",
  chatgpt: "api_key",
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    entityId?: string;
    platform?: string;
    value?: string;
    since?: string;
  };
  const entityId = body.entityId?.trim();
  const platform = body.platform as AdPlatform | undefined;
  const value = body.value?.trim();
  if (!entityId || !platform || !(AD_PLATFORMS as readonly string[]).includes(platform) || !value) {
    return NextResponse.json({ error: "entityId, platform and value are required" }, { status: 400 });
  }
  if (value.length > 4000) return NextResponse.json({ error: "Token looks too long" }, { status: 400 });

  const { data: entity } = await supabase.from("entities").select("id").eq("id", entityId).maybeSingle();
  if (!entity) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await storeCredential(platform, KEY_FOR[platform], value, { connected_by: user.id });
    const results = await syncEntityAds(entityId, { since: body.since, platforms: [platform] });
    return NextResponse.json({ stored: true, results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
