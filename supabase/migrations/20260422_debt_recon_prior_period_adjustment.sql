-- ============================================================================
-- Debt reconciliations: prior period adjustment
-- Lets a user record a one-time adjustment that explains a variance carried
-- over from a closed period, so the current period can be reconciled without
-- reopening the prior books.
-- ============================================================================

ALTER TABLE debt_reconciliations
  ADD COLUMN IF NOT EXISTS prior_period_adjustment numeric(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prior_period_adjustment_note text;
