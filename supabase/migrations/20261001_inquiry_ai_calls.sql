-- AI callback calls for HDR restroom-trailer inquiries.
-- Each website inquiry with a phone number gets one queued call that an
-- ElevenLabs voice agent places during calling hours. The post-call webhook
-- fills in the outcome, the collected details and the transcript. A no-answer
-- or busy attempt queues one retry as a new row (attempt + 1).
-- Additive only. Safe to run more than once.

CREATE TABLE IF NOT EXISTS rental_inquiry_ai_calls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id       uuid NOT NULL REFERENCES rental_inquiries(id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'queued',
  attempt          int NOT NULL DEFAULT 1,
  to_number        text NOT NULL,             -- E.164, e.g. +13235550100
  scheduled_for    timestamptz NOT NULL,      -- earliest time the cron may dial
  dialed_at        timestamptz,
  ended_at         timestamptz,
  conversation_id  text UNIQUE,               -- ElevenLabs conversation id
  call_sid         text,                      -- Twilio call SID
  failure_reason   text,                      -- busy | no-answer | unknown | API error text
  call_outcome     text,                      -- agent's data-collection outcome
  hot_lead         boolean,
  do_not_call      boolean NOT NULL DEFAULT false,
  duration_secs    int,
  summary          text,
  collected        jsonb,                     -- { field: value } from data collection
  evaluation       jsonb,                     -- { criteria_id: result }
  transcript       jsonb,                     -- [{ role, message, time_in_call_secs }]
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_inquiry_ai_calls_status_check') THEN
    ALTER TABLE rental_inquiry_ai_calls
      ADD CONSTRAINT rental_inquiry_ai_calls_status_check
      CHECK (status IN ('queued', 'dialing', 'completed', 'voicemail', 'no_answer', 'failed', 'skipped', 'canceled'));
  END IF;
END $$;

-- The cron's work queue.
CREATE INDEX IF NOT EXISTS rental_inquiry_ai_calls_due_idx
  ON rental_inquiry_ai_calls (status, scheduled_for);
-- One row per attempt per inquiry: a redelivered webhook cannot queue a
-- second retry, and a re-ingested inquiry cannot queue a second first call.
CREATE UNIQUE INDEX IF NOT EXISTS rental_inquiry_ai_calls_inquiry_attempt_key
  ON rental_inquiry_ai_calls (inquiry_id, attempt);
-- Do-not-call lookups by phone number.
CREATE INDEX IF NOT EXISTS rental_inquiry_ai_calls_number_idx
  ON rental_inquiry_ai_calls (to_number);

-- Read-only for signed-in members of the entity; all writes go through the
-- service role (ingest, cron, webhook).
ALTER TABLE rental_inquiry_ai_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Entity members can select rental_inquiry_ai_calls" ON rental_inquiry_ai_calls;
CREATE POLICY "Entity members can select rental_inquiry_ai_calls"
  ON rental_inquiry_ai_calls FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
