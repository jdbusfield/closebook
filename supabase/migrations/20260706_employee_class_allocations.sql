-- Multi-class percentage allocation for employee costs
--
-- Adds class_allocations to employee_allocations: a jsonb array of
-- { "class": "<name>", "pct": <0-100> } entries that must sum to 100.
-- When null/empty, the legacy single "class" text column applies (100%).
-- Each allocation period (effective_date) carries its own splits, so a
-- class mix change is effective-dated exactly like company/department.

ALTER TABLE employee_allocations
  ADD COLUMN IF NOT EXISTS class_allocations jsonb;

COMMENT ON COLUMN employee_allocations.class_allocations IS
  'Multi-class % split: [{"class":"Admin","pct":60},{"class":"Ops","pct":40}]. Sums to 100. Null = use legacy "class" column at 100%.';
