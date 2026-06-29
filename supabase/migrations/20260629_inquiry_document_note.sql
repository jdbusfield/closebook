-- ============================================================================
-- Document note (free-form note printed on the quote and/or invoice PDF)
-- ----------------------------------------------------------------------------
-- A rep often needs to add a one-off note to the customer-facing document —
-- "Includes after-hours delivery", "PO# required on invoice", "Rates held
-- through end of month", etc. This is distinct from a quote's per-draft `terms`
-- (set when drafting) and from `internal_notes` (private, never printed): it's
-- an inquiry-level note the rep edits from the detail drawer, and it appears on
-- the generated quote and/or invoice PDF per the two toggles below.
--
-- `document_note` null/empty → nothing prints, so every existing row is
-- unaffected regardless of the toggle defaults. The toggles only take effect
-- once a note is set; they default true so a newly-added note shows on both
-- documents unless the rep unticks one.
-- ============================================================================

ALTER TABLE rental_inquiries
  -- Free-form note shown on the customer-facing quote / invoice. Null → omit.
  ADD COLUMN IF NOT EXISTS document_note text,
  -- Whether `document_note` prints on the QUOTE PDF.
  ADD COLUMN IF NOT EXISTS note_on_quote boolean NOT NULL DEFAULT true,
  -- Whether `document_note` prints on the INVOICE PDF.
  ADD COLUMN IF NOT EXISTS note_on_invoice boolean NOT NULL DEFAULT true;
