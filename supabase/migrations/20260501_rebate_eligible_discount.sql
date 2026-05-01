-- Persist the rebate-eligible portion of the invoice discount on each
-- rebate_invoice. effectiveDiscount = inv.discount_amount minus the discount
-- that landed on excluded line items, so the customer detail page can show
-- the slice that actually deducts from the rebate.

ALTER TABLE rebate_invoices
  ADD COLUMN IF NOT EXISTS discount_eligible_amount NUMERIC(19,4) DEFAULT 0;
