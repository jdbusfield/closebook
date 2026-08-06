-- "Keep Warm" stage: parked-but-interested leads ("not right now, but we're
-- interested in the future"). Open for email matching; excluded from all
-- follow-up nagging in code (needsOutreachStatus).
-- Keep in sync with INQUIRY_STATUSES in src/lib/inquiries/shared.ts.

ALTER TABLE rental_inquiries DROP CONSTRAINT IF EXISTS rental_inquiries_status_check;
ALTER TABLE rental_inquiries ADD CONSTRAINT rental_inquiries_status_check
  CHECK (status IN ('new', 'quoted', 'followup', 'followup2', 'followup3', 'keepwarm', 'confirmed', 'out', 'returned', 'completed', 'lost'));
