-- Opening accrued interest on debt_instruments.
--
-- Captures unpaid interest already accumulated when a loan is brought onto
-- the books (e.g., a loan that originated before we started tracking it in
-- this system). Stored as a positive dollar amount at `start_date`. Does
-- NOT affect principal balance — the balance sheet carries it as a
-- separate accrued-interest liability. Defaults to 0 so existing rows are
-- unchanged and the column is optional on new instruments.

ALTER TABLE debt_instruments
  ADD COLUMN IF NOT EXISTS opening_accrued_interest numeric(19, 4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN debt_instruments.opening_accrued_interest IS
  'Unpaid interest that had accrued on the loan as of start_date, when brought onto the books. Positive number, defaults to 0.';
