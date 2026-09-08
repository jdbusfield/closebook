-- ============================================================================
-- Audit log: database-level triggers on every user-editable table
-- ============================================================================
-- Before this migration only nine API routes wrote to audit_log. Now every
-- INSERT / UPDATE / DELETE on the tables listed in audit_table_config lands in
-- audit_log with the acting user, a timestamp, the changed columns, and a
-- short label for the row.
--
-- Who did it:
--   1. auth.uid() when the write comes through the user's own Supabase client
--   2. the x-closebook-actor request header when the write comes through the
--      service-role client (set by src/lib/supabase/middleware.ts + admin.ts)
--   3. NULL ("System") for crons, webhooks and syncs
--
-- Deliberately NOT audited (sync output, caches, computed rows, logs):
--   accounts, qbo_classes, gl_balances, gl_class_balances, trial_balances,
--   tb_unmatched_rows, qbo_sync_logs, fleetio_*, gmail_sync_state, rw_*,
--   rental_asset_kpis / _maintenance / _meter_readings / _vin_bridge,
--   payroll_pay_statements / _lines, payroll_earning_codes,
--   employee_paycheck_details, employee_monthly_costs, payroll_sync_logs,
--   rental_inquiry_messages / _email_events / _activity, ad_platform_*,
--   drift_snapshots, drift_alerts, revenue_projection_snapshots,
--   entity_accrual_snapshots, accrual_close_lines, commission_results,
--   rebate_invoices / _invoice_items / _quarterly_summaries,
--   fixed_asset_depreciation, debt_amortization, lease_payments,
--   sublease_payments, close_gate_checks, crm_production_status_history,
--   generated_reports, kpi_values, audit_log itself.
-- To audit another table later: INSERT INTO audit_table_config, then
-- SELECT public.audit_install_triggers();
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. audit_log additions
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS resource_label text,
  ADD COLUMN IF NOT EXISTS resource_key text;

CREATE INDEX IF NOT EXISTS idx_audit_log_org_type_created
  ON public.audit_log (organization_id, resource_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_org_user_created
  ON public.audit_log (organization_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource
  ON public.audit_log (resource_type, resource_key);

-- The log is append-only for app users. (The service role bypasses this.)
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Which tables are audited, and how each one finds its organization
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_table_config (
  table_name text PRIMARY KEY,
  resource_type text,            -- defaults to table_name
  parent_column text,            -- column holding the parent row id
  parent_table text,             -- table the parent row lives in
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_table_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can read audit config" ON public.audit_table_config;
CREATE POLICY "Members can read audit config" ON public.audit_table_config
  FOR SELECT USING (auth.uid() IS NOT NULL);

INSERT INTO public.audit_table_config (table_name, parent_column, parent_table) VALUES
  -- organization-scoped (organization_id on the row)
  ('organizations', NULL, NULL),
  ('organization_members', NULL, NULL),
  ('organization_invites', NULL, NULL),
  ('organization_integrations', NULL, NULL),
  ('profiles', NULL, NULL),
  ('entities', NULL, NULL),
  ('entity_access', NULL, NULL),
  ('allocation_adjustments', NULL, NULL),
  ('close_task_templates', NULL, NULL),
  ('custom_vehicle_classes', NULL, NULL),
  ('diligence_deals', NULL, NULL),
  ('diligence_documents', NULL, NULL),
  ('diligence_items', NULL, NULL),
  ('financial_model_templates', NULL, NULL),
  ('fixed_asset_cf_entries', NULL, NULL),
  ('kpi_definitions', NULL, NULL),
  ('master_account_bridge_links', NULL, NULL),
  ('master_account_year_adjustments', NULL, NULL),
  ('master_accounts', NULL, NULL),
  ('master_charts', NULL, NULL),
  ('materiality_thresholds', NULL, NULL),
  ('pro_forma_adjustments', NULL, NULL),
  ('reconciliation_templates', NULL, NULL),
  ('report_definitions', NULL, NULL),
  ('reporting_entities', NULL, NULL),
  ('schedule_templates', NULL, NULL),
  ('crm_bookings', NULL, NULL),
  ('crm_commercial_companies', NULL, NULL),
  ('crm_commercial_opportunities', NULL, NULL),
  ('crm_communications', NULL, NULL),
  ('crm_companies', NULL, NULL),
  ('crm_contact_commercial_companies', NULL, NULL),
  ('crm_contact_commercial_opportunities', NULL, NULL),
  ('crm_contact_productions', NULL, NULL),
  ('crm_contacts', NULL, NULL),
  ('crm_corporate_opportunities', NULL, NULL),
  ('crm_entertainment_events', NULL, NULL),
  ('crm_equipment', NULL, NULL),
  ('crm_event_bookings', NULL, NULL),
  ('crm_opportunities', NULL, NULL),
  ('crm_opportunity_comments', NULL, NULL),
  ('crm_production_aliases', NULL, NULL),
  ('crm_production_entity_assignments', NULL, NULL),
  ('crm_production_reports', NULL, NULL),
  ('crm_productions', NULL, NULL),
  -- entity-scoped (entity_id on the row)
  ('accrual_close_periods', NULL, NULL),
  ('asset_depreciation_rules', NULL, NULL),
  ('asset_recon_gl_links', NULL, NULL),
  ('asset_reconciliations', NULL, NULL),
  ('budget_amounts', NULL, NULL),
  ('budget_versions', NULL, NULL),
  ('close_periods', NULL, NULL),
  ('commission_profiles', NULL, NULL),
  ('debt_instruments', NULL, NULL),
  ('debt_reconciliation_accounts', NULL, NULL),
  ('debt_reconciliations', NULL, NULL),
  ('drift_monitored_accounts', NULL, NULL),
  ('entity_accrual_config', NULL, NULL),
  ('fixed_assets', NULL, NULL),
  ('insurance_brokers', NULL, NULL),
  ('insurance_carriers', NULL, NULL),
  ('insurance_claims', NULL, NULL),
  ('insurance_documents', NULL, NULL),
  ('insurance_policies', NULL, NULL),
  ('leases', NULL, NULL),
  ('master_account_mappings', NULL, NULL),
  ('paylocity_connections', NULL, NULL),
  ('payroll_accruals', NULL, NULL),
  ('payroll_preview_inputs', NULL, NULL),
  ('properties', NULL, NULL),
  ('qbo_connections', NULL, NULL),
  ('rebate_customers', NULL, NULL),
  ('rebate_excluded_icodes', NULL, NULL),
  ('rental_inquiries', NULL, NULL),
  ('rental_inquiry_ad_spend', NULL, NULL),
  ('rental_inquiry_faqs', NULL, NULL),
  ('rental_inquiry_fleet_rates', NULL, NULL),
  ('rental_inquiry_funnel_enrollments', NULL, NULL),
  ('rental_inquiry_funnel_steps', NULL, NULL),
  ('rental_inquiry_funnels', NULL, NULL),
  ('rental_inquiry_quotes', NULL, NULL),
  ('rental_inquiry_resource_folders', NULL, NULL),
  ('rental_inquiry_resources', NULL, NULL),
  ('rental_inquiry_tasks', NULL, NULL),
  ('rental_inquiry_templates', NULL, NULL),
  ('reporting_entity_members', NULL, NULL),
  ('revenue_projections', NULL, NULL),
  ('revenue_schedules', NULL, NULL),
  ('sales_commission_plans', NULL, NULL),
  ('schedules', NULL, NULL),
  ('subleases', NULL, NULL),
  ('uploaded_reports', NULL, NULL),
  -- child tables: scope comes from the parent row
  ('close_tasks', 'close_period_id', 'close_periods'),
  ('close_task_attachments', 'close_task_id', 'close_tasks'),
  ('close_task_comments', 'close_task_id', 'close_tasks'),
  ('materiality_overrides', 'close_task_id', 'close_tasks'),
  ('reconciliation_workpapers', 'close_task_id', 'close_tasks'),
  ('commission_account_assignments', 'commission_profile_id', 'commission_profiles'),
  ('debt_covenants', 'debt_instrument_id', 'debt_instruments'),
  ('debt_rate_history', 'debt_instrument_id', 'debt_instruments'),
  ('debt_transactions', 'debt_instrument_id', 'debt_instruments'),
  ('debt_transaction_documents', 'transaction_id', 'debt_transactions'),
  ('employee_allocations', 'allocated_entity_id', 'entities'),
  ('insurance_allocations', 'policy_id', 'insurance_policies'),
  ('insurance_coverages', 'policy_id', 'insurance_policies'),
  ('insurance_exclusions', 'policy_id', 'insurance_policies'),
  ('insurance_exposures', 'policy_id', 'insurance_policies'),
  ('insurance_locations', 'policy_id', 'insurance_policies'),
  ('insurance_payment_schedules', 'policy_id', 'insurance_policies'),
  ('insurance_subjectivities', 'policy_id', 'insurance_policies'),
  ('lease_amendments', 'lease_id', 'leases'),
  ('lease_cost_splits', 'lease_id', 'leases'),
  ('lease_critical_dates', 'lease_id', 'leases'),
  ('lease_documents', 'lease_id', 'leases'),
  ('lease_escalations', 'lease_id', 'leases'),
  ('lease_options', 'lease_id', 'leases'),
  ('sublease_critical_dates', 'sublease_id', 'subleases'),
  ('sublease_documents', 'sublease_id', 'subleases'),
  ('sublease_escalations', 'sublease_id', 'subleases'),
  ('sublease_options', 'sublease_id', 'subleases'),
  ('rebate_tiers', 'rebate_customer_id', 'rebate_customers'),
  ('revenue_line_items', 'schedule_id', 'revenue_schedules'),
  ('schedule_line_items', 'schedule_id', 'schedules'),
  ('sales_commission_customer_assignments', 'plan_id', 'sales_commission_plans'),
  ('sales_commission_rate_types', 'plan_id', 'sales_commission_plans'),
  ('sales_commission_runs', 'plan_id', 'sales_commission_plans')
ON CONFLICT (table_name) DO UPDATE
  SET parent_column = EXCLUDED.parent_column,
      parent_table = EXCLUDED.parent_table;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- One request header, lower-cased key, or NULL.
CREATE OR REPLACE FUNCTION public.audit_request_header(p_name text)
RETURNS text
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_headers jsonb;
BEGIN
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF v_headers IS NULL THEN RETURN NULL; END IF;
  RETURN nullif(v_headers ->> lower(p_name), '');
END;
$$;

-- Who is making this change. Must be an existing profile or we record NULL.
CREATE OR REPLACE FUNCTION public.audit_actor()
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_header text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    v_header := public.audit_request_header('x-closebook-actor');
    IF v_header IS NOT NULL THEN
      BEGIN
        v_actor := v_header::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_actor := NULL;
      END;
    END IF;
  END IF;
  IF v_actor IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_actor) THEN
    RETURN v_actor;
  END IF;
  RETURN NULL;
END;
$$;

-- Never store secrets in the log.
CREATE OR REPLACE FUNCTION public.audit_redact(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_key text;
BEGIN
  IF p_row IS NULL THEN RETURN NULL; END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_row) LOOP
    IF v_key ~* '(token|secret|password|passcode|api_key|apikey|credential|private_key|signature)' THEN
      v_out := v_out || jsonb_build_object(v_key, CASE WHEN p_row -> v_key = 'null'::jsonb THEN NULL ELSE '[redacted]' END);
    ELSE
      v_out := v_out || jsonb_build_object(v_key, p_row -> v_key);
    END IF;
  END LOOP;
  RETURN v_out;
END;
$$;

-- A short human label for the row (name, title, number, email...).
CREATE OR REPLACE FUNCTION public.audit_label(p_row jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT left(coalesce(
    nullif(p_row ->> 'name', ''),
    nullif(p_row ->> 'instrument_name', ''),
    nullif(p_row ->> 'lease_name', ''),
    nullif(p_row ->> 'sublease_name', ''),
    nullif(p_row ->> 'policy_name', ''),
    nullif(p_row ->> 'policy_number', ''),
    nullif(p_row ->> 'asset_name', ''),
    nullif(p_row ->> 'title', ''),
    nullif(p_row ->> 'full_name', ''),
    nullif(p_row ->> 'display_name', ''),
    nullif(p_row ->> 'deal_name', ''),
    nullif(p_row ->> 'customer_name', ''),
    nullif(p_row ->> 'company_name', ''),
    nullif(p_row ->> 'contact_name', ''),
    nullif(trim(concat_ws(' ', p_row ->> 'first_name', p_row ->> 'last_name')), ''),
    nullif(p_row ->> 'quote_number', ''),
    nullif(p_row ->> 'inquiry_number', ''),
    nullif(p_row ->> 'reference', ''),
    nullif(p_row ->> 'question', ''),
    nullif(p_row ->> 'subject', ''),
    nullif(p_row ->> 'email', ''),
    nullif(p_row ->> 'label', ''),
    nullif(p_row ->> 'code', ''),
    nullif(p_row ->> 'account_number', ''),
    nullif(p_row ->> 'vin', ''),
    nullif(p_row ->> 'description', ''),
    CASE WHEN p_row ? 'period_year' AND p_row ? 'period_month'
         THEN (p_row ->> 'period_year') || '-' || lpad(p_row ->> 'period_month', 2, '0') END,
    nullif(p_row ->> 'period', ''),
    nullif(p_row ->> 'month', '')
  ), 160);
$$;

-- Resolve (organization_id, entity_id) for a row of a given table, walking
-- up through the parent configured in audit_table_config when needed.
CREATE OR REPLACE FUNCTION public.audit_scope(
  p_table text,
  p_row jsonb,
  p_depth int DEFAULT 0,
  OUT org uuid,
  OUT ent uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col text;
  v_parent text;
  v_parent_row jsonb;
  v_parent_id uuid;
BEGIN
  org := NULL; ent := NULL;
  IF p_row IS NULL OR p_depth > 5 THEN RETURN; END IF;

  IF p_table = 'organizations' THEN
    org := nullif(p_row ->> 'id', '')::uuid;
    RETURN;
  END IF;

  IF p_table = 'profiles' THEN
    SELECT organization_id INTO org
    FROM public.organization_members
    WHERE user_id = nullif(p_row ->> 'id', '')::uuid
    LIMIT 1;
    RETURN;
  END IF;

  IF p_table = 'entities' THEN
    ent := nullif(p_row ->> 'id', '')::uuid;
    org := nullif(p_row ->> 'organization_id', '')::uuid;
    RETURN;
  END IF;

  BEGIN
    ent := nullif(p_row ->> 'entity_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    ent := NULL;
  END;

  IF nullif(p_row ->> 'organization_id', '') IS NOT NULL THEN
    org := (p_row ->> 'organization_id')::uuid;
    RETURN;
  END IF;

  IF ent IS NOT NULL THEN
    SELECT organization_id INTO org FROM public.entities WHERE id = ent;
    RETURN;
  END IF;

  SELECT parent_column, parent_table INTO v_col, v_parent
  FROM public.audit_table_config WHERE table_name = p_table;
  IF v_col IS NULL OR v_parent IS NULL THEN RETURN; END IF;
  IF nullif(p_row ->> v_col, '') IS NULL THEN RETURN; END IF;

  BEGIN
    v_parent_id := (p_row ->> v_col)::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', v_parent)
    INTO v_parent_row USING v_parent_id;
  IF v_parent_row IS NULL THEN RETURN; END IF;

  SELECT s.org, s.ent INTO org, ent
  FROM public.audit_scope(v_parent, v_parent_row, p_depth + 1) s;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_full jsonb;
  v_action text;
  v_org uuid;
  v_ent uuid;
  v_resource_id uuid;
  v_resource_key text;
  v_label text;
  v_changed jsonb := '{}'::jsonb;
  v_prev jsonb := '{}'::jsonb;
  v_key text;
  v_cfg record;
  v_ip inet;
  v_ip_text text;
  v_ua text;
  v_ignore text[] := ARRAY[
    'updated_at', 'created_at', 'last_synced_at', 'synced_at', 'last_sync_at',
    'last_seen_at', 'last_activity_at', 'search_vector'
  ];
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      v_new := to_jsonb(NEW); v_action := 'create';
    ELSIF TG_OP = 'UPDATE' THEN
      v_old := to_jsonb(OLD); v_new := to_jsonb(NEW); v_action := 'update';
    ELSE
      v_old := to_jsonb(OLD); v_action := 'delete';
    END IF;
    v_full := coalesce(v_new, v_old);

    SELECT s.org, s.ent INTO v_org, v_ent
    FROM public.audit_scope(TG_TABLE_NAME::text, v_full, 0) s;
    IF v_org IS NULL THEN
      RETURN NULL;  -- nothing to file this under (e.g. parent already gone)
    END IF;

    IF TG_OP = 'UPDATE' THEN
      FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
        IF NOT (v_key = ANY (v_ignore)) AND (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
          v_changed := v_changed || jsonb_build_object(v_key, v_new -> v_key);
          v_prev := v_prev || jsonb_build_object(v_key, v_old -> v_key);
        END IF;
      END LOOP;
      IF v_changed = '{}'::jsonb THEN
        RETURN NULL;  -- touch-only update, nothing really changed
      END IF;
      v_old := v_prev;
      v_new := v_changed;
    END IF;

    SELECT * INTO v_cfg FROM public.audit_table_config WHERE table_name = TG_TABLE_NAME::text;

    v_resource_key := v_full ->> 'id';
    BEGIN
      v_resource_id := v_resource_key::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_resource_id := NULL;
    END;

    v_label := public.audit_label(v_full);

    v_ip_text := coalesce(
      public.audit_request_header('x-closebook-actor-ip'),
      split_part(coalesce(public.audit_request_header('x-forwarded-for'), ''), ',', 1)
    );
    BEGIN
      v_ip := nullif(trim(v_ip_text), '')::inet;
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
    END;
    v_ua := coalesce(
      public.audit_request_header('x-closebook-actor-ua'),
      public.audit_request_header('user-agent')
    );

    INSERT INTO public.audit_log (
      organization_id, entity_id, user_id, action, resource_type,
      resource_id, resource_key, resource_label, old_values, new_values,
      ip_address, user_agent
    ) VALUES (
      v_org, v_ent, public.audit_actor(), v_action,
      coalesce(v_cfg.resource_type, TG_TABLE_NAME::text),
      v_resource_id, v_resource_key, v_label,
      public.audit_redact(v_old), public.audit_redact(v_new),
      v_ip, left(v_ua, 512)
    );
  EXCEPTION WHEN OTHERS THEN
    -- An audit failure must never block the business write.
    RAISE WARNING 'audit_row_change failed on %.%: %', TG_TABLE_SCHEMA, TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- Attach (or re-attach) the trigger to every enabled table that exists.
CREATE OR REPLACE FUNCTION public.audit_install_triggers()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN SELECT table_name, enabled FROM public.audit_table_config LOOP
    IF to_regclass('public.' || quote_ident(r.table_name)) IS NULL THEN
      RAISE NOTICE 'audit: table % not found, skipped', r.table_name;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', r.table_name);
    IF r.enabled THEN
      EXECUTE format(
        'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',
        r.table_name
      );
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_install_triggers() FROM PUBLIC, anon, authenticated;

SELECT public.audit_install_triggers();
