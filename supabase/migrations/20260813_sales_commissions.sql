-- Salesperson commissions calculated from RentalWorks invoices, per customer.
-- Distinct from the GL-based commission_profiles feature: this one keys rates
-- to RW customers (percentage tiers with a default rate; 0% = excluded) and
-- computes monthly commission off invoice subtotals pulled live from RW.

create table sales_commission_plans (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  salesperson_name text not null,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, salesperson_name)
);

create table sales_commission_rate_types (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references sales_commission_plans(id) on delete cascade,
  name text not null,
  -- Stored as a percentage, e.g. 6.0000 = 6%. 0 = excluded customers.
  rate_percent numeric(7,4) not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (plan_id, name)
);

-- Exactly one default rate per plan (unassigned customers flow into it).
create unique index sales_commission_rate_types_one_default
  on sales_commission_rate_types (plan_id) where is_default;

create table sales_commission_customer_assignments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references sales_commission_plans(id) on delete cascade,
  -- Restrict so deleting a rate type with customers still on it fails loudly
  -- instead of silently dropping their assignments back to the default rate.
  rate_type_id uuid not null references sales_commission_rate_types(id) on delete restrict,
  rw_customer_id text not null,
  customer_name text not null,
  created_at timestamptz not null default now(),
  unique (plan_id, rw_customer_id)
);

create table sales_commission_runs (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references sales_commission_plans(id) on delete cascade,
  period_year integer not null,
  period_month integer not null check (period_month between 1 and 12),
  total_revenue numeric(14,2) not null default 0,
  total_commission numeric(14,2) not null default 0,
  default_rate_percent numeric(7,4),
  -- Per-customer breakdown: [{ rwCustomerId, customerName, invoiceCount,
  --   revenue, rateTypeName, ratePercent, commission, assigned }]
  detail jsonb,
  calculated_at timestamptz not null default now(),
  unique (plan_id, period_year, period_month)
);

alter table sales_commission_plans enable row level security;
alter table sales_commission_rate_types enable row level security;
alter table sales_commission_customer_assignments enable row level security;
alter table sales_commission_runs enable row level security;

create policy "Users can view sales commission plans for their entities"
  on sales_commission_plans for select
  using (entity_id in (
    select e.id from entities e
    join organization_members om on om.organization_id = e.organization_id
    where om.user_id = auth.uid()));

create policy "Editors can manage sales commission plans"
  on sales_commission_plans for all
  using (entity_id in (
    select e.id from entities e
    join organization_members om on om.organization_id = e.organization_id
    where om.user_id = auth.uid()
      and om.role in ('admin','controller','preparer')));

create policy "Users can view sales commission rate types"
  on sales_commission_rate_types for select
  using (plan_id in (
    select p.id from sales_commission_plans p
    join entities e on e.id = p.entity_id
    join organization_members om on om.organization_id = e.organization_id
    where om.user_id = auth.uid()));

create policy "Editors can manage sales commission rate types"
  on sales_commission_rate_types for all
  using (plan_id in (
    select p.id from sales_commission_plans p
    join entities e on e.id = p.entity_id
    join organization_members om on om.organization_id = e.organization_id
    where om.user_id = auth.uid()
      and om.role in ('admin','controller','preparer')));

create policy "Users can view sales commission assignments"
  on sales_commission_customer_assignments for select
  using (plan_id in (
    select p.id from sales_commission_plans p
    join entities e on e.id = p.entity_id
    join organization_members om on om.organization_id = e.organization_id
    where om.user_id = auth.uid()));

create policy "Editors can manage sales commission assignments"
  on sales_commission_customer_assignments for all
  using (plan_id in (
    select p.id from sales_commission_plans p
    join entities e on e.id = p.entity_id
    join organization_members om on om.organization_id = e.organization_id
    where om.user_id = auth.uid()
      and om.role in ('admin','controller','preparer')));

create policy "Users can view sales commission runs"
  on sales_commission_runs for select
  using (plan_id in (
    select p.id from sales_commission_plans p
    join entities e on e.id = p.entity_id
    join organization_members om on om.organization_id = e.organization_id
    where om.user_id = auth.uid()));

create policy "Editors can manage sales commission runs"
  on sales_commission_runs for all
  using (plan_id in (
    select p.id from sales_commission_plans p
    join entities e on e.id = p.entity_id
    join organization_members om on om.organization_id = e.organization_id
    where om.user_id = auth.uid()
      and om.role in ('admin','controller','preparer')));
