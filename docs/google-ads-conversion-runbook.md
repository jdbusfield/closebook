# Google Ads Conversion Attribution — Runbook

Attributes won HDR rentals back to Google Ads so bidding optimizes for revenue,
not just form fills.

## How the loop works

```
Rep moves an inquiry to "Confirmed" or "Out" in the CRM
        │  (any path: embed board, [id] PATCH, in-app)
        ▼
DB trigger flags conversion_status='pending', snapshots the value
   (migration 20260616, fn mark_inquiry_conversion_pending)
        ▼
Daily cron  /api/sync/google-ads-conversions  (11:00 UTC)
        │  Enhanced Conversions for Leads — matches the click by
        │  hashed email/phone; value = booking amount; orderId = HDR-XXXXX
        ▼
Google Ads conversion recorded  → conversion_status='uploaded'
```

- Won → uploaded automatically. No manual step per deal.
- Pulled back out of a won stage before upload → marked `skipped` (not sent).
- An upload error → `failed`, and the next daily run retries it.
- No gclid is captured today; matching is by hashed email/phone. The `gclid`
  column exists so click-level matching can be turned on later (capture gclid on
  the /reserve form → pass through ingest → it's sent automatically).

## One-time setup

### 1. Create the conversion action in Google Ads
Tools & Settings → **Goals → Conversions → + New conversion action → Import →
"Other data sources or CRMs" → "Track conversions from clicks"**.
- Category: **Purchase** (or "Qualified lead" if you prefer to keep it separate
  from web purchases).
- Note the **Conversion action ID** (the long number) → `GOOGLE_ADS_CONVERSION_ACTION_ID`.

### 2. Turn on Enhanced Conversions for Leads
Google Ads → **Goals → Settings → Customer data terms** → accept, then enable
**Enhanced conversions for leads** and choose the **Google Ads API** upload
method (NOT Google Tag — we upload server-side). This is what lets the hashed
email/phone match a click to our offline conversion.

### 3. API access
- Apply for a **Developer token** (API Center, under the manager account) →
  `GOOGLE_ADS_DEVELOPER_TOKEN`.
- OAuth client (Google Cloud console) → `GOOGLE_ADS_CLIENT_ID` /
  `GOOGLE_ADS_CLIENT_SECRET`, and generate a **refresh token** for an account
  with access → `GOOGLE_ADS_REFRESH_TOKEN`.
- `GOOGLE_ADS_CUSTOMER_ID` = the account that owns the conversion action (digits
  only, no dashes). If access is through a manager (MCC), also set
  `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the manager id.

### 4. Env vars (Vercel → closebook project)
```
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=          # conversion-action account, digits only
GOOGLE_ADS_LOGIN_CUSTOMER_ID=    # optional: manager (MCC) id
GOOGLE_ADS_CONVERSION_ACTION_ID= # numeric id from step 1
# GOOGLE_ADS_API_VERSION=v18     # optional override; defaults to v18
```
Until all required vars are set, the cron is a safe no-op: it logs
`skipped: Google Ads not configured` and leaves won inquiries queued, so they
upload automatically the moment credentials land.

## Apply & verify
1. Run migration `supabase/migrations/20260616_inquiry_ads_conversions.sql`.
2. Deploy. The cron is registered in `vercel.json` (`0 11 * * *`).
3. Manual flush / test: `GET /api/sync/google-ads-conversions` with
   `Authorization: Bearer $CRON_SECRET`. Response reports `uploaded/failed/errors`.
4. In Google Ads, conversions appear under the action within ~24–48h (offline
   imports are not instant). Check **Diagnostics** on the conversion action for
   match-rate / upload health.

## Files
- `supabase/migrations/20260616_inquiry_ads_conversions.sql` — columns + trigger
- `src/lib/google-ads/conversions.ts` — OAuth + hashing + uploadClickConversions
- `src/app/api/sync/google-ads-conversions/route.ts` — daily cron
- `vercel.json` — cron schedule
