# Ads reporting (Meta, Google Ads, ChatGPT Ads) in the sales CRM

The **Ads** tab in the sales CRM (`/<entity>/inquiries/ads`, also in the HDR
admin-portal embed) shows what every paid platform cost and what it turned into
in the pipeline. Spend, impressions and clicks are pulled from each platform's
reporting API into one table; leads, stages, lost reasons and booked value come
from `rental_inquiries`, classified by the click id the website captured.

| Platform | Lead is attributed when | Spend source |
|---|---|---|
| Meta | `fbclid` present | Marketing API insights, ad level, daily |
| Google Ads | `gclid` present | Google Ads API (GAQL), campaign level, daily |
| ChatGPT Ads | `oppref` present | OpenAI Ads Insights API, ad level, daily |

Platform-reported conversions are shown next to CRM leads for comparison. The
CRM numbers are the ones to act on.

## Pieces

- `supabase/migrations/20260908_ad_platform_reporting.sql` creates
  `ad_platform_daily` (one row per platform, day, campaign, ad set, ad),
  `ad_platform_sync_runs` (one row per sync attempt with the exact error) and
  adds `utm_source/medium/campaign/content/term` + `landing_path` to
  `rental_inquiries`. **Run it in Supabase Studio** (no local DDL path).
- `src/lib/ads/*` platform fetchers + `sync.ts` upserter.
- `src/app/api/sync/ad-platforms/route.ts` daily cron (11:30 UTC, `vercel.json`),
  Bearer `CRON_SECRET`. Accepts `?since=YYYY-MM-DD&until=YYYY-MM-DD&platform=meta,google,chatgpt`
  for backfills.
- `src/app/api/ads/sync/route.ts` "Sync now" for a signed-in user.
- `src/lib/inquiries/use-ad-platform.ts` hook (session or embed path),
  embed action `list_ad_platform` in `/api/inquiries/embed`.
- `src/components/inquiries/ads-report.tsx` the tab.
- Ingest (`/api/inquiries/ingest`) accepts `utm_*` + `landing_path` and writes
  them in a best-effort update after the main upsert. The HDR website captures
  them into the `hdr_utm` cookie (`lib/attribution.ts`) and forwards them with
  every inquiry and reservation.
- The dashboard's Marketing ROI card now counts every paid source as "from
  ads" and uses synced spend for any month that has it (manual entry stays the
  fallback for earlier months).

## Credentials (Vercel → closebook → Production)

### Meta
- `META_AD_ACCOUNT_ID` optional, defaults to `1584416256379477` (HDR Site Services Ads).
- Token: `META_ADS_ACCESS_TOKEN`, else the existing `META_CAPI_ACCESS_TOKEN`.
  The CAPI token only works if its system user has the ad account assigned
  with **ads_read**. If the sync run shows `(#200)` or `(#100) ... insights`,
  make a token that can read insights: Business Settings → Users → System users
  → the CAPI system user → **Assign assets** → Ad accounts → HDR Site Services
  Ads → *View performance* (or Manage) → **Generate new token** with
  `ads_read`, `read_insights`, `business_management`. Store it as
  `META_ADS_ACCESS_TOKEN`.

### Google Ads
- Reuses `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`,
  `GOOGLE_ADS_CUSTOMER_ID` (Avon Rents 568-735-7869),
  `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (MT Studio MCC 578-696-4100) and
  `GOOGLE_ADS_DEVELOPER_TOKEN`.
- Needs a refresh token with the **`https://www.googleapis.com/auth/adwords`**
  scope. The conversion-upload token only has the Data Manager scope. Mint a
  second one in the OAuth Playground (same client id/secret, same steps as the
  conversion runbook) with scope `https://www.googleapis.com/auth/adwords`
  and store it as `GOOGLE_ADS_REPORTING_REFRESH_TOKEN`. The sync run says
  exactly this when the scope is wrong.
- The Google Cloud project that owns the OAuth client must have the
  **Google Ads API** enabled, and the developer token must have at least
  **Basic access** (a test-only token cannot read a production account; the
  error says `DEVELOPER_TOKEN_NOT_APPROVED`).
- `GOOGLE_ADS_CAMPAIGN_MATCH` optional, default `hdr`: only campaigns whose
  name contains it count for HDR. The sync run's detail lists every campaign
  name seen in the account, so the filter can be adjusted.
- `GOOGLE_ADS_API_VERSION` optional pin; otherwise v23 → v22 → v21 → v20 are
  tried until one answers.

### ChatGPT Ads
- `OPENAI_ADS_API_KEY` from ads.openai.com → Settings → API keys (one key per
  ad account). Docs: https://developers.openai.com/ads/api-reference/insights

## Operate

- Backfill after adding a credential:
  `GET https://closebook.vercel.app/api/sync/ad-platforms?since=2026-08-01&until=<today>`
  with `Authorization: Bearer <CRON_SECRET>`, or press **Backfill since Aug 1**
  on the tab.
- The tab's **Data sources** block shows each platform's last run and error
  text. Nothing needs Vercel logs.
- Ad-level lead matching uses `utm_content`: an ad id, or a slug contained in
  the ad name. Set Meta ad URL parameters to
  `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}`
  for exact matching. Google Performance Max reports at campaign level only.

## Read-only Google Ads MCP for Claude (optional)

Google's MCP server (https://developers.google.com/google-ads/api/docs/developer-toolkit/mcp-server)
gives Claude Code ad-hoc GAQL access; it does not feed Closebook. It needs
`pipx`, a Google Cloud project id, the developer token, and an OAuth login run
by a person (`gcloud auth application-default login` with the adwords scope).
Closebook's cron is the source of truth either way.
