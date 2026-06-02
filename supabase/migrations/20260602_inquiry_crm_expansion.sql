-- ============================================================================
-- HDR Sales CRM expansion
-- Brings the rental-inquiry module up to the full "Bathroom Trailer Rental CRM"
-- design: a 6-stage pipeline, fleet-unit assignment, an estimated $ value,
-- follow-up tasks, and a per-inquiry activity timeline. All additive — no data
-- is dropped; existing statuses are remapped onto the new vocabulary.
--
-- Stage model (board order):
--   open inquiries : new -> quoted -> followup
--   booked rentals : confirmed -> out -> returned
--   terminal       : lost   (kept off the board, visible in Customers)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Repoint the status vocabulary to the design's stages.
-- ---------------------------------------------------------------------------
ALTER TABLE rental_inquiries DROP CONSTRAINT IF EXISTS rental_inquiries_status_check;

-- Remap the prior operational stages onto the design's keys.
--   quote_sent       -> quoted
--   rental_confirmed -> confirmed
--   completed        -> returned
-- 'new' and 'lost' carry over unchanged. 'followup' and 'out' are new (no rows).
UPDATE rental_inquiries SET status = CASE status
  WHEN 'quote_sent'       THEN 'quoted'
  WHEN 'rental_confirmed' THEN 'confirmed'
  WHEN 'completed'        THEN 'returned'
  ELSE status
END
WHERE status IN ('quote_sent', 'rental_confirmed', 'completed');

ALTER TABLE rental_inquiries ADD CONSTRAINT rental_inquiries_status_check
  CHECK (status IN ('new', 'quoted', 'followup', 'confirmed', 'out', 'returned', 'lost'));

-- ---------------------------------------------------------------------------
-- 2) New inquiry columns: assigned fleet unit + estimated value.
--    unit_id is a stable string key into the fixed FLEET roster defined in
--    src/lib/inquiries/shared.ts (e.g. 'u484'); kept as text so the roster can
--    evolve in code without a schema change.
-- ---------------------------------------------------------------------------
ALTER TABLE rental_inquiries
  ADD COLUMN IF NOT EXISTS unit_id text,
  ADD COLUMN IF NOT EXISTS estimated_value numeric;

-- ---------------------------------------------------------------------------
-- 3) Follow-up tasks / reminders (the dashboard's "never drop a follow-up").
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rental_inquiry_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES rental_inquiries(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_date date,
  done boolean NOT NULL DEFAULT false,
  kind text NOT NULL DEFAULT 'call'
    CHECK (kind IN ('call', 'quote', 'email', 'logistics')),
  created_by uuid REFERENCES profiles(id),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_tasks_inquiry
  ON rental_inquiry_tasks(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_rental_inquiry_tasks_entity_open
  ON rental_inquiry_tasks(entity_id, done, due_date);

-- ---------------------------------------------------------------------------
-- 4) Activity timeline (logged calls / emails / notes / quotes / stage moves).
--    Distinct from rental_inquiry_messages, which stores actual email traffic.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rental_inquiry_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES rental_inquiries(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'note'
    CHECK (type IN ('inquiry', 'call', 'email', 'note', 'quote', 'payment', 'logistics')),
  body text NOT NULL,
  actor text,                                   -- display name of who logged it
  created_by uuid REFERENCES profiles(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_activity_inquiry
  ON rental_inquiry_activity(inquiry_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_rental_inquiry_activity_entity
  ON rental_inquiry_activity(entity_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 5) Row Level Security — mirror the rental_inquiry_messages model: scope by
--    entity membership so members of the inquiry's entity get full read/write.
-- ---------------------------------------------------------------------------
ALTER TABLE rental_inquiry_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view inquiry tasks in their entities" ON rental_inquiry_tasks;
CREATE POLICY "Users can view inquiry tasks in their entities"
  ON rental_inquiry_tasks FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can insert inquiry tasks in their entities" ON rental_inquiry_tasks;
CREATE POLICY "Users can insert inquiry tasks in their entities"
  ON rental_inquiry_tasks FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can update inquiry tasks in their entities" ON rental_inquiry_tasks;
CREATE POLICY "Users can update inquiry tasks in their entities"
  ON rental_inquiry_tasks FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can delete inquiry tasks in their entities" ON rental_inquiry_tasks;
CREATE POLICY "Users can delete inquiry tasks in their entities"
  ON rental_inquiry_tasks FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));

ALTER TABLE rental_inquiry_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view inquiry activity in their entities" ON rental_inquiry_activity;
CREATE POLICY "Users can view inquiry activity in their entities"
  ON rental_inquiry_activity FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can insert inquiry activity in their entities" ON rental_inquiry_activity;
CREATE POLICY "Users can insert inquiry activity in their entities"
  ON rental_inquiry_activity FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));
DROP POLICY IF EXISTS "Users can delete inquiry activity in their entities" ON rental_inquiry_activity;
CREATE POLICY "Users can delete inquiry activity in their entities"
  ON rental_inquiry_activity FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));
