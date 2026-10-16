-- Budget item tags: every budget item gets a Function and a Location (Class already exists).
-- JD, Oct 16 2026. Additive except the last block, which renames payroll functions to the
-- four used everywhere (Sales, Fleet, Operations, Overhead). Safe to run more than once.
--
-- Splits use the payroll plan's shape: [{ "key": "Fleet", "pct": 100 }] or 75/25, 50/50.
-- NULL on a build means "inherit" (from the person, a source rule or an account rule).

ALTER TABLE budget_builds
  ADD COLUMN IF NOT EXISTS function_allocations jsonb,
  ADD COLUMN IF NOT EXISTS location_allocations jsonb;

-- Tags for things that are rebuilt on every recompute (leases, run rates, schedules) and
-- defaults for whole GL accounts. One row per (scope, account or source).
CREATE TABLE IF NOT EXISTS budget_tag_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- NULL = every reporting group in the organization
  reporting_entity_id   uuid REFERENCES reporting_entities(id) ON DELETE CASCADE,
  -- An account default ...
  master_account_id     uuid REFERENCES master_accounts(id) ON DELETE CASCADE,
  -- ... or one source row (a lease, a debt instrument, a run-rate master)
  source_table          text,
  source_id             text,
  function_allocations  jsonb,
  location_allocations  jsonb,
  qbo_class_id          uuid,
  note                  text,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_tag_rules_target_check CHECK (
    (master_account_id IS NOT NULL AND source_table IS NULL AND source_id IS NULL)
    OR (master_account_id IS NULL AND source_table IS NOT NULL AND source_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_tag_rules_unique
  ON budget_tag_rules (
    organization_id,
    COALESCE(reporting_entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(master_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(source_table, ''),
    COALESCE(source_id, '')
  );

ALTER TABLE budget_tag_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can view budget_tag_rules" ON budget_tag_rules;
DROP POLICY IF EXISTS "Editors can manage budget_tag_rules" ON budget_tag_rules;
CREATE POLICY "Members can view budget_tag_rules" ON budget_tag_rules FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()));
CREATE POLICY "Editors can manage budget_tag_rules" ON budget_tag_rules FOR ALL
  USING (public.user_is_org_editor(organization_id))
  WITH CHECK (public.user_is_org_editor(organization_id));

INSERT INTO public.audit_table_config (table_name, parent_column, parent_table) VALUES
  ('budget_tag_rules', NULL, NULL)
ON CONFLICT (table_name) DO NOTHING;
SELECT public.audit_install_triggers();

-- Payroll functions to the four used everywhere. Executive and Administrative become
-- Overhead, Fleet & Maintenance becomes Fleet; a split that lands twice on one key is summed.
UPDATE budget_headcount h
   SET function_allocations = m.merged
  FROM (
    SELECT id, jsonb_agg(jsonb_build_object('key', k, 'pct', p) ORDER BY p DESC) AS merged
      FROM (
        SELECT h2.id,
               CASE e->>'key'
                 WHEN 'Executive' THEN 'Overhead'
                 WHEN 'Administrative' THEN 'Overhead'
                 WHEN 'Fleet & Maintenance' THEN 'Fleet'
                 ELSE e->>'key'
               END AS k,
               sum((e->>'pct')::numeric) AS p
          FROM budget_headcount h2, jsonb_array_elements(h2.function_allocations) e
         WHERE jsonb_typeof(h2.function_allocations) = 'array'
         GROUP BY h2.id, 2
      ) s
     GROUP BY id
  ) m
 WHERE h.id = m.id
   AND h.function_allocations::text ~ '"(Executive|Administrative|Fleet & Maintenance)"';
