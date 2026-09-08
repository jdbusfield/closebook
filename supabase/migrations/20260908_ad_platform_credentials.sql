-- OAuth tokens the ads sync obtains through Closebook's own sign-in flow
-- (Google Ads reporting first). Service role only: RLS is on with no
-- policies, so nothing in the browser can read a token. One row per
-- platform + key (e.g. google / refresh_token).

CREATE TABLE IF NOT EXISTS ad_platform_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('meta', 'google', 'chatgpt')),
  key text NOT NULL,
  value text NOT NULL,
  granted_scope text,
  account_hint text,
  connected_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, key)
);

ALTER TABLE ad_platform_credentials ENABLE ROW LEVEL SECURITY;
