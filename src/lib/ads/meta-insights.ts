// Meta Marketing API — daily ad-level insights for one ad account.
//
// GET /v21.0/act_<id>/insights?level=ad&time_increment=1 returns one row per
// ad per day. Leads = the pixel Lead action (offsite_conversion.fb_pixel_lead),
// which is what the HDR campaign optimizes for.
//
// Token: META_ADS_ACCESS_TOKEN if set, else the Conversions API token
// (META_CAPI_ACCESS_TOKEN). The CAPI token only works here if the system user
// it belongs to has the ad account assigned with at least ads_read; the sync
// run records the exact Graph error when it does not.

import { num, type DailyRow, type FetchResult } from "./platforms";
import { getStoredCredential } from "./credentials";

const GRAPH_VERSION = "v21.0";

// Precedence: META_ADS_ACCESS_TOKEN env, then the token pasted on the Ads
// tab (ad_platform_credentials), then the Conversions API token.
export async function metaInsightsToken(): Promise<string | null> {
  return (
    process.env.META_ADS_ACCESS_TOKEN?.trim() ||
    (await getStoredCredential("meta", "access_token")) ||
    process.env.META_CAPI_ACCESS_TOKEN?.trim() ||
    null
  );
}

interface MetaAction {
  action_type: string;
  value: string;
}

interface MetaInsightRow {
  date_start: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  actions?: MetaAction[];
  account_currency?: string;
}

interface MetaError {
  message?: string;
  code?: number;
  error_subcode?: number;
  type?: string;
}

function leadCount(actions: MetaAction[] | undefined): number | null {
  if (!actions) return null;
  const pixelLead = actions.find((a) => a.action_type === "offsite_conversion.fb_pixel_lead");
  if (pixelLead) return num(pixelLead.value);
  const lead = actions.find((a) => a.action_type === "lead");
  return lead ? num(lead.value) : 0;
}

function describe(status: number, e: MetaError | undefined): string {
  const code = e?.code ? ` (code ${e.code}${e.error_subcode ? "/" + e.error_subcode : ""})` : "";
  return `Meta insights ${status}: ${e?.message || "unknown"}${code}`;
}

export async function fetchMetaDaily(
  adAccountId: string,
  since: string,
  until: string
): Promise<FetchResult> {
  const token = await metaInsightsToken();
  if (!token) throw new Error("No Meta access token yet. Paste a system user token with ads_read on the Ads tab.");

  const fields = [
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "spend",
    "impressions",
    "clicks",
    "reach",
    "actions",
    "account_currency",
  ].join(",");

  const params = new URLSearchParams({
    level: "ad",
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields,
    limit: "500",
    access_token: token,
  });
  let url: string | null = `https://graph.facebook.com/${GRAPH_VERSION}/act_${adAccountId}/insights?${params}`;

  const rows: DailyRow[] = [];
  let pages = 0;
  while (url && pages < 50) {
    const resp = await fetch(url);
    const json = (await resp.json()) as {
      data?: MetaInsightRow[];
      paging?: { next?: string };
      error?: MetaError;
    };
    if (!resp.ok || json.error) throw new Error(describe(resp.status, json.error));
    for (const r of json.data ?? []) {
      rows.push({
        date: r.date_start,
        campaign_id: r.campaign_id ?? "",
        campaign_name: r.campaign_name ?? null,
        adset_id: r.adset_id ?? "",
        adset_name: r.adset_name ?? null,
        ad_id: r.ad_id ?? "",
        ad_name: r.ad_name ?? null,
        spend: num(r.spend),
        impressions: num(r.impressions),
        clicks: num(r.clicks),
        reach: r.reach != null ? num(r.reach) : null,
        platform_conversions: leadCount(r.actions),
        currency: r.account_currency || "USD",
        raw: r,
      });
    }
    url = json.paging?.next ?? null;
    pages++;
  }
  return { rows, detail: { pages, graph_version: GRAPH_VERSION } };
}
