-- ============================================================================
-- FINANCIAL MODEL TEMPLATES — ACTIVE TAB
-- Saves which Financial Model tab was active when the template was created
-- so loading a template drops the user directly into that view and the PDF
-- export renders the same view (e.g. Reporting Entity Breakdown).
-- ============================================================================

ALTER TABLE financial_model_templates
  ADD COLUMN IF NOT EXISTS active_tab text NOT NULL DEFAULT 'all'
  CHECK (active_tab IN (
    'all',
    'income-statement',
    'balance-sheet',
    'cash-flow',
    'pro-forma',
    'allocations',
    'entity-breakdown',
    're-breakdown',
    'bridge'
  ));
