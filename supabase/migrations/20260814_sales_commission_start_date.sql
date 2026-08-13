-- Commission start date per salesperson plan (the contract's Effective Date).
-- Invoices dated before it are excluded from every calculation.
alter table sales_commission_plans
  add column commission_start_date date;
