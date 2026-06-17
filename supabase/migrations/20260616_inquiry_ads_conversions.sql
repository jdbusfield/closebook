-- Google Ads conversion attribution for the HDR rental pipeline.
--
-- Goal: when a rep moves an inquiry into a booked/"won" stage (confirmed or
-- out), automatically queue a Google Ads conversion carrying the real booking
-- value. A daily cron (/api/sync/google-ads-conversions) then uploads the
-- queued rows via Enhanced Conversions for Leads, matching the click by the
-- customer's hashed email/phone (gclid too, when we capture it later).
--
-- The queueing is done by a BEFORE UPDATE trigger rather than in app code so it
-- fires no matter which path changes the status (the [id] PATCH route, the
-- embed route, the in-app board, a future automation). One source of truth.

alter table rental_inquiries
  -- Google Click ID — not captured by the website form today, but the column
  -- is here so click-level attribution can be turned on later with no migration.
  add column if not exists gclid text,
  -- Conversion lifecycle:
  --   none      — never eligible (still an open lead, or lost)
  --   pending   — won; queued, awaiting upload to Google Ads
  --   uploaded  — successfully sent to Google Ads
  --   failed    — upload attempted and errored (see conversion_error); cron retries
  --   skipped   — was queued, then pulled back out of a won stage before upload
  add column if not exists conversion_status text not null default 'none',
  -- The booking value sent to Google Ads (USD). Snapshotted at queue time from
  -- estimated_value (preferred) or the reservation deposit.
  add column if not exists conversion_value numeric,
  add column if not exists conversion_currency text not null default 'USD',
  add column if not exists conversion_uploaded_at timestamptz,
  add column if not exists conversion_error text;

-- Guard the lifecycle values.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rental_inquiries_conversion_status_chk'
  ) then
    alter table rental_inquiries
      add constraint rental_inquiries_conversion_status_chk
      check (conversion_status in ('none', 'pending', 'uploaded', 'failed', 'skipped'));
  end if;
end $$;

-- The cron only ever scans rows waiting to go out; keep that lookup cheap.
create index if not exists rental_inquiries_conversion_pending_idx
  on rental_inquiries (entity_id)
  where conversion_status in ('pending', 'failed');

-- Queue / unqueue a conversion as the inquiry crosses the won boundary.
create or replace function mark_inquiry_conversion_pending()
returns trigger as $$
begin
  -- Entering a booked/won stage (confirmed or out) for the first time, with a
  -- contactable identity, and not already handled → queue it once. We require
  -- an email or phone because Enhanced Conversions for Leads matches the click
  -- by hashed contact info; a row with neither can never be matched.
  if NEW.status in ('confirmed', 'out')
     and (OLD.status is distinct from NEW.status)
     and NEW.conversion_status = 'none'
     and (NEW.email is not null or NEW.phone is not null) then
    NEW.conversion_status := 'pending';
    NEW.conversion_value  := coalesce(NEW.estimated_value, NEW.deposit, NEW.conversion_value);
  end if;

  -- Pulled back out of a won stage before it was uploaded (e.g. moved to lost or
  -- back to follow-up) → don't send a conversion for a deal that didn't stick.
  if NEW.status not in ('confirmed', 'out', 'returned')
     and NEW.conversion_status = 'pending' then
    NEW.conversion_status := 'skipped';
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_mark_inquiry_conversion_pending on rental_inquiries;
create trigger trg_mark_inquiry_conversion_pending
  before update on rental_inquiries
  for each row execute function mark_inquiry_conversion_pending();
