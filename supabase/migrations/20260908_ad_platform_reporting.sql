-- Ads reporting: daily spend/impressions/clicks per platform, pulled by the
-- /api/sync/ad-platforms cron from Meta (Marketing API), Google Ads (GAQL) and
-- OpenAI Ads (Insights API). One row per entity + platform + day + campaign +
-- ad set/ad group + ad. Campaign-only platforms (Google Performance Max) leave
-- adset_id/ad_id as ''. The Ads tab in the sales CRM joins these rows to
-- rental_inquiries by paid source (fbclid / gclid / oppref) and, when the
-- website forwarded them, by utm_campaign / utm_content.

CREATE TABLE IF NOT EXISTS ad_platform_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta', 'google', 'chatgpt')),
  date date NOT NULL,
  campaign_id text NOT NULL DEFAULT '',
  campaign_name text,
  adset_id text NOT NULL DEFAULT '',
  adset_name text,
  ad_id text NOT NULL DEFAULT '',
  ad_name text,
  spend numeric(12,2) NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  reach bigint,
  -- What the platform itself reports as conversions (Meta pixel Lead, Google
  -- conversions column). Closebook leads are counted separately from
  -- rental_inquiries and are the number that matters.
  platform_conversions numeric(12,2),
  currency text NOT NULL DEFAULT 'USD',
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, platform, date, campaign_id, adset_id, ad_id)
);

CREATE INDEX IF NOT EXISTS idx_ad_platform_daily_entity_date
  ON ad_platform_daily(entity_id, date);

ALTER TABLE ad_platform_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view ad platform rows in their entities" ON ad_platform_daily;
CREATE POLICY "Users can view ad platform rows in their entities"
  ON ad_platform_daily FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
-- Writes come only from the sync job (service role), never from the browser.

-- One row per sync attempt per platform so the Ads tab can show "last synced"
-- and surface credential problems without anyone reading Vercel logs.
CREATE TABLE IF NOT EXISTS ad_platform_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta', 'google', 'chatgpt')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean NOT NULL DEFAULT false,
  since date,
  until date,
  rows_upserted integer NOT NULL DEFAULT 0,
  error text,
  detail jsonb
);

CREATE INDEX IF NOT EXISTS idx_ad_platform_sync_runs_entity
  ON ad_platform_sync_runs(entity_id, platform, started_at DESC);

ALTER TABLE ad_platform_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view ad sync runs in their entities" ON ad_platform_sync_runs;
CREATE POLICY "Users can view ad sync runs in their entities"
  ON ad_platform_sync_runs FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

-- Campaign-level attribution on the lead itself. The website reads utm_* off
-- the landing URL into a first-party cookie and forwards them with the lead
-- (same pattern as gclid/fbclid/oppref). utm_content is set per ad on the Meta
-- side (ad1_hollywood_hook etc.) so a lead can be tied to the ad that won it.
ALTER TABLE rental_inquiries
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS landing_path text;
