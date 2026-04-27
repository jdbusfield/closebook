-- Idempotent re-apply of the asset_reconciliations.gl_account_group CHECK so
-- the constraint allows every group key the reconciliation UI can emit:
--   vehicles_cost, vehicles_accum_depr, trailers_cost, trailers_accum_depr,
--   fleet_accum_depr, vehicles_net (legacy), trailers_net (legacy).
--
-- An entity with combine_fleet_accum_depr = true (e.g. Two Family) makes
-- "Reconcile All" upsert a row with gl_account_group = 'fleet_accum_depr'.
-- On databases where 20260416_combine_fleet_accum_depr.sql wasn't applied,
-- the older constraint rejects that key and the upsert fails with:
--   new row for relation "asset_reconciliations" violates check constraint
--   "asset_reconciliations_gl_account_group_check"
--
-- This migration drops and re-adds the constraint with the full list — safe
-- to run on databases at any prior state (CHECK can be re-applied freely; no
-- data is touched).

ALTER TABLE asset_reconciliations
  DROP CONSTRAINT IF EXISTS asset_reconciliations_gl_account_group_check;

ALTER TABLE asset_reconciliations
  ADD CONSTRAINT asset_reconciliations_gl_account_group_check
  CHECK (gl_account_group IN (
    'vehicles_cost',
    'vehicles_accum_depr',
    'trailers_cost',
    'trailers_accum_depr',
    'fleet_accum_depr',
    'vehicles_net',
    'trailers_net'
  ));
