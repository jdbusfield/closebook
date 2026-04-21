-- Drift detection: monitor GL account balances for unexpected changes between syncs
-- Stores which accounts to monitor per entity, daily snapshots, and drift alerts

-- Which accounts each entity wants to monitor for balance drift
CREATE TABLE drift_monitored_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, account_id)
);

-- Daily balance snapshots for monitored accounts
CREATE TABLE drift_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  ending_balance numeric(19,4) NOT NULL,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, account_id, period_year, period_month, snapshot_date)
);

-- Detected drifts surfaced to users
CREATE TABLE drift_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  previous_balance numeric(19,4) NOT NULL,
  current_balance numeric(19,4) NOT NULL,
  drift_amount numeric(19,4) NOT NULL,
  snapshot_date date NOT NULL,
  previous_snapshot_date date NOT NULL,
  is_dismissed boolean DEFAULT false,
  dismissed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_drift_monitored_entity ON drift_monitored_accounts(entity_id);
CREATE INDEX idx_drift_snapshots_entity_date ON drift_snapshots(entity_id, snapshot_date);
CREATE INDEX idx_drift_snapshots_lookup ON drift_snapshots(entity_id, account_id, period_year, period_month, snapshot_date DESC);
CREATE INDEX idx_drift_alerts_entity ON drift_alerts(entity_id, is_dismissed, created_at DESC);

-- RLS
ALTER TABLE drift_monitored_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view monitored accounts for their entities"
  ON drift_monitored_accounts FOR SELECT USING (
    entity_id IN (SELECT public.user_entity_ids())
  );
CREATE POLICY "Users can manage monitored accounts for their entities"
  ON drift_monitored_accounts FOR ALL USING (
    entity_id IN (SELECT public.user_entity_ids())
  );

ALTER TABLE drift_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view snapshots for their entities"
  ON drift_snapshots FOR SELECT USING (
    entity_id IN (SELECT public.user_entity_ids())
  );

ALTER TABLE drift_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view alerts for their entities"
  ON drift_alerts FOR SELECT USING (
    entity_id IN (SELECT public.user_entity_ids())
  );
CREATE POLICY "Users can update alerts for their entities"
  ON drift_alerts FOR UPDATE USING (
    entity_id IN (SELECT public.user_entity_ids())
  );
