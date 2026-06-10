-- ============================================================================
-- Reservation requests (from the HDR website /reserve flow)
-- ----------------------------------------------------------------------------
-- The marketing site now has a self-serve /reserve calculator that submits a
-- priced reservation request (a live quote + an estimated deposit), distinct
-- from a plain "request a quote" inquiry. These leads are much warmer — the
-- customer picked dates, sized the order, and saw a deposit — so they convert
-- to rentals at a far higher rate and should stand out on the pipeline board.
--
-- This migration flags the request type and stores the estimated deposit so the
-- board can tint reservation cards green and surface the deposit. All additive;
-- every existing row is treated as a plain inquiry.
-- ============================================================================

ALTER TABLE rental_inquiries
  -- 'inquiry'      : classic "request a quote" lead (the default for all
  --                  existing rows and the contact form).
  -- 'reservation'  : a priced self-serve reservation request from /reserve.
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'inquiry'
    CHECK (request_type IN ('inquiry', 'reservation')),
  -- Estimated booking deposit shown to the customer at request time (USD).
  -- Only meaningful for reservation requests; null for plain inquiries.
  ADD COLUMN IF NOT EXISTS deposit numeric;

-- Partial index so the board / dashboard can cheaply pull just the warm
-- reservation leads for an entity.
CREATE INDEX IF NOT EXISTS idx_rental_inquiries_reservations
  ON rental_inquiries(entity_id)
  WHERE request_type = 'reservation';
