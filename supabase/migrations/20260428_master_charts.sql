-- ============================================================================
-- MASTER CHARTS
-- Adds support for multiple Master GL "charts" per organization so that the
-- same underlying entity-level account data can be rolled up two different
-- ways: a company-prepared (management) view and an accountant-prepared view
-- with potentially different aggregations.
--
-- Phase 1 (this migration) is schema only and backwards-compatible: existing
-- master_accounts and master_account_mappings rows are re-parented under each
-- organization's new "Management" chart, and an empty "Accountant" chart is
-- seeded per organization for users to populate later. Existing queries that
-- do not filter by chart_id will continue to return the management chart
-- because the accountant chart has no rows yet.
-- ============================================================================

CREATE TABLE master_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('management', 'accountant')),
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, kind)
);

CREATE INDEX idx_master_charts_org ON master_charts(organization_id);

-- Seed one Management chart per organization. Existing master_accounts rows
-- are re-parented to this chart below.
INSERT INTO master_charts (organization_id, name, kind, is_default)
SELECT id, 'Management', 'management', true
FROM organizations
ON CONFLICT (organization_id, kind) DO NOTHING;

-- Seed one Accountant chart per organization. Starts empty; the user populates
-- it via the mapping UI in a later phase.
INSERT INTO master_charts (organization_id, name, kind, is_default)
SELECT id, 'Accountant', 'accountant', false
FROM organizations
ON CONFLICT (organization_id, kind) DO NOTHING;

-- ============================================================================
-- master_accounts: add chart_id, backfill, replace unique constraint
-- ============================================================================

ALTER TABLE master_accounts
  ADD COLUMN chart_id uuid REFERENCES master_charts(id) ON DELETE CASCADE;

UPDATE master_accounts ma
SET chart_id = mc.id
FROM master_charts mc
WHERE mc.organization_id = ma.organization_id
  AND mc.kind = 'management'
  AND ma.chart_id IS NULL;

ALTER TABLE master_accounts
  ALTER COLUMN chart_id SET NOT NULL;

-- Account numbers must be unique within a chart, not within an organization,
-- so the accountant chart can reuse numbers (e.g. 4000-Combined Rental).
ALTER TABLE master_accounts
  DROP CONSTRAINT IF EXISTS master_accounts_organization_id_account_number_key;

ALTER TABLE master_accounts
  ADD CONSTRAINT master_accounts_chart_id_account_number_key
  UNIQUE (chart_id, account_number);

CREATE INDEX idx_master_accounts_chart ON master_accounts(chart_id);

-- ============================================================================
-- master_account_mappings: add chart_id, backfill, replace unique constraint
-- ============================================================================

ALTER TABLE master_account_mappings
  ADD COLUMN chart_id uuid REFERENCES master_charts(id) ON DELETE CASCADE;

UPDATE master_account_mappings m
SET chart_id = ma.chart_id
FROM master_accounts ma
WHERE ma.id = m.master_account_id
  AND m.chart_id IS NULL;

ALTER TABLE master_account_mappings
  ALTER COLUMN chart_id SET NOT NULL;

-- Each (entity, entity_account) pair gets one mapping per chart.
ALTER TABLE master_account_mappings
  DROP CONSTRAINT IF EXISTS master_account_mappings_entity_id_account_id_key;

ALTER TABLE master_account_mappings
  ADD CONSTRAINT master_account_mappings_entity_account_chart_key
  UNIQUE (entity_id, account_id, chart_id);

CREATE INDEX idx_master_account_mappings_chart ON master_account_mappings(chart_id);

-- Keep the denormalized chart_id on a mapping in sync with its master account.
CREATE OR REPLACE FUNCTION enforce_mapping_chart_consistency()
RETURNS TRIGGER AS $$
DECLARE
  expected_chart uuid;
BEGIN
  SELECT chart_id INTO expected_chart FROM master_accounts WHERE id = NEW.master_account_id;
  IF expected_chart IS NULL THEN
    RAISE EXCEPTION 'master_account % not found', NEW.master_account_id;
  END IF;
  IF NEW.chart_id IS NULL THEN
    NEW.chart_id := expected_chart;
  ELSIF NEW.chart_id <> expected_chart THEN
    RAISE EXCEPTION 'mapping chart_id (%) must match master_account chart_id (%)', NEW.chart_id, expected_chart;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_mapping_chart_consistency_trigger
  BEFORE INSERT OR UPDATE ON master_account_mappings
  FOR EACH ROW EXECUTE FUNCTION enforce_mapping_chart_consistency();

-- ============================================================================
-- ROW LEVEL SECURITY: master_charts
-- ============================================================================

ALTER TABLE master_charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view master charts" ON master_charts FOR SELECT USING (
  organization_id IN (SELECT public.user_org_ids())
);

CREATE POLICY "Admins and controllers can insert master charts" ON master_charts FOR INSERT WITH CHECK (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can update master charts" ON master_charts FOR UPDATE USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

CREATE POLICY "Admins and controllers can delete master charts" ON master_charts FOR DELETE USING (
  organization_id IN (
    SELECT organization_id FROM organization_members
    WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
  )
);

CREATE TRIGGER update_master_charts_updated_at
  BEFORE UPDATE ON master_charts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
