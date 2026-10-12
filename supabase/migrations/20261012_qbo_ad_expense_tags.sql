-- Tags on QuickBooks advertising charges, so restroom-trailer ad spend can be
-- tracked apart from the other brands' ads that post to the same accounts.
-- One row per QBO transaction line (txn_type + txn_id + line_id) in the
-- entity whose QuickBooks company holds the charge. Untagged lines have no row.
-- restroom_share splits a charge that covers several brands (1 = all restroom).

CREATE TABLE IF NOT EXISTS qbo_ad_expense_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  txn_type text NOT NULL,
  txn_id text NOT NULL,
  line_id text NOT NULL DEFAULT '',
  tag text NOT NULL CHECK (tag IN ('restroom_ads', 'other_ads', 'not_ads')),
  restroom_share numeric NOT NULL DEFAULT 1 CHECK (restroom_share >= 0 AND restroom_share <= 1),
  note text,
  tagged_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, txn_type, txn_id, line_id)
);

CREATE INDEX IF NOT EXISTS idx_qbo_ad_expense_tags_entity
  ON qbo_ad_expense_tags(entity_id);

ALTER TABLE qbo_ad_expense_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view ad expense tags in their entities" ON qbo_ad_expense_tags;
CREATE POLICY "Users can view ad expense tags in their entities"
  ON qbo_ad_expense_tags FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can insert ad expense tags in their entities" ON qbo_ad_expense_tags;
CREATE POLICY "Users can insert ad expense tags in their entities"
  ON qbo_ad_expense_tags FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can update ad expense tags in their entities" ON qbo_ad_expense_tags;
CREATE POLICY "Users can update ad expense tags in their entities"
  ON qbo_ad_expense_tags FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can delete ad expense tags in their entities" ON qbo_ad_expense_tags;
CREATE POLICY "Users can delete ad expense tags in their entities"
  ON qbo_ad_expense_tags FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));
