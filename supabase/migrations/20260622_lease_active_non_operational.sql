-- Add an "Active (Non-Operational)" lease status. The lease is still
-- financially active (rent owed, schedules generated, counted in cost
-- rollups) but flagged as a non-operational location for reporting.
-- Additive change to the existing CHECK constraint; no data is modified.

ALTER TABLE leases DROP CONSTRAINT IF EXISTS leases_status_check;

ALTER TABLE leases
  ADD CONSTRAINT leases_status_check
  CHECK (status IN ('draft', 'active', 'active_non_operational', 'expired', 'terminated'));
