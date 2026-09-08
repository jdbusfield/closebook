import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AD_PLATFORMS, type AdPlatform } from "@/lib/ads/platforms";
import { syncEntityAds } from "@/lib/ads/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// "Sync now" from the Ads tab. Requires a signed-in user who can see the
// entity (RLS on `entities` decides), then runs the same sync as the cron.
// The embed (no session) never calls this; it shows the last cron run instead.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    entityId?: string;
    since?: string;
    until?: string;
    platforms?: string[];
  };
  const entityId = body.entityId?.trim();
  if (!entityId) return NextResponse.json({ error: "entityId required" }, { status: 400 });

  const { data: entity } = await supabase.from("entities").select("id").eq("id", entityId).maybeSingle();
  if (!entity) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const platforms = body.platforms?.filter((p): p is AdPlatform =>
    (AD_PLATFORMS as readonly string[]).includes(p)
  );
  try {
    const results = await syncEntityAds(entityId, {
      since: body.since,
      until: body.until,
      platforms,
    });
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
