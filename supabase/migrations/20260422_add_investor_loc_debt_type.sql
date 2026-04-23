-- ============================================================================
-- Add `investor_loc` to allowed debt types.
-- Behaves like a line of credit but is funded by an outside investor rather
-- than a financial institution.
-- ============================================================================

ALTER TABLE debt_instruments DROP CONSTRAINT IF EXISTS debt_instruments_debt_type_check;
ALTER TABLE debt_instruments ADD CONSTRAINT debt_instruments_debt_type_check
  CHECK (debt_type IN (
    'term_loan', 'line_of_credit', 'revolving_credit', 'investor_loc',
    'mortgage', 'equipment_loan', 'balloon_loan',
    'bridge_loan', 'sba_loan', 'other'
  ));
