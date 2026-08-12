-- Migration: Month-end revenue-timing balance snapshots
--
-- Stores the point-in-time balances the rental-accruals-v2 report proposes
-- for each entity/period (Deferred Revenue, Accrued Revenue, Unbilled
-- Receivable gross, Allowance). The following month's true-up JE reverses
-- FROM these stored balances rather than recomputing the prior month from
-- live RentalWorks data (which drifts as unbilled orders get invoiced).
--
-- revenue_split holds the per-GL-account net revenue position
-- (accrued − deferred) at the snapshot date so the next true-up can put
-- the reversal back on the same revenue accounts.

create table if not exists entity_accrual_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  entity_id               uuid not null references entities(id) on delete cascade,
  period_year             int not null,
  period_month            int not null check (period_month between 1 and 12),
  deferred_balance        numeric(19,4) not null default 0,
  accrued_balance         numeric(19,4) not null default 0,
  unbilled_gross_balance  numeric(19,4) not null default 0,
  allowance_balance       numeric(19,4) not null default 0,  -- stored positive
  realization_rate_used   numeric(6,4) not null default 1.0000,
  revenue_split           jsonb,   -- [{ acct, name, accrued, deferred }]
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists idx_entity_accrual_snapshots_period
  on entity_accrual_snapshots (entity_id, period_year, period_month);

alter table entity_accrual_snapshots enable row level security;

create policy "Users can view accrual snapshots for their entities"
  on entity_accrual_snapshots for select
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid()
    )
  );

create policy "Users can insert accrual snapshots for their entities"
  on entity_accrual_snapshots for insert
  with check (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid() and om.role in ('admin', 'controller', 'preparer')
    )
  );

create policy "Users can update accrual snapshots for their entities"
  on entity_accrual_snapshots for update
  using (
    entity_id in (
      select e.id from entities e
      join organization_members om on om.organization_id = e.organization_id
      where om.user_id = auth.uid() and om.role in ('admin', 'controller', 'preparer')
    )
  );

-- Seed: Versatile Studios July 2026 — the balances of the corrective 7/31
-- true-up JE (posted per the Aug 2026 cleanup). August's report reverses
-- from these. revenue_split intentionally null: the July fix was posted
-- with a single revenue line, so there is no per-account split to reverse.
insert into entity_accrual_snapshots
  (entity_id, period_year, period_month,
   deferred_balance, accrued_balance, unbilled_gross_balance,
   allowance_balance, realization_rate_used, revenue_split)
select e.id, 2026, 7, 94.29, 10437.25, 30693.58, 9208.07, 0.7000, null
from entities e
where e.name ilike '%versatile%'
on conflict (entity_id, period_year, period_month) do update set
  deferred_balance       = excluded.deferred_balance,
  accrued_balance        = excluded.accrued_balance,
  unbilled_gross_balance = excluded.unbilled_gross_balance,
  allowance_balance      = excluded.allowance_balance,
  realization_rate_used  = excluded.realization_rate_used,
  updated_at             = now();
