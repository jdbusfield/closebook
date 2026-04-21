-- Migration: Link accrual JE target accounts to the entity chart of accounts.
--
-- The GL Account Accrual preview builds two balance-sheet / contra-revenue
-- lines whose accounts aren't yet linked to the QBO chart:
--   • Unbilled Receivables (Asset)          — DR on the unbilled projection JE
--   • Allowance for Discounts (Contra-Rev)  — CR on the unbilled projection JE
--   • Accrued Revenue (Asset)               — DR on the timing accrual JE
--   • Deferred Revenue (Liability)          — CR on the deferral JE
--
-- This migration adds optional FK columns so the user can map each of these
-- to a row in `accounts`. When set, the proposed JE preview carries the real
-- QBO account number / name / qbo_id so the user can post the JE directly
-- without hand-resolving the accounts.

alter table entity_accrual_config
  add column if not exists unbilled_receivables_account_id uuid
    references accounts(id) on delete set null,
  add column if not exists allowance_account_id uuid
    references accounts(id) on delete set null,
  add column if not exists accrued_revenue_account_id uuid
    references accounts(id) on delete set null,
  add column if not exists deferred_revenue_account_id uuid
    references accounts(id) on delete set null;

create index if not exists idx_entity_accrual_config_unbilled_ar
  on entity_accrual_config (unbilled_receivables_account_id);
create index if not exists idx_entity_accrual_config_allowance
  on entity_accrual_config (allowance_account_id);
create index if not exists idx_entity_accrual_config_accrued_rev
  on entity_accrual_config (accrued_revenue_account_id);
create index if not exists idx_entity_accrual_config_deferred_rev
  on entity_accrual_config (deferred_revenue_account_id);
