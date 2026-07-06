-- Multi-company (entity) percentage allocation for employee costs
--
-- Adds entity_allocations to employee_allocations: a jsonb array of
-- { "entity_id": "<uuid>", "entity_name": "<name>", "pct": <0-100> }
-- entries that must sum to 100. When null/empty, the legacy single
-- allocated_entity_id column applies (100%). allocated_entity_id is kept
-- in sync with the largest split for legacy readers.
-- Effective-dated per allocation period, same as class_allocations.

ALTER TABLE employee_allocations
  ADD COLUMN IF NOT EXISTS entity_allocations jsonb;

COMMENT ON COLUMN employee_allocations.entity_allocations IS
  'Multi-entity % split: [{"entity_id":"...","entity_name":"Silverco","pct":60},...]. Sums to 100. Null = use legacy allocated_entity_id at 100%.';
