-- ============================================================================
-- Avon Trucks — fleet rate card (Silverco entity)
-- JD's day/week/month rates + a photo per vehicle, editable from Closebook's
-- Inquiries → Rate Card view (embedded into avon-trucks' /admin, same pattern
-- as the resource library) and read live by the public trucks.avonrents.com
-- site via /api/public/avon-rates. Photos reuse the existing PUBLIC
-- inquiry-resources bucket (see 20260715_inquiry_resources.sql) under a
-- fleet-photos/ prefix — no new bucket needed.
--
-- Two taxonomies live on each row, on purpose:
--   - class_slug / class_name — the MARKETING grouping (Box Trucks, Stake Bed
--     Trucks, Camera Trucks...). Matches avon-trucks' src/data/fleet.json
--     classes[].slug exactly, because it drives that site's live
--     /fleet/<slug> SEO landing pages (one per Google Ads ad group) — do not
--     collapse these to match the accounting hierarchy or the site's routes
--     break.
--   - class_code / reporting_group — the REAL fleet classification from
--     src/lib/utils/vehicle-classification.ts (VEHICLE_CLASSIFICATIONS, the
--     RentalWorks-derived codes used everywhere else: fixed_assets.vehicle_class,
--     GL groups, depreciation). Confirmed against live fixed_assets rows for
--     this entity (e.g. class 13 = Isuzu NPR box trucks, class 23 = Ford
--     F-650 large stake). Carried here so a rate card row traces back to the
--     real class instead of inventing a parallel one, and so JD can
--     cross-reference against RentalWorks/the Rental Assets views.
--
-- Notably, several vehicles that read as separate marketing groups roll up
-- under the SAME accounting reporting_group: Camera Trucks (2, 9), the 10 Ton
-- (27), and the Shorty 40 (40) are all "Studio Box Truck". The Refer Van (26)
-- is "Cargo Van", not its own group. vehicle_id is still the join key
-- avon-trucks merges on (must match fleet.json vehicles[].id).
--
-- Vehicle classes that exist in VEHICLE_CLASSIFICATIONS but have no row here
-- (car classes 3/4/5/6/7/12/21, cast/makeup trailers 1R/2R/3R/8MU, 13T/20T/22,
-- 34, 52) aren't in avon-trucks' current marketing fleet at all — out of
-- scope for this migration; flag to JD if the site should grow to cover them.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rental_inquiry_fleet_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  vehicle_id text NOT NULL,        -- matches fleet.json vehicles[].id exactly
  vehicle_name text NOT NULL,
  class_slug text NOT NULL,        -- marketing grouping; matches fleet.json classes[].slug
  class_name text NOT NULL,        -- marketing grouping display name
  class_code text,                 -- real class code, e.g. "15" (see VEHICLE_CLASSIFICATIONS)
  reporting_group text,            -- real reporting group, e.g. "Stakebed"
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
-- Seed rows — the 22 Avon vehicles across 8 marketing classes, rates/photo
-- NULL until JD fills them in via the Rate Card UI. class_code/reporting_group
-- cross-checked against src/lib/utils/vehicle-classification.ts. sort_order
-- matches fleet.json's class order then vehicle order.
-- ----------------------------------------------------------------------------
INSERT INTO rental_inquiry_fleet_rates
  (entity_id, vehicle_id, vehicle_name, class_slug, class_name, class_code, reporting_group, sort_order)
SELECT 'b664a9c1-3817-4df4-9261-f51b3403a5de'::uuid,
  v.vehicle_id, v.vehicle_name, v.class_slug, v.class_name, v.class_code, v.reporting_group, v.sort_order
FROM (VALUES
  -- Box Trucks (marketing) — Studio Box Truck / Box Truck (real)
  ('shorty-40-f650', 'Shorty 40 – 12 Foot Box – F650', 'box-trucks', 'Box Trucks', '40', 'Studio Box Truck', 0),
  ('20-foot-box-truck', '20 Foot Box Truck', 'box-trucks', 'Box Trucks', '20', 'Box Truck', 1),
  ('crew-cab-24-foot-box-truck', 'Crew Cab – 24 Foot Box Truck', 'box-trucks', 'Box Trucks', '14', 'Box Truck', 2),
  -- Stake Bed Trucks (marketing) — Stakebed (real)
  ('stake-bed-f550-12ft', 'Stake Bed – F550 – 12 Foot Bed', 'stake-beds', 'Stake Bed Trucks', '15', 'Stakebed', 3),
  ('stake-bed-4x4-f550-12ft', 'Stake Bed – 4X4 – F550 – 12 Foot Bed', 'stake-beds', 'Stake Bed Trucks', '51', 'Stakebed', 4),
  ('stake-bed-f650-16ft', 'Stake Bed – F650 – 16 Foot Bed', 'stake-beds', 'Stake Bed Trucks', '16', 'Stakebed', 5),
  ('stake-bed-24-foot-bed', 'Stake Bed – 24 Foot Bed', 'stake-beds', 'Stake Bed Trucks', '23', 'Stakebed', 6),
  -- Camera Trucks (marketing) — Studio Box Truck (real)
  ('camera-truck-20-foot-box', 'Camera Truck – 20 Foot Box', 'camera-trucks', 'Camera Trucks', '2', 'Studio Box Truck', 7),
  ('camera-truck-28-foot-box', 'Camera Truck – 28 Foot Box', 'camera-trucks', 'Camera Trucks', '9', 'Studio Box Truck', 8),
  -- Cube Trucks (marketing) — Box Truck (real)
  ('3-ton-16-foot-supercube', '3 Ton – 16 Foot Supercube', 'cube-trucks', 'Cube Trucks', '13', 'Box Truck', 9),
  -- Cargo Vans & Sprinters (marketing) — Cargo Van (real)
  ('cargo-van', 'Cargo Van', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', '11', 'Cargo Van', 10),
  ('cargo-van-high-roof', 'Cargo Van – High Roof', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', '29', 'Cargo Van', 11),
  ('cargo-van-high-roof-liftgate', 'Cargo Van – High Roof w/Liftgate', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', '30', 'Cargo Van', 12),
  ('sprinter-144-shelving', 'Sprinter 144″ with Shelving', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', '31', 'Cargo Van', 13),
  ('sprinter-170-shelving', 'Sprinter 170″ with Shelving', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', '32', 'Cargo Van', 14),
  ('sprinter-170-ext-shelving', 'Sprinter 170″ Ext. with Shelving', 'cargo-vans-sprinters', 'Cargo Vans & Sprinters', '33', 'Cargo Van', 15),
  -- Refrigerated Vans (marketing) — Cargo Van (real; "Refer Van" is not its own reporting group)
  ('refrigerated-cargo-van', 'Refrigerated Cargo Van', 'refrigerated-vans', 'Refrigerated Vans', '26', 'Cargo Van', 16),
  -- 10 Ton Trucks (marketing) — Studio Box Truck (real)
  ('10-ton-freightliner', '10 Ton – Freightliner', 'ten-ton', '10 Ton Trucks', '27', 'Studio Box Truck', 17),
  -- Passenger Vans & Pickups (marketing) — Passenger Van / Car (real)
  ('15-passenger-van-high-roof', '15 Passenger Van – High Roof', 'passenger-vans-pickups', 'Passenger Vans & Pickups', '28', 'Passenger Van', 18),
  ('15-passenger-van-low-roof', '15 Passenger Van – Low Roof', 'passenger-vans-pickups', 'Passenger Vans & Pickups', '8', 'Passenger Van', 19),
  ('pickup-truck-ford-f150', 'Pickup Truck – Ford F150', 'passenger-vans-pickups', 'Passenger Vans & Pickups', '17', 'Car', 20),
  ('pickup-truck-heavy-duty', 'Pickup Truck – Heavy Duty', 'passenger-vans-pickups', 'Passenger Vans & Pickups', '18', 'Car', 21)
) AS v(vehicle_id, vehicle_name, class_slug, class_name, class_code, reporting_group, sort_order)
ON CONFLICT (entity_id, vehicle_id) DO NOTHING;
