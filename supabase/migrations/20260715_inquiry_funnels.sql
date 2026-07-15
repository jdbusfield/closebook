-- ============================================================================
-- HDR Sales CRM — automated email funnels (drip sequences)
-- A funnel is an ordered set of email steps with day offsets (day 0 / 2 / 4 /
-- 6...). A rep enrolls an inquiry on a funnel; day-0 sends immediately and a
-- cron (/api/cron/funnel-tick) sends the rest on schedule via Resend as the
-- brand address. The chain breaks automatically:
--   * an INBOUND message for the inquiry pauses the enrollment and opens a
--     follow-up task so a human takes over (trigger below), and
--   * moving the inquiry to a terminal/booked stage stops it (trigger below).
-- The cron ALSO re-verifies both conditions before every send, so the triggers
-- are a fast path, not the only guard.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rental_inquiry_funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  archived boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_funnels_entity
  ON rental_inquiry_funnels(entity_id, archived, sort_order);

CREATE TRIGGER update_rental_inquiry_funnels_updated_at
  BEFORE UPDATE ON rental_inquiry_funnels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS rental_inquiry_funnel_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL REFERENCES rental_inquiry_funnels(id) ON DELETE CASCADE,
  day_offset integer NOT NULL DEFAULT 0,  -- days after enrollment (0 = immediately)
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',          -- same {merge} tokens as templates
  resource_ids uuid[] NOT NULL DEFAULT '{}', -- rental_inquiry_resources linked into the email
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_funnel_steps_funnel
  ON rental_inquiry_funnel_steps(funnel_id, day_offset, sort_order);

CREATE TRIGGER update_rental_inquiry_funnel_steps_updated_at
  BEFORE UPDATE ON rental_inquiry_funnel_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS rental_inquiry_funnel_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  inquiry_id uuid NOT NULL REFERENCES rental_inquiries(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL REFERENCES rental_inquiry_funnels(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused_replied', 'stopped', 'completed')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  enrolled_by text,                        -- display name; embed has no auth.uid()
  steps_sent integer NOT NULL DEFAULT 0,   -- how many steps have gone out
  next_send_at timestamptz,                -- when the next step is due (null when done)
  replied_at timestamptz,                  -- set when an inbound reply paused it
  stopped_reason text,                     -- e.g. 'stage:confirmed', 'manual'
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- One live funnel per inquiry at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_inquiry_funnel_enrollments_one_active
  ON rental_inquiry_funnel_enrollments(inquiry_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_funnel_enrollments_due
  ON rental_inquiry_funnel_enrollments(status, next_send_at);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_funnel_enrollments_inquiry
  ON rental_inquiry_funnel_enrollments(inquiry_id, created_at);

CREATE TRIGGER update_rental_inquiry_funnel_enrollments_updated_at
  BEFORE UPDATE ON rental_inquiry_funnel_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security — entity members get full read/write, matching the rest
-- of the inquiry CRM. The cron/embed paths use the service role and bypass RLS.
-- ----------------------------------------------------------------------------
ALTER TABLE rental_inquiry_funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_inquiry_funnel_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_inquiry_funnel_enrollments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rental_inquiry_funnels',
    'rental_inquiry_funnel_steps',
    'rental_inquiry_funnel_enrollments'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Entity members can select %1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "Entity members can select %1$s" ON %1$s FOR SELECT
         USING (entity_id IN (SELECT public.user_entity_ids()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Entity members can insert %1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "Entity members can insert %1$s" ON %1$s FOR INSERT
         WITH CHECK (entity_id IN (SELECT public.user_entity_ids()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Entity members can update %1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "Entity members can update %1$s" ON %1$s FOR UPDATE
         USING (entity_id IN (SELECT public.user_entity_ids()))
         WITH CHECK (entity_id IN (SELECT public.user_entity_ids()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "Entity members can delete %1$s" ON %1$s', t);
    EXECUTE format(
      'CREATE POLICY "Entity members can delete %1$s" ON %1$s FOR DELETE
         USING (entity_id IN (SELECT public.user_entity_ids()))', t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- Break-the-chain trigger 1: a customer reply pauses the funnel and opens a
-- follow-up task so a human picks up the thread. Fires on every inbound
-- message insert (Gmail capture + the inbound-email webhook both land here).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION funnel_pause_on_inbound_message()
RETURNS trigger AS $$
DECLARE
  paused_count integer;
BEGIN
  IF NEW.direction = 'inbound' AND NEW.inquiry_id IS NOT NULL THEN
    UPDATE rental_inquiry_funnel_enrollments
    SET status = 'paused_replied', replied_at = now()
    WHERE inquiry_id = NEW.inquiry_id AND status = 'active';
    GET DIAGNOSTICS paused_count = ROW_COUNT;

    IF paused_count > 0 THEN
      INSERT INTO rental_inquiry_tasks (inquiry_id, entity_id, title, kind, due_date, done)
      SELECT NEW.inquiry_id, i.entity_id,
             'Customer replied — funnel paused, pick up the thread', 'email',
             current_date, false
      FROM rental_inquiries i WHERE i.id = NEW.inquiry_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_funnel_pause_on_inbound ON rental_inquiry_messages;
CREATE TRIGGER trg_funnel_pause_on_inbound
  AFTER INSERT ON rental_inquiry_messages
  FOR EACH ROW EXECUTE FUNCTION funnel_pause_on_inbound_message();

-- ----------------------------------------------------------------------------
-- Break-the-chain trigger 2: booking or closing the inquiry stops the funnel.
-- Funnels exist to close open leads; once it's confirmed/out/returned/
-- completed/lost there is nothing left to chase.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION funnel_stop_on_stage_change()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('confirmed', 'out', 'returned', 'completed', 'lost') THEN
    UPDATE rental_inquiry_funnel_enrollments
    SET status = 'stopped', stopped_reason = 'stage:' || NEW.status
    WHERE inquiry_id = NEW.id AND status IN ('active', 'paused_replied');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_funnel_stop_on_stage ON rental_inquiries;
CREATE TRIGGER trg_funnel_stop_on_stage
  AFTER UPDATE OF status ON rental_inquiries
  FOR EACH ROW EXECUTE FUNCTION funnel_stop_on_stage_change();

-- ----------------------------------------------------------------------------
-- Seed funnels for HDR Site Services. Copy uses the same {merge} tokens as the
-- follow-up templates and is fully editable in-app. Seeding is skipped if the
-- entity already has any funnels (safe to re-run).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  hdr uuid := '7529580d-3b44-4a9b-91f4-bc2db25f5211';
  fid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM entities WHERE id = hdr) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM rental_inquiry_funnels WHERE entity_id = hdr) THEN RETURN; END IF;

  -- 1. Standard follow-up (day 0 / 2 / 4 / 6) --------------------------------
  INSERT INTO rental_inquiry_funnels (entity_id, name, description, sort_order)
  VALUES (hdr, 'Standard follow-up',
          'The classic close sequence for a typical inquiry: intro, check-in, value, breakup.', 0)
  RETURNING id INTO fid;
  INSERT INTO rental_inquiry_funnel_steps (entity_id, funnel_id, day_offset, subject, body, sort_order) VALUES
  (hdr, fid, 0, 'Your restroom trailer request',
   E'Hi {first},\n\nThanks for reaching out to {company}. Here''s what I have from your request:\n\n{details}\n\nIf any of that changed, just reply and correct me. Otherwise I''ll price it out and can usually have a firm number back to you the same day. I''m also glad to hold a unit for {date} while you decide.\n\n— {rep}\n{company} · {company_email} · {company_phone}', 0),
  (hdr, fid, 2, 'Quick follow-up on your restroom trailer',
   E'Hi {first},\n\nJust circling back on your request for {date}. Availability is still good, and if you have questions on sizing, service, or delivery I can answer them in one quick reply.\n\nWant me to put a hold on a unit for you? It costs nothing to hold and keeps your date safe while you sort out details.\n\n— {rep}\n{company} · {company_phone}', 1),
  (hdr, fid, 4, 'What''s included with your trailer',
   E'Hi {first},\n\nA quick note on what comes with every {company} rental, since it''s the part people ask about most:\n\n• Delivery, setup, and pickup are included\n• We service the trailer on schedule, so it stays clean and stocked\n• Climate control, real flushing toilets, and running-water sinks\n• ADA-accessible options if you need them\n\nIf you''re comparing options, I''m happy to walk you through which trailer fits {use_case} best. Just reply here.\n\n— {rep}\n{company} · {company_email}', 2),
  (hdr, fid, 6, 'Closing out your file for now',
   E'Hi {first},\n\nI''ve reached out a few times and don''t want to clutter your inbox, so I''ll close out your file for now. If your plans firm up, just reply to this email and I''ll pick right back up. We''re here whenever you need us.\n\n— {rep}\n{company} · {company_phone}', 3);

  -- 2. Quick turnaround (day 0 / 1 / 3) --------------------------------------
  INSERT INTO rental_inquiry_funnels (entity_id, name, description, sort_order)
  VALUES (hdr, 'Quick turnaround',
          'For events inside about two weeks. Shorter, urgency-forward cadence.', 1)
  RETURNING id INTO fid;
  INSERT INTO rental_inquiry_funnel_steps (entity_id, funnel_id, day_offset, subject, body, sort_order) VALUES
  (hdr, fid, 0, 'We can cover {date} — here''s the fast path',
   E'Hi {first},\n\nThanks for reaching out to {company}. Good news: we can still cover {date}. Here''s what I have from your request:\n\n{details}\n\nSince your date is close, the fastest path is: reply confirming the location and headcount, and I''ll send a firm quote today and pencil in a unit so nobody else takes it.\n\n— {rep}\n{company} · {company_email} · {company_phone}', 0),
  (hdr, fid, 1, 'Holding a unit for {date}',
   E'Hi {first},\n\nQuick note: I went ahead and penciled a unit against {date} so you don''t lose it while we talk. To lock it in I just need your go-ahead and delivery details. If you''d rather talk it through, call me at {company_phone} and we can button it up in five minutes.\n\n— {rep}\n{company}', 1),
  (hdr, fid, 3, 'Last call before I release your unit',
   E'Hi {first},\n\nI''m still holding a unit for {date}, but with the date this close I''ll need to release it soon for other requests. If you want it, just reply "hold it" and I''ll keep it yours while we finish the paperwork. If plans changed, no hard feelings. A quick reply either way helps me out.\n\n— {rep}\n{company} · {company_phone}', 2);

  -- 3. Wedding (day 0 / 2 / 5) ------------------------------------------------
  INSERT INTO rental_inquiry_funnels (entity_id, name, description, sort_order)
  VALUES (hdr, 'Wedding',
          'Warmer tone for weddings: guest comfort, photos, and locking the date early.', 2)
  RETURNING id INTO fid;
  INSERT INTO rental_inquiry_funnel_steps (entity_id, funnel_id, day_offset, subject, body, sort_order) VALUES
  (hdr, fid, 0, 'Restrooms your wedding guests will actually compliment',
   E'Hi {first},\n\nCongratulations on the upcoming wedding! Our luxury restroom trailers are a guest favorite: climate control, real flushing toilets, running-water sinks, mirrors, and nice finishes. Nobody will believe it''s a trailer.\n\nHere''s what I have from your request:\n\n{details}\n\nFor {guests} guests I can recommend the right size straight away — just reply and I''ll send pricing plus photos of the exact trailer you''d get.\n\n— {rep}\n{company} · {company_email}', 0),
  (hdr, fid, 2, 'Photos + a hold for {date}',
   E'Hi {first},\n\nWanted to make sure you saw my note about your {date} wedding. Weekend dates book out fastest, so if the date is set I''d recommend a free hold on a trailer now. It keeps your date safe with zero commitment while you finish planning.\n\nHappy to send photos, a floor plan, or references from other weddings we''ve done. Just tell me what would help.\n\n— {rep}\n{company} · {company_phone}', 1),
  (hdr, fid, 5, 'Your {date} date is still open',
   E'Hi {first},\n\nOne last check-in before your file drops off my desk: {date} is still open on our calendar, and I''d love to take restrooms off your planning list. If you''ve gone another direction, no problem at all. A one-line reply lets me close things out. And if you''re still deciding, I''m glad to hold a trailer while you do.\n\nWishing you a wonderful wedding either way.\n\n— {rep}\n{company} · {company_email}', 2);

  -- 4. Corporate & production (day 0 / 3 / 6) --------------------------------
  INSERT INTO rental_inquiry_funnels (entity_id, name, description, sort_order)
  VALUES (hdr, 'Corporate & production',
          'For corporate events, film/TV, and jobsites: COI, invoicing, logistics, multi-unit.', 3)
  RETURNING id INTO fid;
  INSERT INTO rental_inquiry_funnel_steps (entity_id, funnel_id, day_offset, subject, body, sort_order) VALUES
  (hdr, fid, 0, 'Restroom trailers for {use_case}',
   E'Hi {first},\n\nThanks for reaching out to {company}. We handle restroom and shower trailers for corporate events, productions, and jobsites across Southern California, and we''re set up for the paperwork side too: COIs, W-9s, PO numbers, and net-terms invoicing are all routine for us.\n\nHere''s what I have from your request:\n\n{details}\n\nReply with anything I''m missing (site address, run of show, power/water on site) and I''ll send a firm quote the same day.\n\n— {rep}\n{company} · {company_email} · {company_phone}', 0),
  (hdr, fid, 3, 'Site logistics — we make this part easy',
   E'Hi {first},\n\nFollowing up on your {use_case} request. A few things clients tell us made the difference:\n\n• We deliver, level, and set up on your schedule, including early calls\n• Self-contained units run without hookups; we can also tie into site power and water\n• Scheduled servicing keeps everything clean and stocked for multi-day runs\n• One invoice, COI in your required format before we roll a truck\n\nIf it''s easier to coordinate live, call me at {company_phone}. Otherwise reply with your dates and site address and I''ll take it from there.\n\n— {rep}\n{company}', 1),
  (hdr, fid, 6, 'Keeping {company} on file for you',
   E'Hi {first},\n\nI haven''t heard back, so I''ll assume the timing shifted or this one went another way. Totally fine — it happens. I''ll keep your details on file so next time you need units, one reply gets you a same-day quote with your paperwork already set up.\n\nIf the project is still live, just reply and I''ll pick it right back up.\n\n— {rep}\n{company} · {company_email}', 2);

  -- 5. High-ticket / white glove (day 0 / 2 / 4) ------------------------------
  INSERT INTO rental_inquiry_funnels (entity_id, name, description, sort_order)
  VALUES (hdr, 'High-ticket white glove',
          'For large-value opportunities: personal, phone-forward, no discounting. Nudges to a call.', 4)
  RETURNING id INTO fid;
  INSERT INTO rental_inquiry_funnel_steps (entity_id, funnel_id, day_offset, subject, body, sort_order) VALUES
  (hdr, fid, 0, 'Your {company} request — let''s get this right',
   E'Hi {first},\n\nThanks for reaching out to {company}. For a request like yours I''d rather get the details right up front than volley emails, so here''s what I have:\n\n{details}\n\nI''m happy to put together a full proposal, and for something this size a ten-minute call usually saves a week of back-and-forth. You can reach me directly at {company_phone}, or reply with a good time and I''ll call you.\n\n— {rep}\n{company} · {company_email}', 0),
  (hdr, fid, 2, 'A proposal worth comparing',
   E'Hi {first},\n\nFollowing up on your request for {date}. When clients compare us on bigger jobs, three things usually decide it:\n\n• Equipment: late-model luxury trailers, ADA options, backup units on standby\n• Service: dedicated point of contact and scheduled servicing for the full run\n• Reliability: we show up when we say we will, and I can share references who''ll vouch for that\n\nI''d like to earn this one. Reply with any open questions, or grab me at {company_phone} and I''ll have a tailored proposal to you within a day.\n\n— {rep}\n{company}', 1),
  (hdr, fid, 4, 'Where did we land?',
   E'Hi {first},\n\nI don''t want to crowd your inbox, so this is my last note unless I hear from you. If there''s a sticking point (budget, layout, timing), tell me what it is and I''ll see what I can do. There''s usually more room to tailor things on a project like yours than people expect.\n\nEither way, thanks for considering {company}. One reply and I''m on it.\n\n— {rep}\n{company} · {company_email} · {company_phone}', 2);
END $$;
