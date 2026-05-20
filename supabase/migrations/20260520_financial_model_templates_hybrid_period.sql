-- ============================================================================
-- FINANCIAL MODEL TEMPLATES — HYBRID PERIOD MODE
-- Adds a third period_mode value, 'hybrid', that combines a static start
-- (start_year + start_month) with a dynamic end derived from the existing
-- dynamic_preset column. Used for things like "January 2026 through last
-- completed month" where the start is pinned but the end follows today.
-- ============================================================================

ALTER TABLE financial_model_templates
  DROP CONSTRAINT IF EXISTS financial_model_templates_period_mode_check;

ALTER TABLE financial_model_templates
  ADD CONSTRAINT financial_model_templates_period_mode_check
  CHECK (period_mode IN ('static', 'dynamic', 'hybrid'));
