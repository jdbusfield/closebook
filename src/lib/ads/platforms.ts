// Shared shapes + config for the ads reporting sync.
//
// Each platform fetcher (meta-insights, google-ads-insights, openai-insights)
// returns DailyRow[] for a date window; sync.ts upserts them into
// ad_platform_daily keyed on (entity, platform, date, campaign, adset, ad).
//
// Credentials come from env. Account ids are not secrets, so the HDR ones are
// defaulted here and can be overridden per environment.

import { HDR_ENTITY_ID } from "@/lib/inquiries/shared";

export const AD_PLATFORMS = ["meta", "google", "chatgpt"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<AdPlatform, string> = {
  meta: "Meta",
  google: "Google Ads",
  chatgpt: "ChatGPT Ads",
};

export interface DailyRow {
  date: string; // YYYY-MM-DD
  campaign_id: string;
  campaign_name: string | null;
  adset_id: string;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number | null;
  platform_conversions: number | null;
  currency: string;
  raw?: unknown;
}

export interface FetchResult {
  rows: DailyRow[];
  /** Free-form diagnostics stored on the sync run (campaign names seen, API version used...). */
  detail?: Record<string, unknown>;
}

/** Which ad accounts belong to which Closebook entity. HDR only for now. */
export interface EntityAdConfig {
  entityId: string;
  meta?: { adAccountId: string };
  google?: {
    /** Only campaigns whose name contains this (case-insensitive) count for the entity. */
    campaignMatch: string;
  };
  chatgpt?: { enabled: true };
}

export function entityAdConfigs(): EntityAdConfig[] {
  return [
    {
      entityId: HDR_ENTITY_ID,
      meta: {
        adAccountId: (process.env.META_AD_ACCOUNT_ID || "1584416256379477").replace(/^act_/, ""),
      },
      google: {
        // HDR campaigns live in the Avon Rents Google Ads account next to Avon
        // campaigns, so filter by name. Override if a campaign is renamed.
        campaignMatch: process.env.GOOGLE_ADS_CAMPAIGN_MATCH || "hdr",
      },
      chatgpt: { enabled: true },
    },
  ];
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
