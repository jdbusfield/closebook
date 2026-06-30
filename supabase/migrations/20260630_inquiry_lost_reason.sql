-- ============================================================================
-- Lost reason (why a quote/inquiry was marked lost)
-- ----------------------------------------------------------------------------
-- When a rep marks a rental as lost they now pick a reason (Too expensive / Did
-- not respond / Went with a different vendor / Not available for the dates
-- requested / Other free-text). We store it so the "Lost" view can list every
-- lost quote with its reason for follow-up and win/loss reporting.
--
-- Nullable free text → existing lost rows simply show no reason until re-marked,
-- and nothing else is affected.
-- ============================================================================

ALTER TABLE rental_inquiries
  ADD COLUMN IF NOT EXISTS lost_reason text;
