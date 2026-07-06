-- Month Preview Report inputs
--
-- Stores the manually-entered figures for the monthly "Month Preview Report"
-- (/payroll/estimate/preview): revenue estimate/budget and payroll budget per
-- entity per month. Payroll actuals come from the estimate engine; these are
-- the numbers that live outside the payroll system.

CREATE TABLE IF NOT EXISTS payroll_preview_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  entity_id uuid NOT NULL,
  revenue_estimate numeric(19,2),
  revenue_budget numeric(19,2),
  -- Optional revenue deduction line (e.g. Versatile "Less: Versa Group")
  revenue_deduction numeric(19,2),
  payroll_budget numeric(19,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, month, entity_id)
);

ALTER TABLE payroll_preview_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read preview inputs" ON payroll_preview_inputs;
CREATE POLICY "Authenticated users can read preview inputs"
  ON payroll_preview_inputs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert preview inputs" ON payroll_preview_inputs;
CREATE POLICY "Authenticated users can insert preview inputs"
  ON payroll_preview_inputs FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update preview inputs" ON payroll_preview_inputs;
CREATE POLICY "Authenticated users can update preview inputs"
  ON payroll_preview_inputs FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can delete preview inputs" ON payroll_preview_inputs;
CREATE POLICY "Authenticated users can delete preview inputs"
  ON payroll_preview_inputs FOR DELETE TO authenticated USING (true);
