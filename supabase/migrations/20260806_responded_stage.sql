-- "Responded Back" stage: the customer replied and a two-way conversation is
-- going. Also (re)includes 'keepwarm' so this one statement supersedes
-- 20260806_keepwarm_stage.sql if that migration hasn't been applied yet.
-- Keep in sync with INQUIRY_STATUSES in src/lib/inquiries/shared.ts.

ALTER TABLE rental_inquiries DROP CONSTRAINT IF EXISTS rental_inquiries_status_check;
ALTER TABLE rental_inquiries ADD CONSTRAINT rental_inquiries_status_check
  CHECK (status IN ('new', 'quoted', 'followup', 'followup2', 'followup3', 'responded', 'keepwarm', 'confirmed', 'out', 'returned', 'completed', 'lost'));
