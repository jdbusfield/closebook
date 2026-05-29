-- ============================================================================
-- Inbox activity feed: capture ALL inbound mail to sales@, including messages
-- that don't match any inquiry (e.g. the HDR-XXXXX reference was stripped from
-- the subject), so nothing is silently dropped.
-- ============================================================================

-- 1) Allow a message to exist without an inquiry yet (unmatched inbound mail).
ALTER TABLE rental_inquiry_messages ALTER COLUMN inquiry_id DROP NOT NULL;

-- 2) Stamp every message with its entity, so the feed + RLS work even when
--    there is no inquiry to join through.
ALTER TABLE rental_inquiry_messages
  ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES entities(id) ON DELETE CASCADE;

-- Backfill existing rows from their inquiry.
UPDATE rental_inquiry_messages m
  SET entity_id = i.entity_id
  FROM rental_inquiries i
  WHERE m.inquiry_id = i.id AND m.entity_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_messages_entity
  ON rental_inquiry_messages(entity_id, created_at DESC);

-- 3) RLS: scope message reads by entity (covers unmatched rows where
--    inquiry_id is null) instead of only via the inquiry join.
DROP POLICY IF EXISTS "Users can view messages in their entities" ON rental_inquiry_messages;
CREATE POLICY "Users can view messages in their entities"
  ON rental_inquiry_messages FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

-- 4) Allow in-app assignment of an unmatched message to an inquiry.
DROP POLICY IF EXISTS "Users can update messages in their entities" ON rental_inquiry_messages;
CREATE POLICY "Users can update messages in their entities"
  ON rental_inquiry_messages FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));
