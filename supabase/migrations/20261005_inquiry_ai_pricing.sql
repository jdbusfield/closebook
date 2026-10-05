-- HDR AI price table.
-- The rates the ElevenLabs callback agent quotes from. JD edits them in
-- Inquiries → AI Price Table; the agent never does the math itself, it calls
-- /api/inquiries/ai-price, which reads this row and returns the total.
-- One row per entity. Seeded with the Oct 1 2026 prices.
-- Additive only. Safe to run more than once.

CREATE TABLE IF NOT EXISTS rental_inquiry_ai_pricing (
  entity_id            uuid PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  private_first_day    numeric NOT NULL DEFAULT 849,   -- backyard / private party, 1 trailer, day 1
  private_extra_day    numeric NOT NULL DEFAULT 150,   -- each additional day
  event_first_day      numeric NOT NULL DEFAULT 1249,  -- weddings and every other event, day 1
  event_extra_day      numeric NOT NULL DEFAULT 150,
  guests_per_trailer   int     NOT NULL DEFAULT 200,   -- 4-stall trailer, 50 guests per stall
  discount_2_pct       numeric NOT NULL DEFAULT 10,    -- off each trailer when renting 2
  discount_3_pct       numeric NOT NULL DEFAULT 20,
  discount_4_plus_pct  numeric NOT NULL DEFAULT 25,
  attendant_hourly     numeric NOT NULL DEFAULT 50,
  attendant_min_hours  numeric NOT NULL DEFAULT 6,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (guests_per_trailer > 0),
  CHECK (discount_2_pct BETWEEN 0 AND 100 AND discount_3_pct BETWEEN 0 AND 100 AND discount_4_plus_pct BETWEEN 0 AND 100)
);

DROP TRIGGER IF EXISTS update_rental_inquiry_ai_pricing_updated_at ON rental_inquiry_ai_pricing;
CREATE TRIGGER update_rental_inquiry_ai_pricing_updated_at
  BEFORE UPDATE ON rental_inquiry_ai_pricing
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Members of the entity can read and edit; the agent's price route uses the
-- service role.
ALTER TABLE rental_inquiry_ai_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Entity members can select rental_inquiry_ai_pricing" ON rental_inquiry_ai_pricing;
CREATE POLICY "Entity members can select rental_inquiry_ai_pricing"
  ON rental_inquiry_ai_pricing FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Entity members can insert rental_inquiry_ai_pricing" ON rental_inquiry_ai_pricing;
CREATE POLICY "Entity members can insert rental_inquiry_ai_pricing"
  ON rental_inquiry_ai_pricing FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Entity members can update rental_inquiry_ai_pricing" ON rental_inquiry_ai_pricing;
CREATE POLICY "Entity members can update rental_inquiry_ai_pricing"
  ON rental_inquiry_ai_pricing FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

-- HDR (Hollywood Depot Rentals) row with the current prices.
INSERT INTO rental_inquiry_ai_pricing (entity_id)
SELECT id FROM entities WHERE id = '7529580d-3b44-4a9b-91f4-bc2db25f5211'
ON CONFLICT (entity_id) DO NOTHING;
