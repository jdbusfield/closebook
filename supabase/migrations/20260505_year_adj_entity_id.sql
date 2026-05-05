-- Optional entity tag on year-end adjustments. When set, the adjustment's
-- impact on Net Income is attributed to that entity's accumulated-deficit /
-- member's-equity rollup on the accountant chart. When NULL, it falls back
-- to the largest-|NI| heuristic (chart-wide adjustment).
--
-- Existing unique constraint (chart_id, master_account_id, period_year)
-- is preserved — at most one adjustment per master per year.

ALTER TABLE master_account_year_adjustments
  ADD COLUMN entity_id uuid REFERENCES entities(id) ON DELETE SET NULL;

CREATE INDEX idx_master_acct_year_adj_entity
  ON master_account_year_adjustments(entity_id);
