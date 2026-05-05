-- Explicit cross-chart line links between accountant-prepared and
-- management-prepared master accounts. The bridge engine prefers an
-- explicit link when present; absent that, it falls back to the
-- heuristic name-similarity matcher.
--
-- A link is between two roots — masters with no parent_account_id —
-- since those are what the rendered statement displays after
-- applyParentRollup. The bridge engine resolves child masters to roots
-- before consulting this table.

CREATE TABLE master_account_bridge_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  accountant_master_id uuid NOT NULL REFERENCES master_accounts(id) ON DELETE CASCADE,
  management_master_id uuid NOT NULL REFERENCES master_accounts(id) ON DELETE CASCADE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Each accountant master is linked to at most one management master and
  -- vice-versa. The bridge UI surfaces conflicts; multi-link routing is
  -- not supported in v1.
  UNIQUE (organization_id, accountant_master_id),
  UNIQUE (organization_id, management_master_id)
);

CREATE INDEX idx_master_acct_bridge_links_org
  ON master_account_bridge_links(organization_id);

CREATE INDEX idx_master_acct_bridge_links_acc
  ON master_account_bridge_links(accountant_master_id);

CREATE INDEX idx_master_acct_bridge_links_mgt
  ON master_account_bridge_links(management_master_id);

ALTER TABLE master_account_bridge_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY master_account_bridge_links_member_select
  ON master_account_bridge_links
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY master_account_bridge_links_member_write
  ON master_account_bridge_links
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    )
  );
