-- Manual equipment-type override on rebate invoices.
-- The sync classifies equipment_type from the RentalWorks order description
-- on every resync; this column survives resyncs and, when set, is the type the
-- rebate calculator prices the invoice at.
alter table public.rebate_invoices
  add column if not exists equipment_type_override text
    check (equipment_type_override in ('pro_supplies', 'vehicle', 'grip_lighting', 'studio'));

comment on column public.rebate_invoices.equipment_type_override is
  'Manual equipment type set in the UI; overrides the classified equipment_type for rebate rates.';
