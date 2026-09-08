// Column lists shared by the Ads tab hook (browser) and the embed route
// (server). Kept in a plain module: a "use client" module's exports become
// client references when imported from a route handler.

export const AD_DATA_START = "2026-08-01";

export const AD_ROW_COLUMNS =
  "platform, date, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, spend, impressions, clicks, reach, platform_conversions";

export const AD_RUN_COLUMNS =
  "platform, started_at, finished_at, ok, since, until, rows_upserted, error";
