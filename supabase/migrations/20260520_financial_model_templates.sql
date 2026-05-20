-- ============================================================================
-- FINANCIAL MODEL TEMPLATES
-- Per-organization saved configurations for the Financial Model page.
-- A template captures scope, period (static or dynamic relative to today),
-- granularity, the various comparison toggles, and which statements should
-- be included when exporting the template to PDF.
-- ============================================================================

CREATE TABLE financial_model_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  name text NOT NULL,
  is_favorite boolean NOT NULL DEFAULT false,

  -- Scope
  scope text NOT NULL CHECK (scope IN ('organization', 'entity', 'reporting_entity')),
  entity_id uuid REFERENCES entities(id) ON DELETE SET NULL,
  reporting_entity_id uuid REFERENCES reporting_entities(id) ON DELETE SET NULL,
  chart_id uuid,

  -- Period mode: 'static' = explicit range, 'dynamic' = resolved at run time
  period_mode text NOT NULL DEFAULT 'static'
    CHECK (period_mode IN ('static', 'dynamic')),

  -- Static range (used when period_mode = 'static')
  start_year int,
  start_month int CHECK (start_month BETWEEN 1 AND 12),
  end_year int,
  end_month int CHECK (end_month BETWEEN 1 AND 12),

  -- Dynamic preset (used when period_mode = 'dynamic')
  -- Resolved against today's date when the template is loaded or exported.
  dynamic_preset text CHECK (dynamic_preset IN (
    'last_month',
    'this_month',
    'last_quarter',
    'this_quarter',
    'ytd',
    'ytd_last_month',
    'trailing_12',
    'prior_year',
    'last_year_full'
  )),

  granularity text NOT NULL DEFAULT 'monthly'
    CHECK (granularity IN ('monthly', 'quarterly', 'yearly')),

  -- View configuration toggles (mirror the on-screen controls)
  include_budget boolean NOT NULL DEFAULT false,
  include_yoy boolean NOT NULL DEFAULT false,
  include_pro_forma boolean NOT NULL DEFAULT false,
  include_allocations boolean NOT NULL DEFAULT false,
  include_total boolean NOT NULL DEFAULT false,
  ebitda_only boolean NOT NULL DEFAULT false,
  variance_display text NOT NULL DEFAULT 'dollars'
    CHECK (variance_display IN ('dollars', 'percentage')),

  -- PDF export toggles: which statements to include
  include_income_statement boolean NOT NULL DEFAULT true,
  include_balance_sheet boolean NOT NULL DEFAULT true,
  include_cash_flow boolean NOT NULL DEFAULT true,
  include_pro_forma_schedule boolean NOT NULL DEFAULT false,

  display_order int NOT NULL DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_financial_model_templates_org
  ON financial_model_templates(organization_id);
CREATE INDEX idx_financial_model_templates_favorite
  ON financial_model_templates(organization_id, is_favorite)
  WHERE is_favorite = true;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE financial_model_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view templates"
  ON financial_model_templates FOR SELECT
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Members can insert templates"
  ON financial_model_templates FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Members can update templates"
  ON financial_model_templates FOR UPDATE
  USING (organization_id IN (SELECT public.user_org_ids()));

CREATE POLICY "Members can delete templates"
  ON financial_model_templates FOR DELETE
  USING (organization_id IN (SELECT public.user_org_ids()));

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER update_financial_model_templates_updated_at
  BEFORE UPDATE ON financial_model_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
