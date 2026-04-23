-- ============================================================================
-- DEBT — Payment-in-Kind (PIK) interest flag
-- ============================================================================
-- Adds an is_pik toggle to debt_instruments. When true, interest is capitalized
-- into the outstanding balance each period instead of being paid in cash
-- ("interest on interest"), and the amortization engine produces a compounding
-- schedule with a bullet payoff at maturity.
-- ============================================================================

ALTER TABLE debt_instruments
  ADD COLUMN IF NOT EXISTS is_pik BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN debt_instruments.is_pik IS
  'Payment-in-Kind: when true, accrued interest is capitalized to the principal balance each period instead of paid in cash. Balance compounds and the entire accrued amount is due at maturity.';
