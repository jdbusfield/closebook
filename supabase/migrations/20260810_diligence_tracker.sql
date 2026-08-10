-- ============================================================================
-- Diligence Tracker
-- Org-level M&A due-diligence module: deals (acquisition / managed-services
-- targets) and their diligence request-list items, grouped by workstream.
-- ============================================================================

CREATE TYPE diligence_deal_stage AS ENUM (
  'target',
  'nda',
  'data_request',
  'diligence',
  'proposal',
  'loi',
  'closing',
  'closed',
  'passed',
  'on_hold'
);

CREATE TYPE diligence_item_status AS ENUM (
  'not_requested',
  'requested',
  'received',
  'in_review',
  'follow_up',
  'complete',
  'not_applicable'
);

CREATE TYPE diligence_priority AS ENUM ('high', 'medium', 'low');

-- ============================================================================
-- Tables
-- ============================================================================

CREATE TABLE diligence_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  counterparty text,
  deal_type text NOT NULL DEFAULT 'acquisition',
  stage diligence_deal_stage NOT NULL DEFAULT 'target',
  description text,
  target_close_date date,
  nda_date date,
  deal_lead uuid REFERENCES profiles(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX idx_diligence_deals_org ON diligence_deals(organization_id);
CREATE INDEX idx_diligence_deals_stage ON diligence_deals(stage);

CREATE TABLE diligence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES diligence_deals(id) ON DELETE CASCADE,
  category text NOT NULL,
  title text NOT NULL,
  details text,
  status diligence_item_status NOT NULL DEFAULT 'not_requested',
  priority diligence_priority NOT NULL DEFAULT 'medium',
  internal_owner text,
  counterparty_owner text,
  requested_date date,
  received_date date,
  due_date date,
  red_flag boolean NOT NULL DEFAULT false,
  finding text,
  doc_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_diligence_items_org ON diligence_items(organization_id);
CREATE INDEX idx_diligence_items_deal ON diligence_items(deal_id);
CREATE INDEX idx_diligence_items_deal_category ON diligence_items(deal_id, category);

-- ============================================================================
-- updated_at triggers
-- ============================================================================

CREATE TRIGGER update_diligence_deals_updated_at
  BEFORE UPDATE ON diligence_deals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_diligence_items_updated_at
  BEFORE UPDATE ON diligence_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================

DO $$
DECLARE
  t text;
  new_tables text[] := ARRAY['diligence_deals', 'diligence_items'];
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Members can view %I" ON %I FOR SELECT USING (organization_id IN (SELECT public.user_org_ids()))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "Members can insert %I" ON %I FOR INSERT WITH CHECK (organization_id IN (SELECT public.user_org_ids()))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "Members can update %I" ON %I FOR UPDATE USING (organization_id IN (SELECT public.user_org_ids()))',
      t, t);
    EXECUTE format(
      'CREATE POLICY "Members can delete %I" ON %I FOR DELETE USING (organization_id IN (SELECT public.user_org_ids()))',
      t, t);
  END LOOP;
END $$;
