-- Commission start date per salesperson plan (the contract's Effective Date).
-- Applied to ORDER placement: only invoices whose order was placed on/after
-- this date earn commission, regardless of when they were invoiced.
alter table sales_commission_plans
  add column commission_start_date date;
