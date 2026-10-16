-- Versatile Rewards: customer loyalty points earned on RentalWorks invoices.
--
-- A member is a production company. It links to one or more RW customer IDs
-- (RW has near-duplicate customers). Points live in rewards_ledger, one row per
-- movement; balances and tiers are always recomputed from it. Earn rows are
-- derived nightly from rw_invoices_cache / rw_invoice_items and keyed by
-- source_key ('inv:<rw_invoice_id>') so a rerun never double-counts.
--
-- Tiers qualify on eligible spend in dollars per calendar year; a tier earned
-- in year Y lasts through Dec 31 of Y+1. Earn rates, thresholds and every perk
-- value are rows here, editable from the Rewards page without a deploy.

create table rewards_programs (
  entity_id uuid primary key references entities(id) on delete cascade,
  name text not null default 'Versatile Rewards',
  -- Points that count start here. Invoices from preview_start_date up to this
  -- date earn "preview" points: shown internally, never to customers.
  program_start_date date not null default '2027-01-01',
  preview_start_date date default '2026-01-01',
  -- Which invoices count. The cache's warehouse column is blank, so Versatile
  -- is scoped by invoice number prefix (V...), as the commission fallback does.
  invoice_prefixes text[] not null default '{V}',
  counted_statuses text[] not null default '{CLOSED,PROCESSED,APPROVED}',
  -- Points become spendable once the invoice reaches one of these statuses.
  paid_statuses text[] not null default '{CLOSED}',
  -- Line types that earn (R = rental). S/M/F/L are sales, misc, etc.
  eligible_rec_types text[] not null default '{R}',
  excluded_icodes text[] not null default '{}',
  -- Also apply the rebate tracker's global I-code exclusions for this entity.
  use_rebate_exclusions boolean not null default true,
  -- I-codes that count as bathroom trailers for the per-trailer bonus. Empty = no bonus.
  bathroom_icodes text[] not null default '{}',
  -- Weekend multiplier (per tier) applies only when this is on.
  weekend_bonus_enabled boolean not null default false,
  points_expire_months integer not null default 12 check (points_expire_months > 0),
  -- New RW customers with counted invoices become shadow members automatically.
  auto_enroll boolean not null default true,
  last_run_at timestamptz,
  last_run_summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table rewards_tiers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  key text not null,
  name text not null,
  sort_order integer not null default 0,
  -- Eligible spend in a calendar year that reaches this tier.
  min_annual_spend numeric(14,2) not null default 0 check (min_annual_spend >= 0),
  points_per_dollar numeric(8,4) not null default 1 check (points_per_dollar >= 0),
  -- Replaces points_per_dollar for an order out over a weekend, when the
  -- program's weekend switch is on. Null = no weekend rate for this tier.
  weekend_points_per_dollar numeric(8,4) check (weekend_points_per_dollar >= 0),
  -- Bonus points per bathroom trailer on an invoice. Null = no bonus.
  bathroom_bonus_points integer check (bathroom_bonus_points >= 0),
  -- Workbook "roll over" allowance, stored for now; not applied yet.
  rollover_cap numeric(14,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, key)
);

create table rewards_members (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null,
  -- shadow = earning, not yet activated; active = statements + redemptions;
  -- opted_out = asked to be left out, earns nothing.
  status text not null default 'shadow' check (status in ('shadow','active','opted_out')),
  activated_at timestamptz,
  opted_out_at timestamptz,
  notes text,
  -- Refreshed by the nightly job from the ledger.
  current_tier_key text,
  tier_effective_on date,
  tier_expires_on date,
  qualifying_year integer,
  qualifying_spend numeric(14,2) not null default 0,
  next_tier_key text,
  spend_to_next_tier numeric(14,2),
  points_available integer not null default 0,
  points_pending integer not null default 0,
  points_expiring_soon integer not null default 0,
  points_lifetime integer not null default 0,
  preview_spend numeric(14,2) not null default 0,
  preview_points integer not null default 0,
  preview_tier_key text,
  summary_refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rewards_members_entity on rewards_members (entity_id);

create table rewards_member_customers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  member_id uuid not null references rewards_members(id) on delete cascade,
  rw_customer_id text not null,
  customer_name text,
  customer_number text,
  created_at timestamptz not null default now(),
  unique (entity_id, rw_customer_id)
);
create index rewards_member_customers_member on rewards_member_customers (member_id);

create table rewards_contacts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references rewards_members(id) on delete cascade,
  name text,
  email text not null,
  title text,
  receives_statements boolean not null default true,
  created_at timestamptz not null default now(),
  unique (member_id, email)
);

create table rewards_redemptions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  member_id uuid not null references rewards_members(id) on delete cascade,
  catalog_item_id uuid,
  description text not null,
  points integer not null check (points > 0),
  status text not null default 'requested' check (status in ('requested','approved','fulfilled','cancelled')),
  cost_to_company numeric(12,2),
  note text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index rewards_redemptions_member on rewards_redemptions (member_id);

create table rewards_ledger (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  member_id uuid not null references rewards_members(id) on delete cascade,
  rw_customer_id text,
  -- earn: from an invoice (negative for a reversal); adjustment: by hand;
  -- redeem: spent on a redemption; redeem_reversal: a cancelled redemption
  -- given back; redeem_refund: the tier's "points back after a redemption".
  entry_type text not null check (entry_type in ('earn','adjustment','redeem','redeem_reversal','redeem_refund')),
  source_key text,
  points integer not null,
  eligible_spend numeric(14,2) not null default 0,
  rw_invoice_id text,
  invoice_number text,
  invoice_date date,
  invoice_status text,
  tier_key text,
  points_per_dollar numeric(8,4),
  weekend_applied boolean not null default false,
  bonus_points integer not null default 0,
  is_preview boolean not null default false,
  -- Earn rows: true once the invoice is paid. Everything else: true.
  is_available boolean not null default true,
  earned_on date not null,
  expires_on date,
  redemption_id uuid references rewards_redemptions(id) on delete set null,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Upsert key for earn rows. NULLs are distinct, so hand entries don't collide.
  constraint rewards_ledger_source unique (entity_id, source_key)
);
create index rewards_ledger_member on rewards_ledger (member_id, earned_on);
create index rewards_ledger_customer on rewards_ledger (entity_id, rw_customer_id);

-- Perk definitions: every row from the workbook, allocated per tier below.
create table rewards_perks (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  key text not null,
  name text not null,
  category text not null default 'rental' check (category in ('rental','other','partner','pa')),
  -- included = yes/no; percent = a % value; allowance = N uses per period;
  -- text = free text (e.g. "Mon-Fri").
  value_kind text not null default 'included' check (value_kind in ('included','percent','allowance','text')),
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (entity_id, key)
);

create table rewards_tier_perks (
  id uuid primary key default gen_random_uuid(),
  tier_id uuid not null references rewards_tiers(id) on delete cascade,
  perk_id uuid not null references rewards_perks(id) on delete cascade,
  -- Off until the perk is decided. proposed_value keeps the workbook's idea.
  enabled boolean not null default false,
  value_number numeric(12,4),
  value_text text,
  allowance integer check (allowance >= 0),
  allowance_period text check (allowance_period in ('order','week','month','quarter','year')),
  proposed_value text,
  updated_at timestamptz not null default now(),
  unique (tier_id, perk_id)
);

create table rewards_perk_uses (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  member_id uuid not null references rewards_members(id) on delete cascade,
  perk_id uuid not null references rewards_perks(id) on delete cascade,
  used_on date not null default current_date,
  quantity integer not null default 1 check (quantity > 0),
  order_number text,
  note text,
  logged_by uuid,
  created_at timestamptz not null default now()
);
create index rewards_perk_uses_member on rewards_perk_uses (member_id, used_on);

create table rewards_catalog_items (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null,
  points_cost integer not null check (points_cost > 0),
  kind text not null default 'swag' check (kind in ('swag','gift_card','order_credit','other')),
  cash_value numeric(12,2),
  cost_to_company numeric(12,2),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table rewards_redemptions
  add constraint rewards_redemptions_catalog_item_fk
  foreign key (catalog_item_id) references rewards_catalog_items(id) on delete set null;

-- Every tier change on the live program. The rental team works this list to
-- set the customer's discount in RentalWorks (Closebook can't write there).
create table rewards_tier_changes (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  member_id uuid not null references rewards_members(id) on delete cascade,
  from_tier_key text,
  to_tier_key text,
  effective_on date not null,
  reason text,
  done_at timestamptz,
  done_by uuid,
  created_at timestamptz not null default now()
);
create index rewards_tier_changes_open on rewards_tier_changes (entity_id) where done_at is null;

-- RLS: members who can see the entity read (user_entity_ids honours entity
-- allowlists); admin/controller/preparer on the entity write. API routes use
-- the service role and check the same scopes in code.
do $$
declare t text;
begin
  foreach t in array array[
    'rewards_programs','rewards_tiers','rewards_members','rewards_member_customers',
    'rewards_ledger','rewards_perks','rewards_perk_uses','rewards_catalog_items',
    'rewards_redemptions','rewards_tier_changes'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format($p$create policy "Members read %1$s" on %1$I for select
      using (entity_id in (select public.user_entity_ids()))$p$, t);
    execute format($p$create policy "Editors manage %1$s" on %1$I for all
      using (public.user_entity_role(entity_id) in ('admin','controller','preparer'))
      with check (public.user_entity_role(entity_id) in ('admin','controller','preparer'))$p$, t);
  end loop;
end $$;

-- Child tables without entity_id inherit access through their parent.
alter table rewards_contacts enable row level security;
create policy "Members read rewards_contacts" on rewards_contacts for select using (member_id in (
  select m.id from rewards_members m where m.entity_id in (select public.user_entity_ids())));
create policy "Editors manage rewards_contacts" on rewards_contacts for all using (member_id in (
  select m.id from rewards_members m where public.user_entity_role(m.entity_id) in ('admin','controller','preparer')))
  with check (member_id in (
  select m.id from rewards_members m where public.user_entity_role(m.entity_id) in ('admin','controller','preparer')));

alter table rewards_tier_perks enable row level security;
create policy "Members read rewards_tier_perks" on rewards_tier_perks for select using (tier_id in (
  select t.id from rewards_tiers t where t.entity_id in (select public.user_entity_ids())));
create policy "Editors manage rewards_tier_perks" on rewards_tier_perks for all using (tier_id in (
  select t.id from rewards_tiers t where public.user_entity_role(t.entity_id) in ('admin','controller','preparer')))
  with check (tier_id in (
  select t.id from rewards_tiers t where public.user_entity_role(t.entity_id) in ('admin','controller','preparer')));
