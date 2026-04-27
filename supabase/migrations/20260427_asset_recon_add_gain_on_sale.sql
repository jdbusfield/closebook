-- PR #31 (commit 63ad4b7) added two reconciliation group keys —
-- vehicles_gain_on_sale and trailers_gain_on_sale — but skipped a database
-- migration on the assumption that gl_account_group was free-form text.
-- It isn't: asset_reconciliations has a CHECK constraint on it. Reconcile All
-- on an entity with disposals (e.g. Two Family for Jan 2026) fails with:
--   new row for relation "asset_reconciliations" violates check constraint
--   "asset_reconciliations_gl_account_group_check"
--
-- Drop and re-add the constraint with the two gain-on-sale keys included
-- alongside everything previously allowed. Idempotent — safe regardless of
-- whether 20260415, 20260416, or 20260427_asset_recon_check_constraint_full
-- already landed.

ALTER TABLE asset_reconciliations
  DROP CONSTRAINT IF EXISTS asset_reconciliations_gl_account_group_check;

ALTER TABLE asset_reconciliations
  ADD CONSTRAINT asset_reconciliations_gl_account_group_check
  CHECK (gl_account_group IN (
    'vehicles_cost',
    'vehicles_accum_depr',
    'vehicles_gain_on_sale',
    'trailers_cost',
    'trailers_accum_depr',
    'trailers_gain_on_sale',
    'fleet_accum_depr',
    'vehicles_net',
    'trailers_net'
  ));
