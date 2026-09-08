// OpenAI Ads (ChatGPT) — daily ad-level insights for the authenticated ad
// account. Docs: https://developers.openai.com/ads/api-reference/insights
//
// GET https://api.ads.openai.com/v1/ad_account/insights
//   ?time_granularity=daily&aggregation_level=ad&time_ranges[]={unix_range}
// Bearer OPENAI_ADS_API_KEY (one key per ad account, minted in Ads Manager
// under Settings). The key scopes the account, so no account id is sent.

import { num, type DailyRow, type FetchResult } from "./platforms";
import { getStoredCredential } from "./credentials";

const BASE = "https://api.ads.openai.com/v1";

// Precedence: OPENAI_ADS_API_KEY env, then the key pasted on the Ads tab.
export async function openaiAdsKey(): Promise<string | null> {
  return process.env.OPENAI_ADS_API_KEY?.trim() || (await getStoredCredential("chatgpt", "api_key")) || null;
}

type Rec = Record<string, unknown>;

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

// The row id looks like "start=1777075200:end=1777161600:entity_id=cmpn_101";
// the daily bucket's date is the start epoch. Fall back to any date-like field.
function rowDate(r: Rec): string | null {
  const id = str(r.id) ?? "";
  const m = id.match(/start=(\d+)/);
  if (m) return new Date(Number(m[1]) * 1000).toISOString().slice(0, 10);
  for (const k of ["date", "day", "start_date", "start", "start_time"]) {
    const v = r[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    if (typeof v === "number") return new Date(v * 1000).toISOString().slice(0, 10);
  }
  const meta = r.metadata as Rec | undefined;
  const rt = meta?.readable_time;
  if (typeof rt === "string" && /^\d{4}-\d{2}-\d{2}/.test(rt)) return rt.slice(0, 10);
  return null;
}

export async function fetchOpenAIDaily(since: string, until: string): Promise<FetchResult> {
  const key = await openaiAdsKey();
  if (!key) throw new Error("No ChatGPT Ads API key yet. Create one at ads.openai.com > Settings > API keys and paste it on the Ads tab.");

  const start = Math.floor(new Date(since + "T00:00:00Z").getTime() / 1000);
  const end = Math.floor(new Date(until + "T00:00:00Z").getTime() / 1000) + 86400;
  const params = new URLSearchParams({ time_granularity: "daily", aggregation_level: "ad" });
  params.append(
    "time_ranges[]",
    JSON.stringify({ type: "unix_range", start: String(start), end: String(end) })
  );
  // Without an explicit field list the ad-level response carries only
  // impressions. Verified Sep 8 2026: these names return spend, clicks, ctr
  // and the campaign / ad group / ad ids and names as flat keys.
  for (const f of [
    "ad.id",
    "ad.name",
    "ad.spend",
    "ad.clicks",
    "ad.impressions",
    "ad.ctr",
    "campaign.id",
    "campaign.name",
    "ad_group.id",
    "ad_group.name",
    "metadata.readable_time",
  ]) {
    params.append("fields[]", f);
  }

  const rows: DailyRow[] = [];
  let url: string | null = `${BASE}/ad_account/insights?${params}`;
  let pages = 0;
  const sampleKeys: string[] = [];
  while (url && pages < 50) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`OpenAI Ads insights HTTP ${resp.status}: ${text.slice(0, 600)}`);
    const json = JSON.parse(text) as {
      data?: Rec[];
      next_page?: string;
      has_more?: boolean;
      next_cursor?: string;
    };
    for (const r of json.data ?? []) {
      if (!sampleKeys.length) sampleKeys.push(...Object.keys(r));
      const date = rowDate(r);
      if (!date) continue;
      rows.push({
        date,
        campaign_id: str(r.campaign_id) ?? "",
        campaign_name: str(r.campaign_name),
        adset_id: str(r.ad_group_id) ?? "",
        adset_name: str(r.ad_group_name),
        ad_id: str(r.ad_id) ?? "",
        ad_name: str(r.ad_name),
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        reach: null,
        platform_conversions: r.conversions != null ? num(r.conversions) : null,
        currency: str(r.currency) ?? "USD",
        raw: r,
      });
    }
    url = json.next_page
      ? json.next_page
      : json.has_more && json.next_cursor
        ? `${BASE}/ad_account/insights?${params}&cursor=${encodeURIComponent(json.next_cursor)}`
        : null;
    pages++;
  }
  return { rows, detail: { pages, sample_keys: sampleKeys } };
}
