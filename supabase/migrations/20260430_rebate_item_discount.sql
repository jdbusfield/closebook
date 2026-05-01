-- Capture per-line-item discount on cached rebate invoice items.
-- Used to subtract discount applied to excluded items (L&D, excluded I-Codes)
-- from the invoice-level discount_amount before computing the rebate, so a
-- discount given on an excluded line doesn't deduct from rebate-eligible revenue.

ALTER TABLE rebate_invoice_items
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(19,4) DEFAULT 0;
