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

> **API note:** As of Google's **2026-06-15 migration**, offline conversions for
> Google Ads go through the **Data Manager API** (`datamanager.googleapis.com/v1/events:ingest`),
> NOT the legacy Google Ads API `uploadClickConversions` (now closed to new
> accounts → `CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE`). No developer token and
> no Google Ads API version are involved. Auth is OAuth with the
> `https://www.googleapis.com/auth/datamanager` scope only.

## Live configuration (HDR / Avon Rents)

- **Operating account** (owns the conversion action): Avon Rents `568-735-7869` → `GOOGLE_ADS_CUSTOMER_ID=5687357869`
- **Login account** (manager / MCC): MT Studio Services `578-696-4100` → `GOOGLE_ADS_LOGIN_CUSTOMER_ID=5786964100`
- **Conversion action**: "Purchase (Rental Booked)" → `GOOGLE_ADS_CONVERSION_ACTION_ID=7652068547` (read from the action URL's `ctId=`)
- **OAuth client + Data Manager API**: Google Cloud project `85789004106` ("Closebook Ads"), client `85789004106-…apps.googleusercontent.com`
- Enhanced conversions for leads: **ON** (Goals → Settings), customer data terms **Accepted**

## One-time setup

### 1. Create the conversion action in Google Ads
**Goals → Conversions → + Create conversion → Offline → "Connect data source later"**.
- Category: **Purchase** (or "Qualified lead").
- Value: "Use different values for each conversion".
- On the Summary page, ignore the data-source connector buttons (we feed it via
  the API). Open the action; its numeric ID is the `ctId=` in the URL →
  `GOOGLE_ADS_CONVERSION_ACTION_ID`.

### 2. Turn on Enhanced Conversions for Leads (REQUIRED by the Data Manager API)
**Goals → Settings** → accept **Customer data terms**, then check **Turn on
enhanced conversions for leads** and Save (Google tag method is fine). Without
this the API rejects with `DESTINATION_ACCOUNT_NOT_ENABLED_ENHANCED_CONVERSIONS_FOR_LEADS`.
Account-level changes take a few minutes to propagate.

### 3. Enable the Data Manager API + OAuth client (Google Cloud)
- Enable the **Data Manager API** in the project that owns the OAuth client:
  `https://console.developers.google.com/apis/api/datamanager.googleapis.com/overview?project=<PROJECT_NUMBER>`
  (project number = the digits prefix of the client ID).
- OAuth client (Google Auth Platform → Clients): **Web application**, redirect URI
  `https://developers.google.com/oauthplayground` → `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET`.
- **Refresh token** via the OAuth Playground using your own client creds, scope
  **`https://www.googleapis.com/auth/datamanager`** (Access type Offline, Force
  prompt Consent) → `GOOGLE_ADS_REFRESH_TOKEN`. NB: a token minted with the old
  `adwords` scope will NOT work — it must be the `datamanager` scope.

### 4. Env vars (Vercel → closebook project, Production)
```
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=        # minted with the datamanager scope
GOOGLE_ADS_CUSTOMER_ID=         # operating (conversion-action) account, digits only
GOOGLE_ADS_LOGIN_CUSTOMER_ID=   # manager (MCC) id, digits only
GOOGLE_ADS_CONVERSION_ACTION_ID=
```
(`GOOGLE_ADS_DEVELOPER_TOKEN` is no longer used.) Until the required vars are set,
the cron is a safe no-op (`skipped: Google Ads not configured`) and leaves won
inquiries queued, so they upload automatically once credentials land.

> **Setting env vars gotcha:** in this shell `vercel env add` via a stdin pipe
> stored EMPTY values silently. `vercel env pull` also can't read encrypted
> values back (shows blank) — don't trust it to verify. Verify at runtime
> instead: hit the cron endpoint; "Nothing queued" (not "skipped") = vars are
> readable. Prefer setting via the Vercel dashboard UI.

## Apply & verify
1. Run migration `supabase/migrations/20260616_inquiry_ads_conversions.sql`.
2. Deploy. The cron is registered in `vercel.json` (`0 11 * * *`).
3. Credential test (no data written): `node scripts/test-gads-upload.mjs` with the
   `GOOGLE_ADS_*` vars exported — sends a `validateOnly` events:ingest; HTTP 200 +
   `requestId` = the whole pipeline is accepted.
4. Manual flush: `GET /api/sync/google-ads-conversions` with `Authorization: Bearer $CRON_SECRET`.
5. In Google Ads, conversions appear under the action within ~24–48h. Check the
   action's **Diagnostics** tab for match-rate / upload health.

## Files
- `supabase/migrations/20260616_inquiry_ads_conversions.sql` — columns + trigger
- `src/lib/google-ads/conversions.ts` — OAuth + hashing + Data Manager events:ingest
- `src/app/api/sync/google-ads-conversions/route.ts` — daily cron
- `scripts/test-gads-upload.mjs` — credential test (validateOnly)
- `vercel.json` — cron schedule
