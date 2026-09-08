import { NextResponse } from "next/server";
import { AD_PLATFORMS, entityAdConfigs, type AdPlatform } from "@/lib/ads/platforms";
import { syncEntityAds } from "@/lib/ads/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// Daily: pull spend / impressions / clicks / platform conversions from Meta,
// Google Ads and OpenAI Ads into ad_platform_daily for every configured
// entity. Default window = the last 7 days (platforms restate recent days).
//
// Manual use, e.g. a backfill:
//   GET /api/sync/ad-platforms?since=2026-08-31&until=2026-09-08&platform=meta
//
// Auth: Bearer CRON_SECRET, same as the other sync crons.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const since = url.searchParams.get("since") || undefined;
  const until = url.searchParams.get("until") || undefined;
  const platformParam = url.searchParams.get("platform");
  const platforms = platformParam
    ? (platformParam.split(",").filter((p): p is AdPlatform => (AD_PLATFORMS as readonly string[]).includes(p)))
    : undefined;
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return NextResponse.json({ error: "since must be YYYY-MM-DD" }, { status: 400 });
  }
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    return NextResponse.json({ error: "until must be YYYY-MM-DD" }, { status: 400 });
  }

  const out: Record<string, unknown> = {};
  for (const cfg of entityAdConfigs()) {
    try {
      out[cfg.entityId] = await syncEntityAds(cfg.entityId, { since, until, platforms });
    } catch (e) {
      out[cfg.entityId] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return NextResponse.json({ since: since ?? "default (7 days)", until: until ?? "today", results: out });
}
