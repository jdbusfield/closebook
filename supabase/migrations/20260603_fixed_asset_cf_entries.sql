-- Migration: Fixed-Asset Activity schedule entries for the Statement of Cash Flows.
--
-- The Investing line "Other property & equipment activity, net (per general
-- ledger)" is a balancing plug that absorbs every GL fixed-asset movement the
-- model can't explain from the subledger (acquisitions / disposal proceeds) or
-- depreciation.  For entities whose activity is booked by journal entry instead
-- of the fixed-asset register, this schedule lets a controller hand-enter the
-- missing classification so the plug decomposes into proper, labeled lines.
--
-- entry_type semantics (amount is entered as a positive magnitude):
--   cash_purchase      -> capital expenditure paid in cash       (Investing out)
--   disposal_proceeds  -> cash received on a disposal            (Investing in)
--   disposal_writeoff  -> non-cash removal of net book value     (non-cash, labeled)
--   reclass_transfer   -> non-cash reclass / transfer of assets  (non-cash, labeled)
--
-- These entries only reclassify cash-flow GEOGRAPHY; they never change GL
-- balances, net income, or the balance sheet.  The Investing total stays
-- anchored to the GL carrying-value change, so the statement keeps articulating.

CREATE TABLE fixed_asset_cf_entries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id                uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  period_year              int  NOT NULL,
  period_month             int  NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  entry_type               text NOT NULL CHECK (entry_type IN (
                             'cash_purchase',
                             'disposal_proceeds',
                             'disposal_writeoff',
                             'reclass_transfer'
                           )),
  amount                   numeric(19,4) NOT NULL DEFAULT 0,
  -- Optional offset master account (reserved for future GAAP-pure non-cash
  -- double-entry treatment; unused by the v1 engine which itemizes within
  -- Investing).
  offset_master_account_id uuid REFERENCES master_accounts(id) ON DELETE SET NULL,
  description              text NOT NULL,
  notes                    text,
  is_excluded              boolean NOT NULL DEFAULT false,
  created_by               uuid REFERENCES auth.users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_fixed_asset_cf_entries_org
  ON fixed_asset_cf_entries(organization_id);
CREATE INDEX idx_fixed_asset_cf_entries_entity
  ON fixed_asset_cf_entries(entity_id, period_year, period_month);
CREATE INDEX idx_fixed_asset_cf_entries_not_excluded
  ON fixed_asset_cf_entries(organization_id, is_excluded)
  WHERE is_excluded = false;

-- RLS (mirrors pro_forma_adjustments)
ALTER TABLE fixed_asset_cf_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view fixed asset cf entries"
  ON fixed_asset_cf_entries FOR SELECT
  USING (
    organization_id IN (SELECT public.user_org_ids())
  );

CREATE POLICY "Admins and controllers can insert fixed asset cf entries"
  ON fixed_asset_cf_entries FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE POLICY "Admins and controllers can update fixed asset cf entries"
  ON fixed_asset_cf_entries FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE POLICY "Admins and controllers can delete fixed asset cf entries"
  ON fixed_asset_cf_entries FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

-- Updated_at trigger
CREATE TRIGGER update_fixed_asset_cf_entries_updated_at
  BEFORE UPDATE ON fixed_asset_cf_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
