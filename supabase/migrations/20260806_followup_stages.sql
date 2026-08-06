-- Follow-up round stages: split the single "followup" stage into three
-- rounds. Existing 'followup' rows become "Follow-Up 1" (label change only —
-- no data rewrite needed); 'followup2' / 'followup3' are new values a rep
-- moves a deal into on each additional chase.
-- Keep in sync with INQUIRY_STATUSES in src/lib/inquiries/shared.ts.

ALTER TABLE rental_inquiries DROP CONSTRAINT IF EXISTS rental_inquiries_status_check;
ALTER TABLE rental_inquiries ADD CONSTRAINT rental_inquiries_status_check
  CHECK (status IN ('new', 'quoted', 'followup', 'followup2', 'followup3', 'confirmed', 'out', 'returned', 'completed', 'lost'));
