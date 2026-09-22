-- Budget headcount: comp adjustments and open roles
-- Additive. Safe to run more than once.
--
-- comp_adj_*      one pay change per row: kind percent | amount | rate,
--                 value in the row's pay unit (percent, $/h or $/yr, new rate),
--                 the month it takes effect, and a free-text reason.
-- amount_monthly  pay_type 'Amount': money set aside per month for a role
--                 with no rate in mind. amount_is_loaded = true means the
--                 amount is the whole cost (no taxes, benefits or fees added).
-- open_role       a planned position with no person named yet.

ALTER TABLE budget_headcount
  ADD COLUMN IF NOT EXISTS comp_adj_kind    text,
  ADD COLUMN IF NOT EXISTS comp_adj_value   numeric(14,4),
  ADD COLUMN IF NOT EXISTS comp_adj_month   int,
  ADD COLUMN IF NOT EXISTS comp_adj_reason  text,
  ADD COLUMN IF NOT EXISTS amount_monthly   numeric(12,2),
  ADD COLUMN IF NOT EXISTS amount_is_loaded boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS open_role        boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_headcount_comp_adj_kind_check') THEN
    ALTER TABLE budget_headcount
      ADD CONSTRAINT budget_headcount_comp_adj_kind_check
      CHECK (comp_adj_kind IS NULL OR comp_adj_kind IN ('percent','amount','rate'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'budget_headcount_comp_adj_month_check') THEN
    ALTER TABLE budget_headcount
      ADD CONSTRAINT budget_headcount_comp_adj_month_check
      CHECK (comp_adj_month IS NULL OR comp_adj_month BETWEEN 1 AND 12);
  END IF;
END $$;

-- Allow the Amount pay type
ALTER TABLE budget_headcount DROP CONSTRAINT IF EXISTS budget_headcount_pay_type_check;
ALTER TABLE budget_headcount
  ADD CONSTRAINT budget_headcount_pay_type_check
  CHECK (pay_type IN ('Hourly','Salary','Amount'));

-- Rows that already carry a per-row merit become a percent adjustment
UPDATE budget_headcount
   SET comp_adj_kind = 'percent',
       comp_adj_value = merit_pct,
       comp_adj_month = COALESCE(merit_month, 1)
 WHERE comp_adj_kind IS NULL
   AND merit_pct IS NOT NULL
   AND merit_pct <> 0;
