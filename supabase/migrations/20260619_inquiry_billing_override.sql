-- ============================================================================
-- Bill-to override (customer name + address for the quote/invoice document)
-- ----------------------------------------------------------------------------
-- A rental is sometimes booked by one party (e.g. an event producer) but the
-- customer needs the quote/invoice issued in a different entity's name and
-- address — for example a fundraiser booking on behalf of the organization the
-- proceeds belong to. The inquiry's `name`/`email`/`phone` stay as the working
-- contact; these optional fields override only what prints on the generated
-- quote / confirmation PDF (the "Customer" + "Issued To" block).
--
-- Both null by default → the document falls back to the inquiry name, so every
-- existing row is unaffected. Address is free-form multi-line text.
-- ============================================================================

ALTER TABLE rental_inquiries
  -- Bill-to legal/customer name shown on the quote & invoice. Null → use `name`.
  ADD COLUMN IF NOT EXISTS billing_name text,
  -- Bill-to mailing address, free-form (newline-separated lines). Null → omit.
  ADD COLUMN IF NOT EXISTS billing_address text;
