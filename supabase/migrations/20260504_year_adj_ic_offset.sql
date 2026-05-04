-- Add a flag to year-end adjustments so they can also be applied directly
-- to the synthetic "Intercompany Eliminations, Net" line on the financial
-- model. When true, the same amount is added to the IC net synthetic in
-- addition to the source master account, letting an accountant true-up
-- both sides of the imbalance with one entry.

ALTER TABLE master_account_year_adjustments
  ADD COLUMN offset_to_ic_net boolean NOT NULL DEFAULT false;
