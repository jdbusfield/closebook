-- ============================================================================
-- GMAIL SYNC STATE + thread stickiness
-- Supports real-time capture of hdrsiteservices.com Google Workspace mail into
-- the rental-inquiry CRM via Gmail API users.watch -> Cloud Pub/Sub push.
--   * gmail_sync_state: one cursor row per watched mailbox — history_id drives
--     the incremental users.history.list fetch, watch_expiration drives the
--     daily 7-day renewal.
--   * rental_inquiry_messages.gmail_thread_id: lets every later reply in a
--     known Gmail thread stick to the inquiry the thread first matched, even
--     after the subject loses its HDR-XXXXX reference tag.
-- Server-only plumbing: all writes go through the service-role (admin) client.
-- ============================================================================

-- Per-mailbox Gmail sync cursor.
CREATE TABLE IF NOT EXISTS gmail_sync_state (
  email_address    text PRIMARY KEY,
  history_id       text,
  watch_expiration timestamptz,
  last_synced_at   timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Deny-by-default: no policies means only the service-role client can touch it.
-- App users have no business reading the raw sync cursor.
ALTER TABLE gmail_sync_state ENABLE ROW LEVEL SECURITY;

-- Gmail thread id for thread-stickiness matching.
ALTER TABLE rental_inquiry_messages
  ADD COLUMN IF NOT EXISTS gmail_thread_id text;

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_messages_gmail_thread
  ON rental_inquiry_messages(gmail_thread_id) WHERE gmail_thread_id IS NOT NULL;
