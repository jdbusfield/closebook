-- RentalWorks invoice + line-item cache
-- Populated nightly so revenue analytics (e.g. I-Code breakdown) can query
-- Supabase instead of paginating through RentalWorks for every page load.

-- One row per RentalWorks invoice header. Lets us track sync state and avoid
-- refetching items for invoices we've already processed.
CREATE TABLE IF NOT EXISTS rw_invoices_cache (
  rw_invoice_id text PRIMARY KEY,
  invoice_number text,
  invoice_date date,
  billing_start_date date,
  billing_end_date date,
  status text,
  customer text,
  customer_id text,
  warehouse text,
  deal text,
  order_number text,
  order_description text,
  invoice_description text,
  list_total numeric(19,4) DEFAULT 0,
  gross_total numeric(19,4) DEFAULT 0,
  sub_total numeric(19,4) DEFAULT 0,
  tax_amount numeric(19,4) DEFAULT 0,
  discount_amount numeric(19,4) DEFAULT 0,
  rw_modified_at timestamptz,
  items_synced_at timestamptz,
  header_synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rw_invoices_cache_invoice_date ON rw_invoices_cache (invoice_date);
CREATE INDEX IF NOT EXISTS idx_rw_invoices_cache_billing_end ON rw_invoices_cache (billing_end_date);
CREATE INDEX IF NOT EXISTS idx_rw_invoices_cache_status ON rw_invoices_cache (status);
CREATE INDEX IF NOT EXISTS idx_rw_invoices_cache_warehouse ON rw_invoices_cache (warehouse);

-- One row per invoice line item. Keyed on (invoice_id, item_id) so we can
-- cleanly re-upsert when an invoice is re-pulled.
CREATE TABLE IF NOT EXISTS rw_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rw_invoice_id text NOT NULL,
  rw_invoice_item_id text NOT NULL,
  -- Denormalized header fields so common aggregates don't need a join
  invoice_number text,
  invoice_date date,
  billing_start_date date,
  billing_end_date date,
  customer text,
  warehouse text,
  status text,
  -- Line-item fields
  i_code text,
  description text,
  quantity numeric(19,4) DEFAULT 0,
  rate numeric(19,4) DEFAULT 0,
  extended numeric(19,4) DEFAULT 0,
  rec_type text,        -- R / S / M / L / F
  item_class text,      -- I / KI / K / A / blank
  inventory_id text,
  item_id text,
  deal text,
  order_number text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rw_invoice_id, rw_invoice_item_id)
);

CREATE INDEX IF NOT EXISTS idx_rw_invoice_items_invoice_id ON rw_invoice_items (rw_invoice_id);
CREATE INDEX IF NOT EXISTS idx_rw_invoice_items_invoice_date ON rw_invoice_items (invoice_date);
CREATE INDEX IF NOT EXISTS idx_rw_invoice_items_billing_end ON rw_invoice_items (billing_end_date);
CREATE INDEX IF NOT EXISTS idx_rw_invoice_items_icode ON rw_invoice_items (i_code);
CREATE INDEX IF NOT EXISTS idx_rw_invoice_items_rec_type ON rw_invoice_items (rec_type);
CREATE INDEX IF NOT EXISTS idx_rw_invoice_items_warehouse ON rw_invoice_items (warehouse);

-- Read-only access: anyone authenticated can read; only service role writes via cron.
ALTER TABLE rw_invoices_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE rw_invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rw_invoices_cache read"
  ON rw_invoices_cache FOR SELECT TO authenticated USING (true);

CREATE POLICY "rw_invoice_items read"
  ON rw_invoice_items FOR SELECT TO authenticated USING (true);
