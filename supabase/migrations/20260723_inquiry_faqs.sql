-- ============================================================================
-- HDR Sales CRM — FAQ reference inside the resource library
-- Question/answer entries reps pull up mid-call or while writing an email
-- (power requirements, water hookups, delivery radius, ADA specs...). Lives in
-- the same slide-out Resources panel as the photo/document library, on its own
-- tab, so it's one click away from every Inquiries view (app and embed).
-- Entity-scoped like the rest of the inquiry CRM, so HDR and Versatile each
-- keep their own answers.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rental_inquiry_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text,                     -- display name; embed has no auth.uid()
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_faqs_entity
  ON rental_inquiry_faqs(entity_id, sort_order);

CREATE TRIGGER update_rental_inquiry_faqs_updated_at
  BEFORE UPDATE ON rental_inquiry_faqs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security — any member of the entity gets full read/write, matching
-- rental_inquiry_resources (operational, not financial-sensitive).
-- ----------------------------------------------------------------------------
ALTER TABLE rental_inquiry_faqs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view faqs in their entities" ON rental_inquiry_faqs;
CREATE POLICY "Users can view faqs in their entities"
  ON rental_inquiry_faqs FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can insert faqs in their entities" ON rental_inquiry_faqs;
CREATE POLICY "Users can insert faqs in their entities"
  ON rental_inquiry_faqs FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can update faqs in their entities" ON rental_inquiry_faqs;
CREATE POLICY "Users can update faqs in their entities"
  ON rental_inquiry_faqs FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can delete faqs in their entities" ON rental_inquiry_faqs;
CREATE POLICY "Users can delete faqs in their entities"
  ON rental_inquiry_faqs FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));
