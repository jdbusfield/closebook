-- Monthly ad-spend entries per entity for the sales dashboard's Marketing ROI
-- section. One row per entity per calendar month (month = first of month);
-- amounts are entered by hand (there is no ads-platform integration).

CREATE TABLE IF NOT EXISTS rental_inquiry_ad_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  month date NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, month)
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_ad_spend_entity_month
  ON rental_inquiry_ad_spend(entity_id, month);

ALTER TABLE rental_inquiry_ad_spend ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view ad spend in their entities" ON rental_inquiry_ad_spend;
CREATE POLICY "Users can view ad spend in their entities"
  ON rental_inquiry_ad_spend FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can insert ad spend in their entities" ON rental_inquiry_ad_spend;
CREATE POLICY "Users can insert ad spend in their entities"
  ON rental_inquiry_ad_spend FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can update ad spend in their entities" ON rental_inquiry_ad_spend;
CREATE POLICY "Users can update ad spend in their entities"
  ON rental_inquiry_ad_spend FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can delete ad spend in their entities" ON rental_inquiry_ad_spend;
CREATE POLICY "Users can delete ad spend in their entities"
  ON rental_inquiry_ad_spend FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));
