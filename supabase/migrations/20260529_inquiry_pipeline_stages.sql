-- ============================================================================
-- Repoint the rental-inquiry pipeline to the operational sales stages:
--   new → quote_sent → rental_confirmed → completed   (+ lost)
-- Replaces the old new/contacted/quoted/won/lost set.
-- ============================================================================

-- 1) Drop the old status CHECK constraint (Postgres auto-named it on the column).
ALTER TABLE rental_inquiries DROP CONSTRAINT IF EXISTS rental_inquiries_status_check;

-- 2) Migrate any existing rows from the old vocabulary to the new one.
UPDATE rental_inquiries SET status = CASE status
  WHEN 'contacted' THEN 'new'              -- engaged but no quote yet
  WHEN 'quoted'    THEN 'quote_sent'
  WHEN 'won'       THEN 'rental_confirmed'
  ELSE status                              -- 'new' and 'lost' carry over unchanged
END
WHERE status IN ('contacted', 'quoted', 'won');

-- 3) Re-add the CHECK with the new allowed values. Default stays 'new'.
ALTER TABLE rental_inquiries ADD CONSTRAINT rental_inquiries_status_check
  CHECK (status IN ('new', 'quote_sent', 'rental_confirmed', 'completed', 'lost'));
