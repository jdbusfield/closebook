-- ============================================================================
-- Cold outreach lane for the HDR Sales CRM.
--
-- Joe's vendor outreach (event producers, venues, caterers, clubs, property
-- managers who might become preferred vendors) gets its own pipeline, separate
-- from inbound rental inquiries. Cold cards share the rental_inquiries table so
-- the Gmail capture, activity timeline, tasks, and drawer all keep working, but
-- carry lane='cold' and their own status set so every inbound view, funnel,
-- and conversion job leaves them alone.
--
-- Keep in sync with INQUIRY_STATUSES / COLD_STAGES in src/lib/inquiries/shared.ts.
-- ============================================================================

ALTER TABLE rental_inquiries
  ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'inbound',
  -- Cold-only fields. Contact name/email/phone/notes reuse the existing columns.
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS contact_title text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS vertical text,
  ADD COLUMN IF NOT EXISTS outreach_source text,
  ADD COLUMN IF NOT EXISTS sequence text,
  ADD COLUMN IF NOT EXISTS last_touch_at date,
  ADD COLUMN IF NOT EXISTS next_follow_up date;

ALTER TABLE rental_inquiries DROP CONSTRAINT IF EXISTS rental_inquiries_lane_check;
ALTER TABLE rental_inquiries ADD CONSTRAINT rental_inquiries_lane_check
  CHECK (lane IN ('inbound', 'cold'));

CREATE INDEX IF NOT EXISTS rental_inquiries_entity_lane_idx
  ON rental_inquiries (entity_id, lane);

-- Cold stages live in the same status column with their own keys, so an inbound
-- status filter can never pick up a cold card and vice versa.
ALTER TABLE rental_inquiries DROP CONSTRAINT IF EXISTS rental_inquiries_status_check;
ALTER TABLE rental_inquiries ADD CONSTRAINT rental_inquiries_status_check
  CHECK (status IN (
    'new', 'quoted', 'followup', 'followup2', 'followup3', 'responded', 'keepwarm',
    'confirmed', 'out', 'returned', 'completed', 'lost',
    'not_contacted', 'email1', 'replied', 'talking', 'preferred', 'dead'
  ));

-- Google Ads conversion trigger (20260616 / 20260701): cold cards never use the
-- won stages, but guard on lane anyway so a mis-drag can't queue an upload.
create or replace function mark_inquiry_conversion_pending()
returns trigger as $$
begin
  if NEW.lane = 'cold' then
    return NEW;
  end if;
  if NEW.status in ('confirmed', 'out') and (OLD.status is distinct from NEW.status) and NEW.conversion_status = 'none' and (NEW.email is not null or NEW.phone is not null) then
    NEW.conversion_status := 'pending';
    NEW.conversion_value := coalesce(NEW.estimated_value, NEW.conversion_value);
  end if;
  if NEW.status not in ('confirmed', 'out', 'returned', 'completed') and NEW.conversion_status = 'pending' then
    NEW.conversion_status := 'skipped';
  end if;
  return NEW;
end;
$$ language plpgsql;
