-- Budget headcount: Location and Function tags (Tagging Cheat Sheet v3)
-- Additive. Safe to run more than once.
--
-- location_allocations  [{ key: 'Saticoy', pct: 100 }] or a 75/25, 50/50 split
-- function_allocations  [{ key: 'Operations', pct: 100 }] or a split
-- class_allocations already exists: [{ class: 'Vehicle Rental', pct: 100 }]

ALTER TABLE budget_headcount
  ADD COLUMN IF NOT EXISTS location_allocations jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS function_allocations jsonb NOT NULL DEFAULT '[]';

-- First pass at Function from the Paylocity department, only where nothing is set yet
UPDATE budget_headcount
   SET function_allocations = jsonb_build_array(jsonb_build_object('key', f, 'pct', 100))
  FROM (
    SELECT id,
           CASE
             WHEN lower(coalesce(department, '')) LIKE '%officer%' OR lower(coalesce(department, '')) LIKE '%executive%' THEN 'Executive'
             WHEN lower(coalesce(department, '')) LIKE '%admin%' OR lower(coalesce(department, '')) LIKE '%account%' OR lower(coalesce(department, '')) LIKE '%finance%' THEN 'Administrative'
             WHEN lower(coalesce(department, '')) LIKE '%sales%' THEN 'Sales'
             WHEN lower(coalesce(department, '')) LIKE '%fleet%' OR lower(coalesce(department, '')) LIKE '%maint%' THEN 'Fleet & Maintenance'
             WHEN lower(coalesce(department, '')) LIKE '%operation%' OR lower(coalesce(department, '')) LIKE '%lot%' OR lower(coalesce(department, '')) LIKE '%warehouse%' THEN 'Operations'
           END AS f
      FROM budget_headcount
  ) d
 WHERE budget_headcount.id = d.id
   AND d.f IS NOT NULL
   AND (budget_headcount.function_allocations IS NULL OR budget_headcount.function_allocations = '[]'::jsonb);

-- Location where the department names the yard
UPDATE budget_headcount
   SET location_allocations = jsonb_build_array(jsonb_build_object('key', l, 'pct', 100))
  FROM (
    SELECT id,
           CASE
             WHEN lower(coalesce(department, '')) LIKE '%versatile%' OR lower(coalesce(department, '')) LIKE '%cahuenga%' THEN 'Cahuenga'
             WHEN lower(coalesce(department, '')) LIKE '%avon lot%' OR lower(coalesce(department, '')) LIKE '%saticoy%' THEN 'Saticoy'
             WHEN lower(coalesce(department, '')) LIKE '%southeast%' OR lower(coalesce(department, '')) LIKE '%east coast%' THEN 'Southeast'
           END AS l
      FROM budget_headcount
  ) d
 WHERE budget_headcount.id = d.id
   AND d.l IS NOT NULL
   AND (budget_headcount.location_allocations IS NULL OR budget_headcount.location_allocations = '[]'::jsonb);
