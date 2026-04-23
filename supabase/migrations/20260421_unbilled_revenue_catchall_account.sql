-- Migration: Add a single catch-all revenue account for unbilled-earned JEs.
--
-- The unbilled JE used to credit per-GL revenue accounts using a historical
-- ratio (which was wrong: a $180 vehicle order got sprinkled across 18
-- accounts). RentalWorks doesn't expose per-I-code GL data on uninvoiced
-- orders (orderitem/browse 500s, gldistribution requires InvoiceId), so we
-- can't post to specific revenue accounts confidently before the invoice is
-- cut.  Instead we credit a single catch-all account at month-end and let
-- the actual invoice GL coding flow through QB normally next month.
--
-- The unbilled JE shape becomes:
--   DR  Unbilled Receivables (Asset)         gross
--     CR  Catch-all Unbilled Revenue (Income) net (gross × realization rate)
--     CR  Allowance for Discounts (Contra)   discount (gross × (1 - rate))

alter table entity_accrual_config
  add column if not exists unbilled_revenue_account_id uuid
    references accounts(id) on delete set null;

create index if not exists idx_entity_accrual_config_unbilled_revenue
  on entity_accrual_config (unbilled_revenue_account_id);
