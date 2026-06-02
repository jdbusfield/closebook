-- ============================================================================
-- RENTAL INQUIRY CRM (lightweight)
-- Tracks inbound rental inquiries from the HDR marketing site (hdrsiteservices.com),
-- the emails exchanged with each customer, and per-email delivery/open status.
-- Entity-scoped to HDR (mirrors commission_profiles / accounts patterns).
-- Kept deliberately separate from the org-wide crm_* production CRM.
-- ============================================================================

-- One row per inbound inquiry submitted on the website.
CREATE TABLE rental_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  reference text NOT NULL,                 -- e.g. "HDR-AB12C" (from the site)
  source text NOT NULL DEFAULT 'website',
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'quoted', 'won', 'lost')),

  -- Contact
  name text,
  email text,
  phone text,

  -- Request details (mirror the website inquiry form fields)
  use_case text,
  start_date text,
  end_date text,
  duration text,
  units integer,
  attendant text,
  guests text,
  location text,
  notes text,

  -- Optional link to the live RentalWorks quote/order this inquiry became
  rw_quote_number text,
  rw_order_number text,

  -- Internal triage
  internal_notes text,

  last_activity_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES profiles(id),  -- null when created by system ingest
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, reference)
);

-- Every email tied to an inquiry, both directions.
CREATE TABLE rental_inquiry_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES rental_inquiries(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  channel text NOT NULL DEFAULT 'email',
  kind text,                               -- 'internal_notification' | 'customer_autoreply' | 'reply' | null
  from_addr text,
  to_addrs text[] DEFAULT '{}',
  cc_addrs text[] DEFAULT '{}',
  subject text,
  body_text text,
  body_html text,
  resend_email_id text,                    -- set for site-sent emails; joins delivery events
  provider_message_id text,                -- inbound RFC Message-Id, for dedupe
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Resend delivery/open/bounce events for outbound messages.
CREATE TABLE rental_inquiry_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid REFERENCES rental_inquiry_messages(id) ON DELETE CASCADE,
  resend_email_id text,
  event_type text NOT NULL
    CHECK (event_type IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'delivery_delayed')),
  payload jsonb,
  occurred_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_rental_inquiries_entity_status ON rental_inquiries(entity_id, status);
CREATE INDEX idx_rental_inquiries_last_activity ON rental_inquiries(entity_id, last_activity_at DESC);
CREATE INDEX idx_rental_inquiry_messages_inquiry ON rental_inquiry_messages(inquiry_id);
CREATE INDEX idx_rental_inquiry_messages_resend ON rental_inquiry_messages(resend_email_id);
CREATE UNIQUE INDEX uq_rental_inquiry_messages_provider_msg
  ON rental_inquiry_messages(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX idx_rental_inquiry_email_events_message ON rental_inquiry_email_events(message_id);
CREATE INDEX idx_rental_inquiry_email_events_resend ON rental_inquiry_email_events(resend_email_id);

-- Triggers: auto-update updated_at
CREATE TRIGGER update_rental_inquiries_updated_at
  BEFORE UPDATE ON rental_inquiries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- Writes from the website ingest + email webhooks go through the service-role
-- (admin) client, which bypasses RLS. These policies govern in-app access only.
-- Any member of the entity can view and triage inquiries (operational, not
-- financial-sensitive). Deletes are intentionally not granted to app users.
-- ============================================================================

ALTER TABLE rental_inquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view inquiries in their entities"
  ON rental_inquiries FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));
CREATE POLICY "Users can update inquiries in their entities"
  ON rental_inquiries FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

ALTER TABLE rental_inquiry_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view messages in their entities"
  ON rental_inquiry_messages FOR SELECT
  USING (inquiry_id IN (
    SELECT id FROM rental_inquiries WHERE entity_id IN (SELECT public.user_entity_ids())
  ));

ALTER TABLE rental_inquiry_email_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view email events in their entities"
  ON rental_inquiry_email_events FOR SELECT
  USING (message_id IN (
    SELECT m.id FROM rental_inquiry_messages m
    JOIN rental_inquiries i ON i.id = m.inquiry_id
    WHERE i.entity_id IN (SELECT public.user_entity_ids())
  ));
