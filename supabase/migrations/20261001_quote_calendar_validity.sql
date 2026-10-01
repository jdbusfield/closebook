-- Price validity is a Los Angeles calendar date, inclusive through that date.
-- Issuance is the server timestamp of the first save. Three calendar days means
-- issued-on + 3 (not 72 hours), capped at the day before the exact event date.
-- This migration deliberately does not backfill or rewrite any existing row,
-- template, price, inventory hold, or acceptance. Legacy exceptions need review
-- and a new quote; a saved quote cannot be reissued by changing its dates.

CREATE OR REPLACE FUNCTION public.rental_quote_validity_limit(
  issued_on date,
  event_date_text text
) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = public
AS $$
DECLARE
  event_on date;
BEGIN
  IF issued_on IS NULL OR event_date_text IS NULL
     OR event_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RETURN NULL;
  END IF;
  BEGIN
    event_on := event_date_text::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RETURN NULL;
  END;
  IF event_on <= issued_on THEN RETURN NULL; END IF;
  RETURN LEAST(issued_on + 3, event_on - 1);
END;
$$;

-- Pure validation helper: the trigger always passes the actual server clock.
-- An explicit clock also makes calendar/DST regression tests deterministic.
CREATE OR REPLACE FUNCTION public.assert_rental_quote_calendar_validity(
  issued_at timestamptz,
  expires_on date,
  event_date_text text,
  quote_terms text,
  checked_at timestamptz
) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  issued_on date := (issued_at AT TIME ZONE 'America/Los_Angeles')::date;
  today date := (checked_at AT TIME ZONE 'America/Los_Angeles')::date;
  expiry_limit date := public.rental_quote_validity_limit(issued_on, event_date_text);
  flat_terms text;
  duration_pattern text := '(?:[0-9]+|one|two|three|four|five|seven|fourteen|thirty)(?:\s*\([^)]+\))?\s*[- ]?\s*(?:calendar\s+|business\s+)?days?';
  pricing_pattern text := '(?:quot(?:e|es|ed)|pric(?:e|es|ing)|rates?)';
  promise_pattern text := '(?:valid|good|held|hold|honou?red|guaranteed|expires?|locked|stands?)';
BEGIN
  IF issued_at IS NULL OR checked_at IS NULL OR issued_on > today THEN
    RAISE EXCEPTION 'Quote issuance is missing or invalid; review and issue a new quote.' USING ERRCODE = '23514';
  END IF;
  IF expiry_limit IS NULL
     OR public.rental_quote_validity_limit(today, event_date_text) IS NULL THEN
    RAISE EXCEPTION 'Same-day, past, or unconfirmed event date: review required before sending or accepting the quote.' USING ERRCODE = '23514';
  END IF;
  IF expires_on IS NULL OR expires_on < issued_on OR expires_on > expiry_limit THEN
    RAISE EXCEPTION 'Saved quote dates conflict with the three-calendar-day/event-date policy; review and issue a new quote.' USING ERRCODE = '23514';
  END IF;
  IF expires_on < today THEN
    RAISE EXCEPTION 'Quote expired on % (America/Los_Angeles); issue a new quote.', expires_on USING ERRCODE = '23514';
  END IF;
  -- Match the app's fixed-duration pricing check. Inventory hold wording alone
  -- is deliberately outside this policy and is never changed here.
  flat_terms := regexp_replace(regexp_replace(COALESCE(quote_terms, ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g');
  IF flat_terms ~* ('\y' || pricing_pattern || '[^.!?;]{0,90}\y' || promise_pattern || '[^.!?;]{0,50}\y' || duration_pattern || '\y')
     OR flat_terms ~* ('\y' || promise_pattern || '[^.!?;]{0,30}\y' || pricing_pattern || '[^.!?;]{0,30}\y' || duration_pattern || '\y') THEN
    RAISE EXCEPTION 'Review legacy quote terms: replace fixed-day price validity with the saved quote''s exact expiry date. Inventory hold terms are separate.' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_rental_quote_calendar_validity()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  event_date_text text;
  issued_on date;
  expiry_limit date;
  server_now timestamptz := statement_timestamp();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
       OR NEW.inquiry_id IS DISTINCT FROM OLD.inquiry_id
       OR NEW.entity_id IS DISTINCT FROM OLD.entity_id THEN
      RAISE EXCEPTION 'Saved quote issuance, validity, and inquiry cannot be changed; review and issue a new quote.' USING ERRCODE = '23514';
    END IF;
    IF OLD.status IN ('expired', 'declined') AND NEW.status IN ('draft', 'sent', 'accepted') THEN
      RAISE EXCEPTION 'This quote is %; review and issue a new quote.', OLD.status USING ERRCODE = '23514';
    END IF;
    -- Historical acceptance is not revoked by time passing or a repeated save.
    IF OLD.status = 'accepted' AND NEW.status = 'accepted' THEN
      NEW.accepted_at := OLD.accepted_at;
      RETURN NEW;
    END IF;
  ELSE
    -- Never trust caller-supplied issuance, including explicit null/future dates.
    NEW.created_at := server_now;
  END IF;

  SELECT start_date INTO event_date_text
  FROM public.rental_inquiries
  WHERE id = NEW.inquiry_id AND entity_id = NEW.entity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote inquiry was not found in this entity.' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    issued_on := (NEW.created_at AT TIME ZONE 'America/Los_Angeles')::date;
    expiry_limit := public.rental_quote_validity_limit(issued_on, event_date_text);
    IF NEW.valid_until IS NULL THEN
      -- Same-day/past/unknown-event drafts remain null and require review.
      NEW.valid_until := expiry_limit;
    ELSIF expiry_limit IS NULL OR NEW.valid_until < issued_on OR NEW.valid_until > expiry_limit THEN
      RAISE EXCEPTION 'Quote validity must be within issuance and the three-calendar-day/event-date limit; unresolved event dates require a draft without validity.' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IN ('sent', 'accepted') THEN
    PERFORM public.assert_rental_quote_calendar_validity(
      NEW.created_at, NEW.valid_until, event_date_text, NEW.terms, server_now
    );
  END IF;

  IF NEW.status = 'accepted' THEN
    NEW.accepted_at := server_now;
  ELSE
    NEW.accepted_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_rental_quote_calendar_validity ON public.rental_inquiry_quotes;
CREATE TRIGGER guard_rental_quote_calendar_validity
BEFORE INSERT OR UPDATE ON public.rental_inquiry_quotes
FOR EACH ROW EXECUTE FUNCTION public.guard_rental_quote_calendar_validity();

COMMENT ON COLUMN public.rental_inquiry_quotes.created_at IS
  'Immutable server issuance timestamp from first save; existing null legacy timestamps require review and a new quote.';
COMMENT ON COLUMN public.rental_inquiry_quotes.valid_until IS
  'Immutable inclusive America/Los_Angeles price-validity date: issuance calendar day + 3, capped at day before event. Null draft means review required. Separate from inventory holds.';
