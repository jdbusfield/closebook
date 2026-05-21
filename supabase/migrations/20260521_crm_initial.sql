-- ============================================================================
-- CRM module — initial schema
-- Ported from MT-CRM (Replit/Neon) with organization_id scoping + RLS.
-- All tables prefixed `crm_` to avoid colliding with accounting tables.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUMS (namespaced with crm_ prefix)
-- ----------------------------------------------------------------------------

CREATE TYPE crm_bathroom_vendor AS ENUM (
  'hollywood_site_services', 'elite_magic', 'quixote', 'board_brothers'
);

CREATE TYPE crm_booking_status AS ENUM (
  'pending', 'confirmed', 'delivered', 'returned', 'cancelled'
);

CREATE TYPE crm_category AS ENUM (
  'passenger_van', 'cargo_van', 'cast_trailer', 'honeywagon', 'stake_bed',
  'location_services', 'production_supplies', 'production_supplies_rental',
  'lighting', 'grip_and_lighting', 'bathroom_trailer', 'ac_equipment',
  'rental_vehicles', 'rental_trailers'
);

CREATE TYPE crm_corporate_opportunity_stage AS ENUM (
  'initial_contact', 'proposal_sent', 'negotiation', 'contract_review',
  'closed_won', 'closed_lost'
);

CREATE TYPE crm_corporate_opportunity_type AS ENUM (
  'studio_preferred_vendor', 'sound_stage_partnership',
  'non_studio_rental_opportunity', 'equipment_sale'
);

CREATE TYPE crm_event_status AS ENUM ('available', 'booked', 'cancelled');

CREATE TYPE crm_event_type AS ENUM ('crypto_suite', 'dodger_tickets', 'other');

CREATE TYPE crm_opportunity_segment AS ENUM (
  'avon_trailers', 'avon_vehicles', 'location_services', 'bathroom_trailers',
  'grip_and_lighting', 'production_supplies_rental', 'ac_equipment',
  'rental_vehicles', 'rental_trailers', 'bathroom_trailer'
);

CREATE TYPE crm_opportunity_status AS ENUM (
  'open', 'reservation_made', 'won', 'lost'
);

CREATE TYPE crm_priority AS ENUM ('high', 'medium', 'low');

CREATE TYPE crm_production_status AS ENUM (
  'pre-prepping', 'prepping', 'shooting', 'reshoots',
  'wrapping', 'completed', 'archived', 'cancelled'
);

CREATE TYPE crm_production_type AS ENUM (
  'High Budget New Media Series', 'Episodic TV Series', 'Feature Film',
  'High Budget New Media Film', 'Low Budget Film', 'Pilot - TV',
  'Basic Cable TV Series', 'full_basic', 'episodic', 'mow', 'other',
  'Low Budget New Media Series', 'Pilot - New Media',
  'Independent Feature', 'Independent Series'
);

CREATE TYPE crm_rental_opportunity AS ENUM (
  'passenger_van', 'cargo_van', 'cast_trailer', 'honeywagon', 'stake_bed',
  'location_services', 'power_distribution', 'camera_trucks',
  'production_trucks', 'ac_equipment', 'rental_vehicles', 'rental_trailers',
  'bathroom_trailer', 'production_supplies_rental', 'grip_and_lighting'
);

CREATE TYPE crm_rental_vehicle_vendor AS ENUM (
  'avon', 'hdr', 'quixote', 'lightnin', 'galpin',
  'transportation_resources', 'studio_fleet', 'greenlite'
);

CREATE TYPE crm_report_type AS ENUM (
  'pulse_production_report', '399_production_report'
);

CREATE TYPE crm_segment AS ENUM ('avon', 'hollywood');

CREATE TYPE crm_services_vendor AS ENUM (
  'hdr', 'sky', 'american_tent', 'quixote', 'tent_kings', 'undercover_awning'
);

-- ----------------------------------------------------------------------------
-- CORE ENTITIES
-- ----------------------------------------------------------------------------

CREATE TABLE crm_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,                       -- original MT-CRM id, for ETL only
  name text NOT NULL,
  type text NOT NULL,                      -- production_company | studio
  parent_studio_id uuid REFERENCES crm_companies(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, legacy_id)
);
CREATE INDEX idx_crm_companies_org ON crm_companies(organization_id);
CREATE INDEX idx_crm_companies_legacy ON crm_companies(legacy_id);

CREATE TABLE crm_commercial_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  name text NOT NULL,
  avon_customer_number text,
  location text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, legacy_id)
);
CREATE INDEX idx_crm_commercial_companies_org ON crm_commercial_companies(organization_id);

CREATE TABLE crm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  name text NOT NULL,
  role text NOT NULL,
  phone text,
  email text,
  company_id uuid REFERENCES crm_companies(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  last_contact_date timestamptz,
  last_contact_type text,
  avon_source_code text,
  salesperson text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, legacy_id)
);
CREATE INDEX idx_crm_contacts_org ON crm_contacts(organization_id);
CREATE INDEX idx_crm_contacts_company ON crm_contacts(company_id);

CREATE TABLE crm_productions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  name text NOT NULL,
  company_id uuid REFERENCES crm_companies(id) ON DELETE SET NULL,
  studio_id uuid REFERENCES crm_companies(id) ON DELETE SET NULL,
  status crm_production_status DEFAULT 'prepping' NOT NULL,
  start_date timestamptz,
  end_date timestamptz,
  avon_customer_number text,
  production_type crm_production_type DEFAULT 'other',
  rental_opportunities crm_rental_opportunity[],
  estimated_trailers_needed integer,
  estimated_vehicles_needed integer,
  avon_trailers_on_production integer,
  avon_vehicles_on_production integer,
  state text,
  avon_vehicle_revenue integer,
  total_hdr_revenue integer,
  avon_trailer_revenue integer,
  date_first_appearing_on_report timestamptz,
  is_399_production boolean DEFAULT false,
  primary_transportation_contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL,
  primary_locations_contact_id uuid REFERENCES crm_contacts(id) ON DELETE SET NULL,
  status_changed_at timestamptz,
  production_category text DEFAULT 'other',
  rental_vehicles_vendor crm_rental_vehicle_vendor,
  rental_trailers_vendor crm_rental_vehicle_vendor,
  honeywagon_vendor crm_bathroom_vendor,
  location_services_vendor crm_services_vendor,
  power_distribution_vendor crm_services_vendor,
  camera_trucks_vendor crm_rental_vehicle_vendor,
  production_trucks_vendor crm_rental_vehicle_vendor,
  ac_equipment_vendor crm_services_vendor,
  production_supplies_vendor crm_services_vendor,
  grip_lighting_vendor crm_services_vendor,
  location_services_revenue integer,
  honeywagon_revenue integer,
  bathroom_trailer_revenue integer,
  power_distribution_revenue integer,
  camera_trucks_revenue integer,
  production_trucks_revenue integer,
  ac_equipment_revenue integer,
  production_supplies_revenue integer,
  grip_lighting_revenue integer,
  ca_spend_level integer CHECK (ca_spend_level >= 1 AND ca_spend_level <= 5),
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, legacy_id)
);
CREATE INDEX idx_crm_productions_org ON crm_productions(organization_id);
CREATE INDEX idx_crm_productions_status ON crm_productions(status);
CREATE INDEX idx_crm_productions_company ON crm_productions(company_id);

CREATE TABLE crm_production_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  production_id uuid NOT NULL REFERENCES crm_productions(id) ON DELETE CASCADE,
  alias_name text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX idx_crm_production_aliases_production ON crm_production_aliases(production_id);
CREATE INDEX idx_crm_production_aliases_alias ON crm_production_aliases(alias_name);

CREATE TABLE crm_production_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  production_id uuid NOT NULL REFERENCES crm_productions(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_at timestamptz DEFAULT now() NOT NULL,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  notes text
);
CREATE INDEX idx_crm_production_status_history_production ON crm_production_status_history(production_id);

CREATE TABLE crm_production_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  production_id uuid REFERENCES crm_productions(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL,
  file_size integer NOT NULL,
  uploaded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  uploaded_at timestamptz DEFAULT now() NOT NULL,
  description text,
  report_type crm_report_type DEFAULT 'pulse_production_report'
);

-- Production <-> Reporting Entity association
-- (which reporting entities of the org touch this production)
CREATE TABLE crm_production_entity_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  production_id uuid NOT NULL REFERENCES crm_productions(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  service_offered text,                    -- e.g. avon, hdr, hollywood_site_services
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (production_id, entity_id, service_offered)
);
CREATE INDEX idx_crm_production_entity_assignments_prod ON crm_production_entity_assignments(production_id);
CREATE INDEX idx_crm_production_entity_assignments_entity ON crm_production_entity_assignments(entity_id);

-- ----------------------------------------------------------------------------
-- RELATIONSHIPS / JOINS
-- ----------------------------------------------------------------------------

CREATE TABLE crm_contact_productions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  production_id uuid NOT NULL REFERENCES crm_productions(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (contact_id, production_id)
);

CREATE TABLE crm_contact_commercial_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  commercial_company_id uuid NOT NULL REFERENCES crm_commercial_companies(id) ON DELETE CASCADE,
  role text,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX idx_crm_ccc_contact ON crm_contact_commercial_companies(contact_id);
CREATE INDEX idx_crm_ccc_company ON crm_contact_commercial_companies(commercial_company_id);

CREATE TABLE crm_contact_commercial_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  commercial_opportunity_id uuid NOT NULL,  -- FK added after crm_commercial_opportunities below
  role text,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- ----------------------------------------------------------------------------
-- OPPORTUNITIES & COMMUNICATIONS
-- ----------------------------------------------------------------------------

CREATE TABLE crm_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  production_id uuid REFERENCES crm_productions(id) ON DELETE SET NULL,
  contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  current_segment crm_opportunity_segment NOT NULL,
  description text NOT NULL,
  status crm_opportunity_status DEFAULT 'open' NOT NULL,
  priority crm_priority DEFAULT 'medium' NOT NULL,
  salesperson text,
  amount integer,
  status_comment text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, legacy_id)
);
CREATE INDEX idx_crm_opportunities_org ON crm_opportunities(organization_id);
CREATE INDEX idx_crm_opportunities_production ON crm_opportunities(production_id);

CREATE TABLE crm_opportunity_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  comment text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE crm_commercial_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  commercial_company_id uuid NOT NULL REFERENCES crm_commercial_companies(id) ON DELETE CASCADE,
  job_title text NOT NULL,
  amount integer,
  description text,
  status text NOT NULL DEFAULT 'open',
  status_changed_at timestamptz DEFAULT CURRENT_TIMESTAMP,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, legacy_id)
);
CREATE INDEX idx_crm_commercial_opportunities_org ON crm_commercial_opportunities(organization_id);

-- Close the deferred FK from crm_contact_commercial_opportunities
ALTER TABLE crm_contact_commercial_opportunities
  ADD CONSTRAINT crm_ccop_fk
  FOREIGN KEY (commercial_opportunity_id) REFERENCES crm_commercial_opportunities(id) ON DELETE CASCADE;

CREATE TABLE crm_corporate_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  company_id uuid NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  name text NOT NULL,
  type crm_corporate_opportunity_type NOT NULL,
  stage crm_corporate_opportunity_stage DEFAULT 'initial_contact' NOT NULL,
  description text NOT NULL,
  estimated_value integer,
  expected_close_date timestamptz,
  priority crm_priority DEFAULT 'medium' NOT NULL,
  salesperson text,
  notes text,
  rental_opportunities crm_opportunity_segment[],
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, legacy_id)
);

CREATE TABLE crm_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  contact_id uuid REFERENCES crm_contacts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  type text NOT NULL,
  notes text,
  date timestamptz DEFAULT now() NOT NULL,
  production_id uuid REFERENCES crm_productions(id) ON DELETE SET NULL,
  has_opportunity boolean DEFAULT false,
  opportunity_id uuid REFERENCES crm_opportunities(id) ON DELETE SET NULL,
  salesperson text,
  commercial_company_id uuid REFERENCES crm_commercial_companies(id) ON DELETE SET NULL,
  commercial_opportunity_id uuid REFERENCES crm_commercial_opportunities(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX idx_crm_communications_org ON crm_communications(organization_id);
CREATE INDEX idx_crm_communications_contact ON crm_communications(contact_id);

-- ----------------------------------------------------------------------------
-- EQUIPMENT, BOOKINGS, EVENTS
-- ----------------------------------------------------------------------------

CREATE TABLE crm_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  name text NOT NULL,
  category text NOT NULL,
  segment crm_segment NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  available_quantity integer DEFAULT 1 NOT NULL,
  description text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, legacy_id)
);

CREATE TABLE crm_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  production_id uuid NOT NULL REFERENCES crm_productions(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  equipment_id uuid NOT NULL REFERENCES crm_equipment(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  status crm_booking_status DEFAULT 'pending' NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, legacy_id)
);

CREATE TABLE crm_entertainment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  event_type crm_event_type NOT NULL,
  event_date timestamptz NOT NULL,
  description text NOT NULL,
  capacity integer NOT NULL DEFAULT 1,
  available_slots integer NOT NULL DEFAULT 1,
  event_status crm_event_status DEFAULT 'available' NOT NULL,
  location text NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (organization_id, legacy_id)
);

CREATE TABLE crm_event_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id integer,
  event_id uuid NOT NULL REFERENCES crm_entertainment_events(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  num_guests integer NOT NULL DEFAULT 1,
  notes text,
  assigned_employee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- All CRM tables follow the same policy: organization members can do anything
-- with rows in their org; nothing crosses org boundaries.
-- ============================================================================

DO $$
DECLARE
  t text;
  crm_tables text[] := ARRAY[
    'crm_companies','crm_commercial_companies','crm_contacts','crm_productions',
    'crm_production_aliases','crm_production_status_history','crm_production_reports',
    'crm_production_entity_assignments','crm_contact_productions',
    'crm_contact_commercial_companies','crm_contact_commercial_opportunities',
    'crm_opportunities','crm_opportunity_comments','crm_commercial_opportunities',
    'crm_corporate_opportunities','crm_communications','crm_equipment','crm_bookings',
    'crm_entertainment_events','crm_event_bookings'
  ];
BEGIN
  FOREACH t IN ARRAY crm_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY "Members can view %I" ON %I FOR SELECT USING (organization_id IN (SELECT public.user_org_ids()))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "Members can insert %I" ON %I FOR INSERT WITH CHECK (organization_id IN (SELECT public.user_org_ids()))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "Members can update %I" ON %I FOR UPDATE USING (organization_id IN (SELECT public.user_org_ids()))',
      t, t
    );
    EXECUTE format(
      'CREATE POLICY "Members can delete %I" ON %I FOR DELETE USING (organization_id IN (SELECT public.user_org_ids()))',
      t, t
    );
  END LOOP;
END $$;
