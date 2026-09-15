-- ===========================================================================
-- Budget module (FY2027): reporting-entity budgets, builds, assumptions,
-- headcount plan, approval snapshots, capex + disposal plan.
--
-- Additive except where noted. Apply in Supabase Studio (SQL editor) as one
-- script. Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE /
-- guarded by a DO block.
--
-- What changes on existing tables
--   budget_versions   + reporting_entity_id, kind, base_version_id, chart_id,
--                       approved_at, approved_by, locked_at, forecast_through_month;
--                       entity_id becomes nullable (a version belongs to exactly
--                       one of entity_id / reporting_entity_id).
--   budget_amounts    + reporting_entity_id, chart_id, qbo_class_id, class_key
--                       (generated), source, note; entity_id nullable; the
--                       unique key gains class_key. Captures the production
--                       account_id -> master_account_id rename that migration
--                       013 never recorded.
--   employee_paycheck_details + workers_comp_code, pay_type, cost_center_code.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Helper: organizations the current user belongs to
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_organization_ids()
RETURNS SETOF uuid AS $$
  SELECT om.organization_id FROM organization_members om WHERE om.user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.user_is_org_editor(p_org uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.user_id = auth.uid() AND om.organization_id = p_org
      AND om.role IN ('admin','controller','preparer')
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---------------------------------------------------------------------------
-- 1. budget_versions
-- ---------------------------------------------------------------------------
ALTER TABLE budget_versions ALTER COLUMN entity_id DROP NOT NULL;

ALTER TABLE budget_versions
  ADD COLUMN IF NOT EXISTS reporting_entity_id uuid REFERENCES reporting_entities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'budget',
  ADD COLUMN IF NOT EXISTS base_version_id uuid REFERENCES budget_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chart_id uuid REFERENCES master_charts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forecast_through_month int,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_versions_kind_check') THEN
    ALTER TABLE budget_versions ADD CONSTRAINT budget_versions_kind_check
      CHECK (kind IN ('budget','forecast'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_versions_owner_check') THEN
    ALTER TABLE budget_versions ADD CONSTRAINT budget_versions_owner_check
      CHECK ((entity_id IS NOT NULL) <> (reporting_entity_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_versions_forecast_month_check') THEN
    ALTER TABLE budget_versions ADD CONSTRAINT budget_versions_forecast_month_check
      CHECK (forecast_through_month IS NULL OR forecast_through_month BETWEEN 0 AND 12);
  END IF;
END $$;

-- Backfill organization_id for legacy entity versions.
UPDATE budget_versions bv
SET organization_id = e.organization_id
FROM entities e
WHERE bv.organization_id IS NULL AND bv.entity_id = e.id;

-- One active budget and one active forecast per reporting entity per year.
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_versions_active_re
  ON budget_versions (reporting_entity_id, fiscal_year, kind)
  WHERE is_active = true AND reporting_entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_budget_versions_re
  ON budget_versions (reporting_entity_id, fiscal_year);

-- ---------------------------------------------------------------------------
-- 2. budget_amounts: capture the rename, add dimensions, new unique key
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'budget_amounts' AND column_name = 'account_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'budget_amounts' AND column_name = 'master_account_id') THEN
    -- Legacy rows hold entity account ids: translate them through the
    -- management-chart mappings, drop what cannot be translated, then re-key.
    ALTER TABLE budget_amounts RENAME COLUMN account_id TO master_account_id;
    ALTER TABLE budget_amounts DROP CONSTRAINT IF EXISTS budget_amounts_account_id_fkey;
    UPDATE budget_amounts ba
    SET master_account_id = m.master_account_id
    FROM master_account_mappings m
    WHERE m.account_id = ba.master_account_id AND m.entity_id = ba.entity_id;
    DELETE FROM budget_amounts ba
    WHERE NOT EXISTS (SELECT 1 FROM master_accounts ma WHERE ma.id = ba.master_account_id);
    ALTER TABLE budget_amounts ADD CONSTRAINT budget_amounts_master_account_id_fkey
      FOREIGN KEY (master_account_id) REFERENCES master_accounts(id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE budget_amounts ALTER COLUMN entity_id DROP NOT NULL;

ALTER TABLE budget_amounts
  ADD COLUMN IF NOT EXISTS reporting_entity_id uuid REFERENCES reporting_entities(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS chart_id uuid REFERENCES master_charts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qbo_class_id uuid REFERENCES qbo_classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS class_key uuid GENERATED ALWAYS AS
    (COALESCE(qbo_class_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS note text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_amounts_source_check') THEN
    ALTER TABLE budget_amounts ADD CONSTRAINT budget_amounts_source_check
      CHECK (source IN ('manual','build','import','spread','clone'));
  END IF;
END $$;

-- Replace every unique index on budget_amounts that predates the class dimension.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT i.indexname FROM pg_indexes i
    WHERE i.schemaname = 'public' AND i.tablename = 'budget_amounts'
      AND i.indexdef ILIKE 'CREATE UNIQUE INDEX%'
      AND i.indexdef NOT ILIKE '%class_key%'
      AND i.indexname <> 'budget_amounts_pkey'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_amounts_unique_class
  ON budget_amounts (budget_version_id, master_account_id, class_key, period_year, period_month);

CREATE INDEX IF NOT EXISTS idx_budget_amounts_re_period
  ON budget_amounts (reporting_entity_id, period_year, period_month);

-- ---------------------------------------------------------------------------
-- 3. Assumptions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_assumptions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_version_id  uuid NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  scope              text NOT NULL DEFAULT 'org'
                     CHECK (scope IN ('org','reporting_entity','class','employee','asset_group','company')),
  scope_id           text,
  key                text NOT NULL,
  value              numeric(19,6),
  text_value         text,
  unit               text,
  effective_from     date,
  effective_to       date,
  source_note        text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_assumptions_unique
  ON budget_assumptions (budget_version_id, scope, COALESCE(scope_id, ''), key, COALESCE(effective_from, '1900-01-01'::date));

-- ---------------------------------------------------------------------------
-- 4. Headcount plan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_headcount (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_version_id       uuid NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  reporting_entity_id     uuid REFERENCES reporting_entities(id) ON DELETE SET NULL,
  employee_id             text,
  paylocity_company_id    text,
  name                    text NOT NULL,
  title                   text,
  department              text,
  is_requisition          boolean NOT NULL DEFAULT false,
  status                  text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','planned','terminated','excluded')),
  pay_type                text NOT NULL DEFAULT 'Hourly' CHECK (pay_type IN ('Hourly','Salary')),
  base_rate               numeric(12,4),
  annual_salary           numeric(14,2),
  std_hours_week          numeric(6,2) NOT NULL DEFAULT 40,
  fte_pct                 numeric(6,2) NOT NULL DEFAULT 100,
  start_month             int NOT NULL DEFAULT 1 CHECK (start_month BETWEEN 1 AND 12),
  end_month               int CHECK (end_month BETWEEN 1 AND 12),
  merit_pct               numeric(6,3) NOT NULL DEFAULT 0,
  merit_month             int CHECK (merit_month BETWEEN 1 AND 12),
  bonus_target            numeric(14,2) NOT NULL DEFAULT 0,
  commission_annual       numeric(14,2) NOT NULL DEFAULT 0,
  ot_pct                  numeric(8,4) NOT NULL DEFAULT 0,
  dt_pct                  numeric(8,4) NOT NULL DEFAULT 0,
  meal_pct                numeric(8,4) NOT NULL DEFAULT 0,
  other_earnings_monthly  numeric(12,2) NOT NULL DEFAULT 0,
  benefits_monthly        numeric(12,2) NOT NULL DEFAULT 0,
  match_pct               numeric(6,3) NOT NULL DEFAULT 0,
  life_disability_monthly numeric(12,2) NOT NULL DEFAULT 0,
  wc_class_code           text,
  pto_hours_per_period    numeric(8,3) NOT NULL DEFAULT 0,
  other_costs_monthly     numeric(12,2) NOT NULL DEFAULT 0,
  entity_allocations      jsonb NOT NULL DEFAULT '[]',
  class_allocations       jsonb NOT NULL DEFAULT '[]',
  seeded_from             jsonb,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_headcount_version
  ON budget_headcount (budget_version_id, reporting_entity_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_headcount_employee
  ON budget_headcount (budget_version_id, paylocity_company_id, employee_id)
  WHERE employee_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Builds (the detail beneath a line)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_builds (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_version_id    uuid NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  reporting_entity_id  uuid REFERENCES reporting_entities(id) ON DELETE CASCADE,
  entity_id            uuid REFERENCES entities(id) ON DELETE SET NULL,
  master_account_id    uuid NOT NULL REFERENCES master_accounts(id) ON DELETE CASCADE,
  qbo_class_id         uuid REFERENCES qbo_classes(id) ON DELETE SET NULL,
  class_key            uuid GENERATED ALWAYS AS
                       (COALESCE(qbo_class_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  build_type           text NOT NULL
                       CHECK (build_type IN ('headcount','schedule','driver','trend','manual','capex')),
  source_table         text,
  source_id            text,
  component            text,
  label                text NOT NULL,
  amounts              jsonb NOT NULL DEFAULT '{}',
  assumption_keys      text[] NOT NULL DEFAULT '{}',
  is_computed          boolean NOT NULL DEFAULT true,
  meta                 jsonb,
  note                 text,
  computed_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_builds_line
  ON budget_builds (budget_version_id, master_account_id, class_key);

CREATE INDEX IF NOT EXISTS idx_budget_builds_source
  ON budget_builds (budget_version_id, build_type, source_table, source_id);

-- Per-line metadata (note, method, review flag). One row per line.
CREATE TABLE IF NOT EXISTS budget_line_notes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_version_id    uuid NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  master_account_id    uuid NOT NULL REFERENCES master_accounts(id) ON DELETE CASCADE,
  qbo_class_id         uuid REFERENCES qbo_classes(id) ON DELETE SET NULL,
  class_key            uuid GENERATED ALWAYS AS
                       (COALESCE(qbo_class_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  note                 text,
  review_flag          text CHECK (review_flag IN ('aggressive','conservative','ok','needs_note')),
  updated_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_line_notes_unique
  ON budget_line_notes (budget_version_id, master_account_id, class_key);

-- ---------------------------------------------------------------------------
-- 6. Approval snapshots
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_version_snapshots (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_version_id  uuid NOT NULL REFERENCES budget_versions(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('comparables','assumptions','lines','headcount')),
  payload            jsonb NOT NULL,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_version_snapshots_version
  ON budget_version_snapshots (budget_version_id, kind);

-- ---------------------------------------------------------------------------
-- 7. Capex and disposal plan (org-level module; budgets read it by year)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capex_plan_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reporting_entity_id  uuid REFERENCES reporting_entities(id) ON DELETE SET NULL,
  entity_id            uuid REFERENCES entities(id) ON DELETE SET NULL,
  description          text NOT NULL,
  asset_group          text,
  vehicle_class        text,
  quantity             int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost            numeric(14,2) NOT NULL DEFAULT 0,
  in_service_year      int NOT NULL,
  in_service_month     int NOT NULL CHECK (in_service_month BETWEEN 1 AND 12),
  useful_life_months   int,
  salvage_pct          numeric(6,2),
  depreciation_method  text NOT NULL DEFAULT 'straight_line',
  funding              text NOT NULL DEFAULT 'cash' CHECK (funding IN ('cash','debt','lease')),
  debt_rate            numeric(8,4),
  debt_term_months     int,
  debt_pct             numeric(6,2),
  status               text NOT NULL DEFAULT 'planned'
                       CHECK (status IN ('planned','approved','ordered','received','cancelled')),
  fixed_asset_id       uuid REFERENCES fixed_assets(id) ON DELETE SET NULL,
  cost_account_id      uuid,
  notes                text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capex_plan_items_org_year
  ON capex_plan_items (organization_id, in_service_year, in_service_month);

CREATE TABLE IF NOT EXISTS disposal_plan_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reporting_entity_id  uuid REFERENCES reporting_entities(id) ON DELETE SET NULL,
  entity_id            uuid REFERENCES entities(id) ON DELETE SET NULL,
  fixed_asset_id       uuid REFERENCES fixed_assets(id) ON DELETE SET NULL,
  description          text,
  asset_group          text,
  quantity             int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  disposal_year        int NOT NULL,
  disposal_month       int NOT NULL CHECK (disposal_month BETWEEN 1 AND 12),
  expected_proceeds    numeric(14,2) NOT NULL DEFAULT 0,
  nbv_at_disposal      numeric(14,2),
  monthly_depreciation numeric(14,2),
  status               text NOT NULL DEFAULT 'planned'
                       CHECK (status IN ('planned','approved','listed','sold','cancelled')),
  notes                text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disposal_plan_items_org_year
  ON disposal_plan_items (organization_id, disposal_year, disposal_month);

-- ---------------------------------------------------------------------------
-- 8. Payroll: persist what Paylocity already sends
-- ---------------------------------------------------------------------------
ALTER TABLE employee_paycheck_details
  ADD COLUMN IF NOT EXISTS workers_comp_code text,
  ADD COLUMN IF NOT EXISTS pay_type text,
  ADD COLUMN IF NOT EXISTS cost_center_code text;

-- ---------------------------------------------------------------------------
-- 9. updated_at triggers
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_assumptions','budget_headcount','budget_builds',
                           'budget_line_notes','capex_plan_items','disposal_plan_items']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_' || t || '_updated_at') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
                     'set_' || t || '_updated_at', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 10. Locked versions are immutable (amounts, builds, headcount, assumptions,
--     notes). Approving sets locked_at; a new version is the way to change it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.budget_block_locked()
RETURNS trigger AS $$
DECLARE v_id uuid; v_locked timestamptz;
BEGIN
  v_id := COALESCE(NEW.budget_version_id, OLD.budget_version_id);
  SELECT locked_at INTO v_locked FROM budget_versions WHERE id = v_id;
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'Budget version % is locked (approved %). Create a new version to change it.', v_id, v_locked
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_amounts','budget_assumptions','budget_headcount',
                           'budget_builds','budget_line_notes']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'block_locked_' || t) THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION public.budget_block_locked()',
                     'block_locked_' || t, t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 11. Row level security
-- ---------------------------------------------------------------------------
-- A version is visible when its entity is in the member's allowlist or its
-- reporting entity belongs to one of the member's organizations.
CREATE OR REPLACE FUNCTION public.user_budget_version_ids()
RETURNS SETOF uuid AS $$
  SELECT bv.id FROM budget_versions bv
  WHERE (bv.entity_id IS NOT NULL AND bv.entity_id IN (SELECT public.user_entity_ids()))
     OR (bv.reporting_entity_id IS NOT NULL AND bv.reporting_entity_id IN (
          SELECT re.id FROM reporting_entities re
          WHERE re.organization_id IN (SELECT public.user_organization_ids())))
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.user_can_edit_budget_version(p_version uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM budget_versions bv
    LEFT JOIN entities e ON e.id = bv.entity_id
    LEFT JOIN reporting_entities re ON re.id = bv.reporting_entity_id
    WHERE bv.id = p_version
      AND public.user_is_org_editor(COALESCE(e.organization_id, re.organization_id, bv.organization_id))
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- budget_versions: replace the 013 policies with ones that understand both owners.
DROP POLICY IF EXISTS "Users can view budget versions for their entities" ON budget_versions;
DROP POLICY IF EXISTS "Users can insert budget versions for their entities" ON budget_versions;
DROP POLICY IF EXISTS "Users can update budget versions for their entities" ON budget_versions;
DROP POLICY IF EXISTS "Users can delete budget versions for their entities" ON budget_versions;
DROP POLICY IF EXISTS "Members can view budget versions" ON budget_versions;
DROP POLICY IF EXISTS "Editors can manage budget versions" ON budget_versions;
CREATE POLICY "Members can view budget versions" ON budget_versions FOR SELECT
  USING (id IN (SELECT public.user_budget_version_ids()));
CREATE POLICY "Editors can manage budget versions" ON budget_versions FOR ALL
  USING (
    (entity_id IS NOT NULL AND public.user_is_org_editor((SELECT e.organization_id FROM entities e WHERE e.id = entity_id)))
    OR (reporting_entity_id IS NOT NULL AND public.user_is_org_editor((SELECT re.organization_id FROM reporting_entities re WHERE re.id = reporting_entity_id)))
  )
  WITH CHECK (
    (entity_id IS NOT NULL AND public.user_is_org_editor((SELECT e.organization_id FROM entities e WHERE e.id = entity_id)))
    OR (reporting_entity_id IS NOT NULL AND public.user_is_org_editor((SELECT re.organization_id FROM reporting_entities re WHERE re.id = reporting_entity_id)))
  );

-- budget_amounts
DROP POLICY IF EXISTS "Users can view budget amounts for their entities" ON budget_amounts;
DROP POLICY IF EXISTS "Users can insert budget amounts for their entities" ON budget_amounts;
DROP POLICY IF EXISTS "Users can update budget amounts for their entities" ON budget_amounts;
DROP POLICY IF EXISTS "Users can delete budget amounts for their entities" ON budget_amounts;
DROP POLICY IF EXISTS "Members can view budget amounts" ON budget_amounts;
DROP POLICY IF EXISTS "Editors can manage budget amounts" ON budget_amounts;
CREATE POLICY "Members can view budget amounts" ON budget_amounts FOR SELECT
  USING (budget_version_id IN (SELECT public.user_budget_version_ids()));
CREATE POLICY "Editors can manage budget amounts" ON budget_amounts FOR ALL
  USING (public.user_can_edit_budget_version(budget_version_id))
  WITH CHECK (public.user_can_edit_budget_version(budget_version_id));

-- version-scoped child tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_assumptions','budget_headcount','budget_builds',
                           'budget_line_notes','budget_version_snapshots']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Members can view %s" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Editors can manage %s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "Members can view %s" ON %I FOR SELECT USING (budget_version_id IN (SELECT public.user_budget_version_ids()))', t, t);
    EXECUTE format('CREATE POLICY "Editors can manage %s" ON %I FOR ALL USING (public.user_can_edit_budget_version(budget_version_id)) WITH CHECK (public.user_can_edit_budget_version(budget_version_id))', t, t);
  END LOOP;
END $$;

-- org-scoped capex tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['capex_plan_items','disposal_plan_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Members can view %s" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Editors can manage %s" ON %I', t, t);
    EXECUTE format('CREATE POLICY "Members can view %s" ON %I FOR SELECT USING (organization_id IN (SELECT public.user_organization_ids()))', t, t);
    EXECUTE format('CREATE POLICY "Editors can manage %s" ON %I FOR ALL USING (public.user_is_org_editor(organization_id)) WITH CHECK (public.user_is_org_editor(organization_id))', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 12. Audit registration (audit_install_triggers is idempotent)
-- ---------------------------------------------------------------------------
INSERT INTO public.audit_table_config (table_name, parent_column, parent_table) VALUES
  ('budget_assumptions', 'budget_version_id', 'budget_versions'),
  ('budget_headcount', 'budget_version_id', 'budget_versions'),
  ('budget_builds', 'budget_version_id', 'budget_versions'),
  ('budget_line_notes', 'budget_version_id', 'budget_versions'),
  ('capex_plan_items', NULL, NULL),
  ('disposal_plan_items', NULL, NULL)
ON CONFLICT (table_name) DO NOTHING;

SELECT public.audit_install_triggers();

-- ---------------------------------------------------------------------------
-- 13. Comments
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN budget_versions.kind IS 'budget = annual plan; forecast = budget re-cut with actuals through forecast_through_month';
COMMENT ON COLUMN budget_amounts.source IS 'manual | build (sum of budget_builds) | import | spread | clone';
COMMENT ON TABLE budget_builds IS 'Detail beneath a budget line. amounts = {"1": n, ..., "12": n}. Line amount = sum of builds when any exist.';
COMMENT ON TABLE budget_assumptions IS 'Version-scoped rates, caps and growth keys with effective dates. Keys are documented in src/lib/budget/assumption-keys.ts';
