-- ============================================================================
-- Avon Trucks — fleet rate card (Silverco entity)
-- JD's day/week/month rates + a photo per vehicle, editable from Closebook's
-- Inquiries → Rate Card view (embedded into avon-trucks' /admin, same pattern
-- as the resource library) and read live by the public trucks.avonrents.com
-- site via /api/public/avon-rates. Vehicle ids/names/classes mirror
-- avon-trucks' src/data/fleet.json exactly, so a row's vehicle_id is the join
-- key the marketing site merges on. Photos reuse the existing PUBLIC
-- inquiry-resources bucket (see 20260715_inquiry_resources.sql) under a
-- fleet-photos/ prefix — no new bucket needed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rental_inquiry_fleet_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  vehicle_id text NOT NULL,        -- matches fleet.json vehicles[].id exactly
  vehicle_name text NOT NULL,
  class_slug text NOT NULL,        -- matches fleet.json classes[].slug
  class_name text NOT NULL,
  day_rate numeric,
  week_rate numeric,
  month_rate numeric,
  photo_path text,                 -- path within the inquiry-resources bucket
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_fleet_rates_entity
  ON rental_inquiry_fleet_rates(entity_id, sort_order);

CREATE TRIGGER update_rental_inquiry_fleet_rates_updated_at
  BEFORE UPDATE ON rental_inquiry_fleet_rates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security — any member of the entity gets full read/write, matching
-- rental_inquiry_resources (operational marketing data, not financial-sensitive).
-- The public read path (site consuming rates) goes through the service-role
-- /api/public/avon-rates route below, never through RLS directly.
-- ----------------------------------------------------------------------------
ALTER TABLE rental_inquiry_fleet_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view fleet rates in their entities" ON rental_inquiry_fleet_rates;
CREATE POLICY "Users can view fleet rates in their entities"
  ON rental_inquiry_fleet_rates FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can insert fleet rates in their entities" ON rental_inquiry_fleet_rates;
CREATE POLICY "Users can insert fleet rates in their entities"
  ON rental_inquiry_fleet_rates FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can update fleet rates in their entities" ON rental_inquiry_fleet_rates;
CREATE POLICY "Users can update fleet rates in their entities"
  ON rental_inquiry_fleet_rates FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can delete fleet rates in their entities" ON rental_inquiry_fleet_rates;
CREATE POLICY "Users can delete fleet rates in their entities"
  ON rental_inquiry_fleet_rates FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));

-- ----------------------------------------------------------------------------
-- Seed rows — the 22 Avon vehicles across 8 classes, rates/photo NULL until JD
-- fills them in via the Rate Card UI. Order matches fleet.json class order
-- then vehicle order, so sort_order alone reproduces the site's grouping.
-- ----------------------------------------------------------------------------
INSERT INTO rental_inquiry_fleet_rates (entity_id, vehicle_id, vehicle_name, class_slug, class_name, sort_order)
SELECT 'b664a9c1-3817-4df4-9261-f51b3403a5de'::uuid, v.vehicle_id, v.vehicle_name, v.class_slug, v.class_name, v.sort_order
FROM (VALUES
  ('shorty-40-f650', 'Shorty 40 – 12 Foot Box – F650', 'box-trucks', 'Box Trucks', 0),
  ('20-foot-box-truck', '20 Foot Box Truck', 'box-trucks', 'Box Trucks', 1),
  ('crew-cab-24-foot-box-truck', 'Crew Cab – 24 Foot Box Truck', 'box-trucks', 'Box Trucks', 2),
  ('stake-bed-f550-12ft', 'Stake Bed – F550 – 12 Foot Bed', 'stake-beds', 'Stake Bed Trucks', 3),
  ('stake-bed-4x4-f550-12ft', 'Stake Bed – 4X4 – F550 – 12 Foot Bed', 'stake-beds', 'Stake Bed Trucks', 4),
  ('stake-bed-f650-16ft', 'Stake Bed – F650 – 16 Foot Bed', 'stake-beds', 'Stake Bed Trucks', 5),
  ('stake-bed-24-foot-bed', 'Stake Bed – 24 Foot Bed', 'stake-beds', 'Stake Bed Trucks', 6),
  ('camera-truck-20-foot-box', 'Camera Truck – 20 Foot Box', 'camera-trucks', 'Camera Trucks', 7),
  ('camera-truck-28-foot-box', 'Camera Truck – 28 Foot Box', 'camera-trucks', 'Camera Trucks', 8),
  ('3-ton-16-foot-supercube', '3 Ton – 16 Foot Supercube', 'cube-trucks', 'Cube Trucks', 9),
  ('cargo-van', 'Cargo Van', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', 10),
  ('cargo-van-high-roof', 'Cargo Van – High Roof', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', 11),
  ('cargo-van-high-roof-liftgate', 'Cargo Van – High Roof w/Liftgate', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', 12),
  ('sprinter-144-shelving', 'Sprinter 144″ with Shelving', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', 13),
  ('sprinter-170-shelving', 'Sprinter 170″ with Shelving', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', 14),
  ('sprinter-170-ext-shelving', 'Sprinter 170″ Ext. with Shelving', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', 15),
  ('refrigerated-cargo-van', 'Refrigerated Cargo Van', 'refrigerated-vans', 'Refrigerated Vans', 16),
  ('10-ton-freightliner', '10 Ton – Freightliner', 'ten-ton', '10 Ton Trucks', 17),
  ('15-passenger-van-high-roof', '15 Passenger Van – High Roof', 'passenger-vans-pickups', 'Passenger Vans & Pickups', 18),
  ('15-passenger-van-low-roof', '15 Passenger Van – Low Roof', 'passenger-vans-pickups', 'Passenger Vans & Pickups', 19),
  ('pickup-truck-ford-f150', 'Pickup Truck – Ford F150', 'passenger-vans-pickups', 'Passenger Vans & Pickups', 20),
  ('pickup-truck-heavy-duty', 'Pickup Truck – Heavy Duty', 'passenger-vans-pickups', 'Passenger Vans & Pickups', 21)
) AS v(vehicle_id, vehicle_name, class_slug, class_name, sort_order)
ON CONFLICT (entity_id, vehicle_id) DO NOTHING;
