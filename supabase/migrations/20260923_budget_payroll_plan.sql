-- Shared payroll plan: one headcount list per organization per fiscal year,
-- pulled from both Paylocity companies and allocated to entities. Each
-- reporting group's budget prices its share of the plan.
-- Additive except the last statement, which clears the old per-version rows
-- (JD, Sep 22 2026: start with a fresh seed). Safe to run more than once.

CREATE TABLE IF NOT EXISTS budget_payroll_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fiscal_year           int NOT NULL,
  status                text NOT NULL DEFAULT 'draft',
  -- [{ entity_id, pct }] from trailing twelve months of revenue; used by rows with allocation_mode = 'revenue'
  revenue_shares        jsonb NOT NULL DEFAULT '[]',
  revenue_shares_as_of  text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, fiscal_year)
);

ALTER TABLE budget_headcount
  ALTER COLUMN budget_version_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS payroll_plan_id uuid REFERENCES budget_payroll_plans(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS allocation_mode text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_headcount_allocation_mode_check') THEN
    ALTER TABLE budget_headcount
      ADD CONSTRAINT budget_headcount_allocation_mode_check
      CHECK (allocation_mode IN ('manual','revenue'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_headcount_owner_check') THEN
    ALTER TABLE budget_headcount
      ADD CONSTRAINT budget_headcount_owner_check
      CHECK ((budget_version_id IS NOT NULL) <> (payroll_plan_id IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_budget_headcount_plan ON budget_headcount (payroll_plan_id);

-- One row per person per plan; open roles (no employee id) are not constrained
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_headcount_plan_employee
  ON budget_headcount (payroll_plan_id, paylocity_company_id, employee_id)
  WHERE employee_id IS NOT NULL AND payroll_plan_id IS NOT NULL;

-- Row level security
ALTER TABLE budget_payroll_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view budget_payroll_plans" ON budget_payroll_plans;
DROP POLICY IF EXISTS "Editors can manage budget_payroll_plans" ON budget_payroll_plans;
CREATE POLICY "Members can view budget_payroll_plans" ON budget_payroll_plans FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY "Editors can manage budget_payroll_plans" ON budget_payroll_plans FOR ALL
  USING (public.user_is_org_editor(organization_id))
  WITH CHECK (public.user_is_org_editor(organization_id));

DROP POLICY IF EXISTS "Members can view budget_headcount" ON budget_headcount;
DROP POLICY IF EXISTS "Editors can manage budget_headcount" ON budget_headcount;
CREATE POLICY "Members can view budget_headcount" ON budget_headcount FOR SELECT
  USING (
    (budget_version_id IS NOT NULL AND budget_version_id IN (SELECT public.user_budget_version_ids()))
    OR (payroll_plan_id IS NOT NULL AND payroll_plan_id IN (
      SELECT p.id FROM budget_payroll_plans p WHERE p.organization_id IN (SELECT public.user_organization_ids())))
  );
CREATE POLICY "Editors can manage budget_headcount" ON budget_headcount FOR ALL
  USING (
    (budget_version_id IS NOT NULL AND public.user_can_edit_budget_version(budget_version_id))
    OR (payroll_plan_id IS NOT NULL AND public.user_is_org_editor(
      (SELECT p.organization_id FROM budget_payroll_plans p WHERE p.id = payroll_plan_id)))
  )
  WITH CHECK (
    (budget_version_id IS NOT NULL AND public.user_can_edit_budget_version(budget_version_id))
    OR (payroll_plan_id IS NOT NULL AND public.user_is_org_editor(
      (SELECT p.organization_id FROM budget_payroll_plans p WHERE p.id = payroll_plan_id)))
  );

-- Audit the plan table like the other budget tables
INSERT INTO public.audit_table_config (table_name, parent_column, parent_table) VALUES
  ('budget_payroll_plans', NULL, NULL)
ON CONFLICT (table_name) DO NOTHING;
SELECT public.audit_install_triggers();

-- Fresh start: the per-version headcount rows are replaced by the shared plan
DELETE FROM budget_headcount WHERE budget_version_id IS NOT NULL;
