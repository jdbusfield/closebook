-- Meta Qualified Leads (CRM integration): one row per lead stage reported to
-- the Meta Conversions API for an HDR inquiry. Meta wants an event every time
-- a lead moves to a stage that matters (Lead -> Quoted -> Booked), sent with
-- action_source=system_generated and custom_data.event_source=crm, so ad
-- delivery can learn which leads turn into bookings.
--
-- The unique (inquiry_id, stage) row makes the hourly cron idempotent: a stage
-- is sent once. status 'skipped' = the stage happened more than 7 days before
-- we saw it (the Conversions API rejects older event_time values).

CREATE TABLE IF NOT EXISTS meta_crm_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  inquiry_id uuid NOT NULL REFERENCES rental_inquiries(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('Lead', 'Quoted', 'Booked')),
  event_time timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquiry_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_meta_crm_stage_events_entity
  ON meta_crm_stage_events(entity_id, created_at DESC);

ALTER TABLE meta_crm_stage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view Meta CRM stage events in their entities" ON meta_crm_stage_events;
CREATE POLICY "Users can view Meta CRM stage events in their entities"
  ON meta_crm_stage_events FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
