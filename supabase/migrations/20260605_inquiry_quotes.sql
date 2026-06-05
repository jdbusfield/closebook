-- ============================================================================
-- HDR Sales CRM — saved quotes (line-item quotes + downloadable PDF)
-- A rep drafts a quote for an inquiry (line items seeded from the customer's
-- original request), it gets a custom quote number (HDR-Q####), and it is saved
-- to the deal so ANY rep who picks the lead back up can see it and re-download
-- the PDF. The PDF itself is generated on demand from this row's data
-- (src/lib/inquiries/quote-pdf.ts) — we persist the quote DATA, not a binary.
-- Entity-scoped, mirrors the rental_inquiry_templates / _tasks model.
-- ============================================================================

-- Global, human-friendly quote counter. First quote is HDR-Q1000.
CREATE SEQUENCE IF NOT EXISTS rental_inquiry_quote_seq START 1000;

CREATE TABLE IF NOT EXISTS rental_inquiry_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  inquiry_id uuid NOT NULL REFERENCES rental_inquiries(id) ON DELETE CASCADE,
  -- Auto-assigned custom quote number, e.g. 'HDR-Q1042'. Unique across HDR.
  quote_number text NOT NULL UNIQUE
    DEFAULT ('HDR-Q' || lpad(nextval('rental_inquiry_quote_seq')::text, 4, '0')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired')),
  -- Line items: [{ "description": text, "qty": number, "rate": number }, ...]
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_rate numeric NOT NULL DEFAULT 0,   -- percent, e.g. 9.5
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  valid_until date,                       -- quote expiry (defaults to +14d in app)
  terms text,                             -- free-text terms / notes printed on the PDF
  created_by text,                        -- actor display name (mirrors activity.actor)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_quotes_inquiry
  ON rental_inquiry_quotes(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_rental_inquiry_quotes_entity
  ON rental_inquiry_quotes(entity_id);

CREATE TRIGGER update_rental_inquiry_quotes_updated_at
  BEFORE UPDATE ON rental_inquiry_quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security — any member of the entity gets full read/write, matching
-- the rest of the inquiry CRM (operational, not financial-sensitive). The
-- embedded HDR CRM has no session and writes via the service-role embed route,
-- which is hard-scoped to HDR server-side.
-- ----------------------------------------------------------------------------
ALTER TABLE rental_inquiry_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view inquiry quotes in their entities" ON rental_inquiry_quotes;
CREATE POLICY "Users can view inquiry quotes in their entities"
  ON rental_inquiry_quotes FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can insert inquiry quotes in their entities" ON rental_inquiry_quotes;
CREATE POLICY "Users can insert inquiry quotes in their entities"
  ON rental_inquiry_quotes FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can update inquiry quotes in their entities" ON rental_inquiry_quotes;
CREATE POLICY "Users can update inquiry quotes in their entities"
  ON rental_inquiry_quotes FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can delete inquiry quotes in their entities" ON rental_inquiry_quotes;
CREATE POLICY "Users can delete inquiry quotes in their entities"
  ON rental_inquiry_quotes FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));
