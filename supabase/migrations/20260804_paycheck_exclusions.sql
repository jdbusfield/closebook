-- Manual paycheck exclusions: lets an admin exclude an erroneous paycheck
-- (e.g. a not-yet-voided duplicate check) from all payroll cost views.
-- Additive only; excluded rows stay in the table and keep syncing, but are
-- filtered out of the monthly estimate, monthly cost buckets, and drill-downs.
ALTER TABLE employee_paycheck_details
  ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_reason text,
  ADD COLUMN IF NOT EXISTS excluded_at timestamptz;

COMMENT ON COLUMN employee_paycheck_details.excluded IS
  'Manually excluded from all payroll cost aggregation (estimate, monthly buckets, drill-downs). Set via /api/paylocity/paycheck-exclusions.';
