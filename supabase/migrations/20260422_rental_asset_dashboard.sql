-- ============================================================================
-- RENTAL ASSET DASHBOARD — schema
-- ============================================================================
-- Adds the organization-level Rental Asset dashboard data model:
--   1. Columns on fixed_assets for Fleetio linkage and rental/service split
--   2. rental_asset_vin_bridge — Veh_number → VIN map (from Insurance Fleet Report)
--   3. organization_integrations — credential vault for external API providers
--   4. fleetio_sync_state / fleetio_webhook_events — sync bookkeeping
--   5. rental_asset_maintenance / rental_asset_meter_readings — Fleetio mirrors
--   6. rental_asset_kpis — monthly KPIs from the DBR utilization spreadsheet
--
-- Linking chain confirmed empirically: spreadsheet Veh_number → VIN bridge →
-- fixed_assets.vin → Fleetio.vin. 94% auto-coverage on Jan 2026 data with
-- the bridge applied; remaining 26 rows are tracked as "orphan" KPIs anchored
-- by bridge_vin so their revenue/util still shows up.

-- ============================================================================
-- 1. FIXED ASSETS EXTENSIONS
-- ============================================================================

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS fleetio_vehicle_id bigint,
  ADD COLUMN IF NOT EXISTS fleetio_group_name text,
  ADD COLUMN IF NOT EXISTS fleetio_last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS rental_category text NOT NULL DEFAULT 'rental'
    CHECK (rental_category IN ('rental', 'service', 'other')),
  ADD COLUMN IF NOT EXISTS rental_category_source text NOT NULL DEFAULT 'auto'
    CHECK (rental_category_source IN ('auto', 'manual')),
  ADD COLUMN IF NOT EXISTS odometer_current numeric(12, 2),
  ADD COLUMN IF NOT EXISTS odometer_current_as_of date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fixed_assets_fleetio_vehicle
  ON fixed_assets (fleetio_vehicle_id)
  WHERE fleetio_vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fixed_assets_rental_category
  ON fixed_assets (rental_category);

COMMENT ON COLUMN fixed_assets.fleetio_vehicle_id IS
  'Fleetio vehicle.id for this asset. Auto-linked by VIN; user can override.';
COMMENT ON COLUMN fixed_assets.rental_category IS
  'Dashboard filter: rental = rentable fleet asset; service = internal shop/service; other = ledger adjustment / non-vehicle.';
COMMENT ON COLUMN fixed_assets.rental_category_source IS
  'auto = set by classification rule; manual = user override (protected from re-classification).';
COMMENT ON COLUMN fixed_assets.odometer_current IS
  'Most recent odometer/hour reading from Fleetio meter_entries.';

-- ============================================================================
-- 2. VIN BRIDGE (from Insurance Fleet Report)
-- ============================================================================
-- DBR uses prefixed vehicle numbers (V92507, HT1120, PML005) that don't match
-- closebook's plain numeric asset_tag (925125, ...). Insurance Fleet Report
-- publishes a VEH_NO → VIN mapping we use as the bridge.

CREATE TABLE IF NOT EXISTS rental_asset_vin_bridge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  veh_number text NOT NULL,
  vin text NOT NULL,
  create_date date,
  current_location text,
  make text,
  model text,
  sale_date date,
  status_code text,
  last_ra_number text,
  source_filename text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, veh_number)
);

CREATE INDEX IF NOT EXISTS idx_vin_bridge_vin
  ON rental_asset_vin_bridge (organization_id, vin);

ALTER TABLE rental_asset_vin_bridge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view VIN bridge in their org"
  ON rental_asset_vin_bridge FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage VIN bridge"
  ON rental_asset_vin_bridge FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE TRIGGER update_rental_asset_vin_bridge_updated_at
  BEFORE UPDATE ON rental_asset_vin_bridge
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 3. ORGANIZATION INTEGRATIONS (credential vault)
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL,                 -- 'fleetio', future: 'rentalworks', etc.
  account_ref text,                       -- provider's account slug / token (non-secret)
  api_key_ciphertext text,                -- encrypted
  api_key_iv text,
  webhook_secret_ciphertext text,
  webhook_secret_iv text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

ALTER TABLE organization_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view integrations"
  ON organization_integrations FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE POLICY "Admins manage integrations"
  ON organization_integrations FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE TRIGGER update_organization_integrations_updated_at
  BEFORE UPDATE ON organization_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 4. FLEETIO SYNC STATE + WEBHOOK LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS fleetio_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource text NOT NULL,                 -- 'vehicles' | 'service_entries' | 'meter_entries' | 'work_orders' | 'issues'
  last_full_sync_at timestamptz,
  last_incremental_sync_at timestamptz,
  last_seen_updated_at timestamptz,       -- high-water mark
  last_cursor text,
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'error')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, resource)
);

ALTER TABLE fleetio_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view sync state"
  ON fleetio_sync_state FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage sync state"
  ON fleetio_sync_state FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE TRIGGER update_fleetio_sync_state_updated_at
  BEFORE UPDATE ON fleetio_sync_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS fleetio_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fleetio_event_id text NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  process_error text,
  UNIQUE (organization_id, fleetio_event_id)
);

CREATE INDEX IF NOT EXISTS idx_fleetio_webhook_events_unprocessed
  ON fleetio_webhook_events (organization_id, received_at)
  WHERE processed_at IS NULL;

ALTER TABLE fleetio_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view webhook events"
  ON fleetio_webhook_events FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

-- ============================================================================
-- 5. FLEETIO MIRRORS: MAINTENANCE + METER READINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS rental_asset_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fixed_asset_id uuid REFERENCES fixed_assets(id) ON DELETE SET NULL,
  fleetio_vehicle_id bigint NOT NULL,
  fleetio_id bigint NOT NULL,
  source text NOT NULL CHECK (source IN ('service_entry', 'work_order', 'issue', 'expense_entry')),
  status text,
  started_at timestamptz,
  completed_at timestamptz,
  reference text,
  general_notes text,
  vendor_name text,
  total_amount numeric(19, 4),
  labor_amount numeric(19, 4),
  parts_amount numeric(19, 4),
  tax_amount numeric(19, 4),
  meter_value_at_service numeric(12, 2),
  primary_meter_unit text,
  line_items jsonb,
  raw jsonb,
  fleetio_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source, fleetio_id)
);

CREATE INDEX IF NOT EXISTS idx_maint_asset_date
  ON rental_asset_maintenance (fixed_asset_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_maint_org_date
  ON rental_asset_maintenance (organization_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_maint_fleetio_veh
  ON rental_asset_maintenance (organization_id, fleetio_vehicle_id, completed_at DESC);

ALTER TABLE rental_asset_maintenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view maintenance in their org"
  ON rental_asset_maintenance FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage maintenance"
  ON rental_asset_maintenance FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller', 'preparer')
    )
  );

CREATE TABLE IF NOT EXISTS rental_asset_meter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fixed_asset_id uuid REFERENCES fixed_assets(id) ON DELETE CASCADE,
  fleetio_vehicle_id bigint NOT NULL,
  fleetio_id bigint NOT NULL,
  meter_value numeric(12, 2) NOT NULL,
  meter_unit text NOT NULL,
  reading_date date NOT NULL,
  source text,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, fleetio_id)
);

CREATE INDEX IF NOT EXISTS idx_meter_asset_date
  ON rental_asset_meter_readings (fixed_asset_id, reading_date DESC);
CREATE INDEX IF NOT EXISTS idx_meter_org_date
  ON rental_asset_meter_readings (organization_id, reading_date DESC);

ALTER TABLE rental_asset_meter_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view meter readings"
  ON rental_asset_meter_readings FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Admins manage meter readings"
  ON rental_asset_meter_readings FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller', 'preparer')
    )
  );

-- ============================================================================
-- 6. RENTAL ASSET KPIs (from DBR utilization spreadsheet)
-- ============================================================================

CREATE TABLE IF NOT EXISTS rental_asset_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_year int NOT NULL,
  period_month int NOT NULL,
  grain text NOT NULL CHECK (grain IN ('asset', 'reporting_group', 'entity', 'equipment_pool')),

  -- Grain anchors (exactly one should be set based on grain)
  fixed_asset_id uuid REFERENCES fixed_assets(id) ON DELETE CASCADE,
  reporting_group text,                   -- set when grain='reporting_group'
  entity_id uuid REFERENCES entities(id) ON DELETE CASCADE,
  equipment_pool_key text,                -- e.g. 'BATH', 'EQU', 'KSCF01'

  -- Orphan anchor: sheet row that couldn't be linked to fixed_assets — we
  -- still record the KPI but mark it by bridge VIN / veh_number so the
  -- dashboard can surface an "orphan" panel for the user to resolve.
  orphan_bridge_vin text,
  orphan_veh_number text,

  -- Identity fields from the DBR row (informational; source of truth is the
  -- spreadsheet column layout in Jan 2026 utilization data.xlsx)
  dbr_status text,
  sale_date date,

  -- Core KPI numbers
  fleet_days numeric(10, 4),              -- col I — denominator (already reduced for mid-period sales)
  rental_dbr_days numeric(10, 4),         -- col J — DBR numerator
  rental_act_days numeric(10, 4),         -- col K — actual numerator
  total_revenue numeric(19, 4),           -- col L — revenue numerator for $ util
  avg_revenue_per_day numeric(19, 4),     -- col M
  charged_rate numeric(19, 4),            -- col N
  standard_rate numeric(19, 4),           -- col O
  charged_location text,                  -- col P
  dbr_util_pct numeric(7, 4),             -- col Q (source-system computed)
  act_util_pct numeric(7, 4),             -- col R
  rev_util_pct numeric(7, 4),             -- col S
  subrental_flag text,                    -- col T

  source_filename text,
  uploaded_by uuid REFERENCES profiles(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Enforce "one row per (period, grain anchor)"
  UNIQUE NULLS NOT DISTINCT (
    organization_id, period_year, period_month, grain,
    fixed_asset_id, reporting_group, entity_id, equipment_pool_key,
    orphan_bridge_vin, orphan_veh_number
  )
);

CREATE INDEX IF NOT EXISTS idx_kpis_org_period
  ON rental_asset_kpis (organization_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_kpis_asset
  ON rental_asset_kpis (fixed_asset_id, period_year, period_month)
  WHERE fixed_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kpis_group
  ON rental_asset_kpis (organization_id, reporting_group, period_year, period_month)
  WHERE grain = 'reporting_group';
CREATE INDEX IF NOT EXISTS idx_kpis_orphan
  ON rental_asset_kpis (organization_id, orphan_bridge_vin)
  WHERE orphan_bridge_vin IS NOT NULL;

ALTER TABLE rental_asset_kpis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view KPIs in their org"
  ON rental_asset_kpis FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Preparers manage KPIs"
  ON rental_asset_kpis FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller', 'preparer')
    )
  );

CREATE TRIGGER update_rental_asset_kpis_updated_at
  BEFORE UPDATE ON rental_asset_kpis
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 7. COMMENTS
-- ============================================================================

COMMENT ON TABLE rental_asset_vin_bridge IS
  'Maps DBR Veh_number (with V/HT/PML prefixes) to canonical VIN so we can join the utilization spreadsheet to closebook and Fleetio through VIN.';
COMMENT ON TABLE rental_asset_kpis IS
  'Monthly rental-asset KPIs imported from the DBR utilization spreadsheet. Granularities: asset (primary), reporting_group, entity, equipment_pool. Orphan anchor supports assets on the DBR but not in fixed_assets.';
COMMENT ON TABLE rental_asset_maintenance IS
  'Mirror of Fleetio service_entries / work_orders, keyed by fleetio_id. Read-only replica; we never write back to Fleetio.';
COMMENT ON TABLE rental_asset_meter_readings IS
  'Mirror of Fleetio meter_entries (odometer/hours). GPS-sourced readings do not fire webhooks and must be picked up by daily poll.';
