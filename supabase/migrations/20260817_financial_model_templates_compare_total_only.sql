-- ============================================================================
-- FINANCIAL MODEL TEMPLATES — COMPARE ON TOTAL ONLY
-- Saves the "Compare on Total only" toggle: when on (and a Total column is
-- included), Budget/Var and Prior Year/YoY comparisons render against the
-- Total column only instead of after every period column.
-- ============================================================================

ALTER TABLE financial_model_templates
  ADD COLUMN IF NOT EXISTS compare_total_only boolean NOT NULL DEFAULT false;
