-- ============================================================================
-- REPORTING ENTITY — EXCLUDE FROM BREAKDOWN FLAG
-- Allow a reporting entity to be hidden from the financial model's
-- reporting-entity breakdown view (e.g. an "Avon Accounting" RE used for
-- internal grouping but not meaningful as a reporting column).
-- The reporting entity still exists and its member entities still flow
-- into the consolidated column.
-- ============================================================================

ALTER TABLE reporting_entities
  ADD COLUMN IF NOT EXISTS exclude_from_breakdown boolean NOT NULL DEFAULT false;
