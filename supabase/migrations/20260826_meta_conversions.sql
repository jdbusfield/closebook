-- Meta (Facebook) ads attribution + offline conversion queue on rental_inquiries.
--
-- Mirrors the Google Ads loop (migration 20260616): the website captures the
-- Meta click id (fbclid) into a first-party cookie and forwards it with the
-- lead; when the deal books, the daily cron reports a Purchase event to the
-- Meta Conversions API, matched by hashed email/phone + fbc, valued at the
-- booking amount, deduped by the HDR-XXXXX reference.
--
-- No new trigger: Meta eligibility rides the existing conversion_status
-- lifecycle (the 20260616 trigger flags booked deals). The cron picks rows
-- where conversion_status is pending/failed/uploaded (i.e. the deal booked)
-- and meta_conversion_status is still none/failed.
--
-- meta_conversion_status values:
--   none     — not sent (default; also: deal not booked yet)
--   uploaded — accepted by the Conversions API
--   failed   — last attempt errored; retried next run
--   skipped  — permanently not sendable (e.g. booked >7 days before Meta
--              tracking existed; the CAPI rejects events older than 7 days)

alter table rental_inquiries
  add column if not exists fbclid text,
  add column if not exists fbc text,
  add column if not exists fbp text,
  add column if not exists meta_conversion_status text not null default 'none',
  add column if not exists meta_conversion_uploaded_at timestamptz,
  add column if not exists meta_conversion_error text;

create index if not exists rental_inquiries_meta_conversion_idx
  on rental_inquiries (meta_conversion_status)
  where meta_conversion_status in ('none', 'failed');
