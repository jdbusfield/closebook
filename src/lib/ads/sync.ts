// Runs one ads-platform sync for one entity: fetch the window from each
// configured platform, upsert into ad_platform_daily, and record a sync run
// row (ok or the exact error) so the Ads tab can show it.
//
// Called by the daily cron (/api/sync/ad-platforms) and by the in-app "Sync
// now" button (/api/ads/sync). Re-syncing a window is safe: rows upsert on
// their natural key, which is also how late-arriving conversions get updated.

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchMetaDaily } from "./meta-insights";
import { fetchGoogleDaily } from "./google-ads-insights";
import { fetchOpenAIDaily } from "./openai-insights";
import {
  AD_PLATFORMS,
  addDays,
  entityAdConfigs,
  isoDate,
  type AdPlatform,
  type DailyRow,
  type EntityAdConfig,
  type FetchResult,
} from "./platforms";
import type { Json } from "@/lib/types/database.types";

export interface PlatformSyncResult {
  platform: AdPlatform;
  ok: boolean;
  rows: number;
  error?: string;
  detail?: Record<string, unknown>;
}

export interface SyncOptions {
  since?: string;
  until?: string;
  platforms?: AdPlatform[];
}

// Platforms restate the last few days (attribution windows, late
// conversions), so the default window reaches back a week.
const DEFAULT_LOOKBACK_DAYS = 7;

async function fetchFor(cfg: EntityAdConfig, platform: AdPlatform, since: string, until: string): Promise<FetchResult> {
  if (platform === "meta") {
    if (!cfg.meta) throw new Error("No Meta ad account configured for this entity");
    return fetchMetaDaily(cfg.meta.adAccountId, since, until);
  }
  if (platform === "google") {
    if (!cfg.google) throw new Error("No Google Ads campaign match configured for this entity");
    return fetchGoogleDaily(cfg.google.campaignMatch, since, until);
  }
  if (!cfg.chatgpt) throw new Error("ChatGPT Ads not enabled for this entity");
  return fetchOpenAIDaily(since, until);
}

export async function syncEntityAds(entityId: string, opts: SyncOptions = {}): Promise<PlatformSyncResult[]> {
  const cfg = entityAdConfigs().find((c) => c.entityId === entityId);
  if (!cfg) throw new Error("No ad platform configuration for this entity");

  const until = opts.until || isoDate(new Date());
  const since = opts.since || addDays(until, -DEFAULT_LOOKBACK_DAYS);
  const platforms = opts.platforms?.length ? opts.platforms : [...AD_PLATFORMS];
  const admin = createAdminClient();
  const results: PlatformSyncResult[] = [];

  for (const platform of platforms) {
    const startedAt = new Date().toISOString();
    let result: PlatformSyncResult;
    try {
      const { rows, detail } = await fetchFor(cfg, platform, since, until);
      const upserted = await upsertRows(admin, entityId, platform, rows);
      result = { platform, ok: true, rows: upserted, detail };
    } catch (e) {
      result = { platform, ok: false, rows: 0, error: e instanceof Error ? e.message : String(e) };
    }
    await admin.from("ad_platform_sync_runs").insert({
      entity_id: entityId,
      platform,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ok: result.ok,
      since,
      until,
      rows_upserted: result.rows,
      error: result.error ?? null,
      detail: (result.detail ?? null) as Json | null,
    });
    results.push(result);
  }
  return results;
}

async function upsertRows(
  admin: ReturnType<typeof createAdminClient>,
  entityId: string,
  platform: AdPlatform,
  rows: DailyRow[]
): Promise<number> {
  if (!rows.length) return 0;
  const syncedAt = new Date().toISOString();
  // Collapse duplicates on the natural key (a platform can return the same ad
  // twice when paging) so one upsert batch never conflicts with itself.
  const byKey = new Map<string, DailyRow>();
  for (const r of rows) {
    byKey.set(`${r.date}|${r.campaign_id}|${r.adset_id}|${r.ad_id}`, r);
  }
  const payload = [...byKey.values()].map((r) => ({
    entity_id: entityId,
    platform,
    date: r.date,
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    adset_id: r.adset_id,
    adset_name: r.adset_name,
    ad_id: r.ad_id,
    ad_name: r.ad_name,
    spend: r.spend,
    impressions: r.impressions,
    clicks: r.clicks,
    reach: r.reach,
    platform_conversions: r.platform_conversions,
    currency: r.currency,
    raw: (r.raw ?? null) as Json | null,
    synced_at: syncedAt,
  }));
  let total = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { error } = await admin
      .from("ad_platform_daily")
      .upsert(chunk, { onConflict: "entity_id,platform,date,campaign_id,adset_id,ad_id" });
    if (error) throw new Error(`ad_platform_daily upsert failed: ${error.message}`);
    total += chunk.length;
  }
  return total;
}
