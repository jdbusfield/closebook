-- ============================================================================
-- Allow in-app deletion of rental inquiries.
-- The original 20260528 migration intentionally withheld a DELETE policy
-- ("Deletes are intentionally not granted to app users"). We now permit any
-- member of the inquiry's entity to delete it — used to clear out test/junk
-- inquiries from the pipeline board.
--
-- Child rows (rental_inquiry_messages, rental_inquiry_email_events) already
-- cascade via their FK ON DELETE CASCADE, so deleting the inquiry cleans up
-- its full email thread and delivery events automatically.
-- ============================================================================

CREATE POLICY "Users can delete inquiries in their entities"
  ON rental_inquiries FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));
