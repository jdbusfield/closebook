-- ============================================================================
-- CRM Revenue + Tier-1 Best-Practice Upgrades
--
-- Adds:
--   (A) Revenue plumbing — RentalWorks customer links, Cars Plus customer links,
--       uploaded Cars Plus invoices, and a per-production summary view.
--   (B) Tier-1 CRM hygiene — owner_id on entities, tasks, notes,
--       and a `crm_stale_productions` view for dashboard alerts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A1. Production <-> RentalWorks customer links
-- ----------------------------------------------------------------------------
-- A production can span multiple RW customer accounts (multi-season, parent/child
-- billing splits). Each RW customer belongs to at most one production.

CREATE TABLE crm_production_rw_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  production_id uuid NOT NULL REFERENCES crm_productions(id) ON DELETE CASCADE,
  rw_customer_id text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (organization_id, rw_customer_id)
);
CREATE INDEX idx_crm_prod_rw_cust_prod ON crm_production_rw_customers (production_id);
CREATE INDEX idx_crm_prod_rw_cust_rw ON crm_production_rw_customers (organization_id, rw_customer_id);

-- ----------------------------------------------------------------------------
-- A2. Production <-> external (Cars Plus) customer links
-- ----------------------------------------------------------------------------
-- `source` is parameterized to leave room for future legacy systems, but the
-- only value today is 'cars_plus'.

CREATE TABLE crm_production_external_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  production_id uuid NOT NULL REFERENCES crm_productions(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'cars_plus',
  external_customer_id text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  UNIQUE (organization_id, source, external_customer_id)
);
CREATE INDEX idx_crm_prod_ext_cust_prod ON crm_production_external_customers (production_id);
CREATE INDEX idx_crm_prod_ext_cust_ext ON crm_production_external_customers (organization_id, source, external_customer_id);

-- ----------------------------------------------------------------------------
-- A3. Uploaded Cars Plus invoices (immutable per upload batch)
-- ----------------------------------------------------------------------------

CREATE TABLE crm_external_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  upload_batch_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'cars_plus',
  external_customer_id text NOT NULL,
  customer_name text,
  invoice_number text,
  invoice_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  description text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Stable dedupe key on re-uploads of the same export
  UNIQUE (organization_id, source, invoice_number, invoice_date, amount)
);
CREATE INDEX idx_crm_ext_inv_cust ON crm_external_invoices (organization_id, source, external_customer_id);
CREATE INDEX idx_crm_ext_inv_date ON crm_external_invoices (organization_id, invoice_date);
CREATE INDEX idx_crm_ext_inv_batch ON crm_external_invoices (upload_batch_id);

-- ----------------------------------------------------------------------------
-- A4. Per-production revenue summary view
-- ----------------------------------------------------------------------------
-- Cheap to compute live: small set of productions, indexed joins.

CREATE OR REPLACE VIEW crm_production_revenue_summary AS
WITH rw_rev AS (
  SELECT
    l.organization_id,
    l.production_id,
    COALESCE(SUM(i.gross_total), 0)::numeric(14,2) AS rw_lifetime,
    COALESCE(SUM(i.gross_total) FILTER (
      WHERE date_trunc('year', i.invoice_date) = date_trunc('year', CURRENT_DATE)
    ), 0)::numeric(14,2) AS rw_ytd,
    COUNT(i.rw_invoice_id) AS rw_count,
    MAX(i.invoice_date) AS rw_last_date
  FROM crm_production_rw_customers l
  LEFT JOIN rw_invoices_cache i ON i.customer_id = l.rw_customer_id
  GROUP BY l.organization_id, l.production_id
),
ext_rev AS (
  SELECT
    l.organization_id,
    l.production_id,
    COALESCE(SUM(e.amount), 0)::numeric(14,2) AS ext_lifetime,
    COALESCE(SUM(e.amount) FILTER (
      WHERE date_trunc('year', e.invoice_date) = date_trunc('year', CURRENT_DATE)
    ), 0)::numeric(14,2) AS ext_ytd,
    COUNT(e.id) AS ext_count,
    MAX(e.invoice_date) AS ext_last_date
  FROM crm_production_external_customers l
  LEFT JOIN crm_external_invoices e
    ON e.organization_id = l.organization_id
   AND e.source = l.source
   AND e.external_customer_id = l.external_customer_id
  GROUP BY l.organization_id, l.production_id
)
SELECT
  p.id AS production_id,
  p.organization_id,
  p.name,
  p.status,
  COALESCE(rw.rw_lifetime, 0) + COALESCE(ext.ext_lifetime, 0)        AS lifetime_revenue,
  COALESCE(rw.rw_ytd, 0)      + COALESCE(ext.ext_ytd, 0)             AS ytd_revenue,
  COALESCE(rw.rw_lifetime, 0)                                        AS rw_revenue_lifetime,
  COALESCE(ext.ext_lifetime, 0)                                      AS external_revenue_lifetime,
  COALESCE(rw.rw_count, 0) + COALESCE(ext.ext_count, 0)              AS invoice_count,
  GREATEST(COALESCE(rw.rw_last_date, '1900-01-01'::date),
           COALESCE(ext.ext_last_date, '1900-01-01'::date))          AS last_invoice_date
FROM crm_productions p
LEFT JOIN rw_rev  rw  ON rw.production_id = p.id
LEFT JOIN ext_rev ext ON ext.production_id = p.id;

-- ============================================================================
-- B1. Real user-FK owners on companies, productions, opportunities
-- ============================================================================

ALTER TABLE crm_companies      ADD COLUMN owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE crm_productions    ADD COLUMN owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE crm_opportunities  ADD COLUMN owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX idx_crm_companies_owner     ON crm_companies     (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_crm_productions_owner   ON crm_productions   (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_crm_opportunities_owner ON crm_opportunities (owner_id) WHERE owner_id IS NOT NULL;

-- ============================================================================
-- B2. Tasks / follow-ups
-- ============================================================================

CREATE TYPE crm_task_status AS ENUM ('open', 'in_progress', 'done', 'cancelled');

CREATE TABLE crm_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status crm_task_status NOT NULL DEFAULT 'open',
  due_date date,
  assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  -- Polymorphic-ish links (any combination may be set; common case: one)
  production_id  uuid REFERENCES crm_productions(id)  ON DELETE CASCADE,
  company_id     uuid REFERENCES crm_companies(id)    ON DELETE CASCADE,
  contact_id     uuid REFERENCES crm_contacts(id)     ON DELETE CASCADE,
  opportunity_id uuid REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX idx_crm_tasks_open_assignee ON crm_tasks (organization_id, assignee_id, status)
  WHERE status IN ('open','in_progress');
CREATE INDEX idx_crm_tasks_production ON crm_tasks (organization_id, production_id);
CREATE INDEX idx_crm_tasks_company    ON crm_tasks (organization_id, company_id);
CREATE INDEX idx_crm_tasks_contact    ON crm_tasks (organization_id, contact_id);
CREATE INDEX idx_crm_tasks_opportunity ON crm_tasks (organization_id, opportunity_id);
CREATE INDEX idx_crm_tasks_due ON crm_tasks (organization_id, due_date)
  WHERE status IN ('open','in_progress');

-- ============================================================================
-- B3. Notes
-- ============================================================================

CREATE TABLE crm_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  body text NOT NULL,
  production_id  uuid REFERENCES crm_productions(id)  ON DELETE CASCADE,
  company_id     uuid REFERENCES crm_companies(id)    ON DELETE CASCADE,
  contact_id     uuid REFERENCES crm_contacts(id)     ON DELETE CASCADE,
  opportunity_id uuid REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz,
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX idx_crm_notes_production  ON crm_notes (organization_id, production_id, created_at DESC);
CREATE INDEX idx_crm_notes_company     ON crm_notes (organization_id, company_id, created_at DESC);
CREATE INDEX idx_crm_notes_contact     ON crm_notes (organization_id, contact_id, created_at DESC);
CREATE INDEX idx_crm_notes_opportunity ON crm_notes (organization_id, opportunity_id, created_at DESC);

-- ============================================================================
-- B4. Stale-production view
-- ============================================================================
-- A production is "stale" if it's in an active status (prepping/shooting)
-- AND there has been no communication, note, task, or invoice activity in the
-- last 30 days. The view is cheap because the inputs are small and indexed.

CREATE OR REPLACE VIEW crm_stale_productions AS
SELECT
  p.id   AS production_id,
  p.organization_id,
  p.name,
  p.status,
  p.owner_id,
  -- Most recent signal across all tracked sources (or NULL if none)
  GREATEST(
    COALESCE((SELECT MAX(c.date)        FROM crm_communications c WHERE c.production_id = p.id), '1900-01-01'::timestamptz),
    COALESCE((SELECT MAX(n.created_at)  FROM crm_notes n         WHERE n.production_id = p.id), '1900-01-01'::timestamptz),
    COALESCE((SELECT MAX(t.created_at)  FROM crm_tasks t         WHERE t.production_id = p.id), '1900-01-01'::timestamptz),
    COALESCE((SELECT MAX(e.invoice_date)::timestamptz FROM crm_external_invoices e
             JOIN crm_production_external_customers l
               ON l.organization_id = e.organization_id
              AND l.source = e.source
              AND l.external_customer_id = e.external_customer_id
              WHERE l.production_id = p.id), '1900-01-01'::timestamptz),
    COALESCE((SELECT MAX(i.invoice_date)::timestamptz FROM rw_invoices_cache i
             JOIN crm_production_rw_customers l ON l.rw_customer_id = i.customer_id
              WHERE l.production_id = p.id), '1900-01-01'::timestamptz)
  ) AS last_activity_at
FROM crm_productions p
WHERE p.status IN ('prepping', 'shooting');

-- ============================================================================
-- ROW LEVEL SECURITY for new tables (mirrors existing crm_* policies)
-- ============================================================================

DO $$
DECLARE
  t text;
  new_tables text[] := ARRAY[
    'crm_production_rw_customers',
    'crm_production_external_customers',
    'crm_external_invoices',
    'crm_tasks',
    'crm_notes'
  ];
BEGIN
  FOREACH t IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Members can view %I" ON %I FOR SELECT USING (organization_id IN (SELECT public.user_org_ids()))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "Members can insert %I" ON %I FOR INSERT WITH CHECK (organization_id IN (SELECT public.user_org_ids()))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "Members can update %I" ON %I FOR UPDATE USING (organization_id IN (SELECT public.user_org_ids()))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "Members can delete %I" ON %I FOR DELETE USING (organization_id IN (SELECT public.user_org_ids()))',
      t, t
    );
  END LOOP;
END $$;

-- The two views inherit the underlying tables' RLS — they will only return
-- rows the caller can read on the base tables.
