// Google Ads API — daily campaign-level metrics via a GAQL search.
//
// The HDR campaigns (Performance Max + Brand) run inside the Avon Rents Google
// Ads account, so we pull every campaign in the account and keep the ones whose
// name matches the entity's campaignMatch. Performance Max has no ad groups or
// ads to report on, so rows are campaign-level (adset_id / ad_id = '').
//
// Auth reuses the Data Manager OAuth client (GOOGLE_ADS_CLIENT_ID / SECRET)
// plus GOOGLE_ADS_DEVELOPER_TOKEN. The refresh token must carry the
// https://www.googleapis.com/auth/adwords scope; the Data Manager token minted
// for conversion uploads does not, so a second token can be stored as
// GOOGLE_ADS_REPORTING_REFRESH_TOKEN. The sync run records the exact error
// when the scope or developer token is the problem.

import { num, type DailyRow, type FetchResult } from "./platforms";

// Newest first. A version Google has retired answers 404, so we fall through
// to the next one. Pin with GOOGLE_ADS_API_VERSION once known.
const VERSION_CANDIDATES = ["v23", "v22", "v21", "v20"];

interface GoogleCfg {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  developerToken: string;
  customerId: string;
  loginCustomerId?: string;
}

export function getGoogleAdsReportingConfig(): GoogleCfg | null {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const refreshToken = (
    process.env.GOOGLE_ADS_REPORTING_REFRESH_TOKEN || process.env.GOOGLE_ADS_REFRESH_TOKEN
  )?.trim();
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.trim().replace(/-/g, "");
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim().replace(/-/g, "");
  if (!clientId || !clientSecret || !refreshToken || !developerToken || !customerId) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    developerToken,
    customerId,
    loginCustomerId: loginCustomerId || undefined,
  };
}

async function accessToken(cfg: GoogleCfg): Promise<{ token: string; scope: string }> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await resp.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!resp.ok || !json.access_token) {
    throw new Error(
      `Google OAuth token exchange failed (${resp.status}): ${json.error_description || json.error || "unknown"}`
    );
  }
  return { token: json.access_token, scope: json.scope || "" };
}

interface GaqlRow {
  campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string };
  segments?: { date?: string };
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
    conversions?: number;
    allConversions?: number;
  };
}

export async function fetchGoogleDaily(
  campaignMatch: string,
  since: string,
  until: string
): Promise<FetchResult> {
  const cfg = getGoogleAdsReportingConfig();
  if (!cfg) {
    throw new Error(
      "Google Ads reporting is not configured: needs GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REPORTING_REFRESH_TOKEN (adwords scope), GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID"
    );
  }
  const { token, scope } = await accessToken(cfg);
  if (scope && !scope.includes("adwords")) {
    throw new Error(
      `The Google refresh token has scope "${scope}" but Google Ads reporting needs https://www.googleapis.com/auth/adwords. Mint a second refresh token with that scope (docs/ads-reporting-runbook.md) and store it as GOOGLE_ADS_REPORTING_REFRESH_TOKEN.`
    );
  }

  const query =
    "SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, " +
    "segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, " +
    `metrics.all_conversions FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}' ORDER BY segments.date`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": cfg.developerToken,
    "Content-Type": "application/json",
  };
  if (cfg.loginCustomerId) headers["login-customer-id"] = cfg.loginCustomerId;

  const pinned = process.env.GOOGLE_ADS_API_VERSION?.trim();
  const versions = pinned ? [pinned] : VERSION_CANDIDATES;
  let lastErr = "";
  for (const v of versions) {
    const results: GaqlRow[] = [];
    let pageToken: string | undefined;
    let ok = true;
    do {
      const resp = await fetch(
        `https://googleads.googleapis.com/${v}/customers/${cfg.customerId}/googleAds:search`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ query, pageSize: 10000, ...(pageToken ? { pageToken } : {}) }),
        }
      );
      const text = await resp.text();
      if (!resp.ok) {
        lastErr = `Google Ads API ${v} HTTP ${resp.status}: ${text.slice(0, 600)}`;
        ok = false;
        break;
      }
      const json = JSON.parse(text) as { results?: GaqlRow[]; nextPageToken?: string };
      results.push(...(json.results ?? []));
      pageToken = json.nextPageToken;
    } while (pageToken);
    if (!ok) {
      // Retired version → try the next one. Anything else is a real error.
      if (/HTTP 404/.test(lastErr) || /unsupported|not found|UNIMPLEMENTED/i.test(lastErr)) continue;
      throw new Error(lastErr);
    }

    const match = campaignMatch.toLowerCase();
    const seen = new Set<string>();
    const rows: DailyRow[] = [];
    for (const r of results) {
      const name = r.campaign?.name ?? "";
      seen.add(name);
      if (match && !name.toLowerCase().includes(match)) continue;
      rows.push({
        date: r.segments?.date ?? since,
        campaign_id: r.campaign?.id ?? "",
        campaign_name: name || null,
        adset_id: "",
        adset_name: null,
        ad_id: "",
        ad_name: null,
        spend: Math.round(num(r.metrics?.costMicros) / 10000) / 100,
        impressions: num(r.metrics?.impressions),
        clicks: num(r.metrics?.clicks),
        reach: null,
        platform_conversions: r.metrics?.conversions != null ? num(r.metrics.conversions) : null,
        currency: "USD",
        raw: r,
      });
    }
    return {
      rows,
      detail: {
        api_version: v,
        campaigns_in_account: [...seen],
        campaign_match: campaignMatch,
        token_scope: scope,
      },
    };
  }
  throw new Error(lastErr || "Google Ads API: no API version answered");
}
