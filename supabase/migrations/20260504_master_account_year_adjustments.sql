-- ============================================================================
-- MASTER ACCOUNT YEAR-END ADJUSTMENTS
-- One-shot yearly adjustments scoped to a specific master_chart, used to
-- reconcile the consolidated/financial-model output to externally prepared
-- statements (e.g., the accountant's view) without altering entity GL or
-- the existing IC elimination logic.
--
-- An adjustment is treated as a journal entry on Dec 31 of period_year:
--   - For balance sheet accounts the amount carries forward as part of
--     ending balance (handled by the consolidated/statements code).
--   - For income statement accounts the amount applies to that year only.
-- ============================================================================

CREATE TABLE master_account_year_adjustments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  chart_id          uuid NOT NULL REFERENCES master_charts(id) ON DELETE CASCADE,
  master_account_id uuid NOT NULL REFERENCES master_accounts(id) ON DELETE CASCADE,
  period_year       int  NOT NULL,
  amount            numeric(19,4) NOT NULL DEFAULT 0,
  note              text,
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chart_id, master_account_id, period_year)
);

CREATE INDEX idx_master_acct_year_adj_org
  ON master_account_year_adjustments(organization_id);
CREATE INDEX idx_master_acct_year_adj_chart
  ON master_account_year_adjustments(chart_id, period_year);
CREATE INDEX idx_master_acct_year_adj_account
  ON master_account_year_adjustments(master_account_id);

-- Keep chart_id consistent with the master account's chart.
CREATE OR REPLACE FUNCTION enforce_year_adj_chart_consistency()
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
    RAISE EXCEPTION 'year adjustment chart_id (%) must match master_account chart_id (%)', NEW.chart_id, expected_chart;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_year_adj_chart_consistency_trigger
  BEFORE INSERT OR UPDATE ON master_account_year_adjustments
  FOR EACH ROW EXECUTE FUNCTION enforce_year_adj_chart_consistency();

ALTER TABLE master_account_year_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view year adjustments"
  ON master_account_year_adjustments FOR SELECT
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Admins and controllers can insert year adjustments"
  ON master_account_year_adjustments FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE POLICY "Admins and controllers can update year adjustments"
  ON master_account_year_adjustments FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE POLICY "Admins and controllers can delete year adjustments"
  ON master_account_year_adjustments FOR DELETE
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members
      WHERE user_id = auth.uid() AND role IN ('admin', 'controller')
    )
  );

CREATE TRIGGER update_master_account_year_adjustments_updated_at
  BEFORE UPDATE ON master_account_year_adjustments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
