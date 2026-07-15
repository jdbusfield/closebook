-- ============================================================================
-- Funnels can carry a saved quote. Enrolling picks one of the inquiry's saved
-- quotes (defaulting to the latest); any step whose body uses {quote} gets the
-- itemized lines + total rendered in, and {quote_number} resolves too. This is
-- the "send out on this pipeline using this quote" flow.
-- ============================================================================

ALTER TABLE rental_inquiry_funnel_enrollments
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES rental_inquiry_quotes(id) ON DELETE SET NULL;

-- Seed a quote-led funnel for HDR (skipped if a funnel with this name exists).
DO $$
DECLARE
  hdr uuid := '7529580d-3b44-4a9b-91f4-bc2db25f5211';
  fid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM entities WHERE id = hdr) THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM rental_inquiry_funnels WHERE entity_id = hdr AND name = 'Quote + follow-up'
  ) THEN RETURN; END IF;

  INSERT INTO rental_inquiry_funnels (entity_id, name, description, sort_order)
  VALUES (hdr, 'Quote + follow-up',
          'Leads with your saved quote (pick it when enrolling), then chases it: check-in, value, breakup.', 0)
  RETURNING id INTO fid;

  INSERT INTO rental_inquiry_funnel_steps (entity_id, funnel_id, day_offset, subject, body, sort_order) VALUES
  (hdr, fid, 0, 'Your {company} quote',
   E'Hi {first},\n\nThanks for reaching out to {company}. Here''s a recap of what you sent over:\n\n{details}\n\nAnd here''s your quote:\n\n{quote}\n\nThat includes delivery, setup, and scheduled servicing. The quote is good for 14 days, and I''m glad to hold a unit for {date} while you decide. Want me to lock it in?\n\n— {rep}\n{company} · {company_email} · {company_phone}', 0),
  (hdr, fid, 2, 'Did the quote land alright?',
   E'Hi {first},\n\nJust making sure my quote reached you and answering the usual first question: yes, the number includes delivery, setup, pickup, and servicing. Nothing gets added later.\n\nIf anything about the setup changed (dates, headcount, location), tell me and I''ll re-price it the same day. And I can still hold a unit for {date} at no cost while you decide.\n\n— {rep}\n{company} · {company_phone}', 1),
  (hdr, fid, 4, 'If the number''s the hangup, talk to me',
   E'Hi {first},\n\nQuick follow-up on the quote I sent for {date}. If you''re comparing options, worth knowing what''s behind our number: late-model trailers, real flushing toilets and sinks, climate control, and we handle every bit of the logistics.\n\nIf budget is the sticking point, tell me what you were hoping to spend. There''s often a configuration that gets us there.\n\n— {rep}\n{company} · {company_email}', 2),
  (hdr, fid, 6, 'Closing out your quote for now',
   E'Hi {first},\n\nI''ll close out your quote for now so I''m not cluttering your inbox. If plans firm up, just reply — the pricing stands for 14 days from my first email, and after that a one-line reply gets you a refreshed number the same day.\n\nThanks for considering {company}.\n\n— {rep}\n{company} · {company_phone}', 3);
END $$;
