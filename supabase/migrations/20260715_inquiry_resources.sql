-- ============================================================================
-- HDR Sales CRM — shared resource library (photos, spec sheets, FAQs)
-- Folder-organized files the team sends customers constantly (4-stall photos,
-- ADA trailer photos, spec sheets...). Surfaced as a persistent panel in the
-- top-right of every Inquiries view, and attachable to funnel emails as links.
-- Files live in the PUBLIC `inquiry-resources` storage bucket — these are
-- marketing assets meant to be emailed out, so stable public URLs (usable in
-- outbound email bodies) beat expiring signed links. Entity-scoped like the
-- rest of the inquiry CRM, so HDR and Versatile each keep their own library.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rental_inquiry_resource_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_resource_folders_entity
  ON rental_inquiry_resource_folders(entity_id, sort_order);

CREATE TRIGGER update_rental_inquiry_resource_folders_updated_at
  BEFORE UPDATE ON rental_inquiry_resource_folders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS rental_inquiry_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES rental_inquiry_resource_folders(id) ON DELETE SET NULL,
  label text NOT NULL,                 -- display name, e.g. "4-Stall Luxury — exterior"
  file_path text NOT NULL,             -- path within the inquiry-resources bucket
  mime_type text,
  size_bytes bigint,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text,                     -- display name; embed has no auth.uid()
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_resources_entity
  ON rental_inquiry_resources(entity_id, folder_id, sort_order);

CREATE TRIGGER update_rental_inquiry_resources_updated_at
  BEFORE UPDATE ON rental_inquiry_resources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security — any member of the entity gets full read/write, matching
-- rental_inquiry_templates (operational, not financial-sensitive).
-- ----------------------------------------------------------------------------
ALTER TABLE rental_inquiry_resource_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_inquiry_resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view resource folders in their entities" ON rental_inquiry_resource_folders;
CREATE POLICY "Users can view resource folders in their entities"
  ON rental_inquiry_resource_folders FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can insert resource folders in their entities" ON rental_inquiry_resource_folders;
CREATE POLICY "Users can insert resource folders in their entities"
  ON rental_inquiry_resource_folders FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can update resource folders in their entities" ON rental_inquiry_resource_folders;
CREATE POLICY "Users can update resource folders in their entities"
  ON rental_inquiry_resource_folders FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can delete resource folders in their entities" ON rental_inquiry_resource_folders;
CREATE POLICY "Users can delete resource folders in their entities"
  ON rental_inquiry_resource_folders FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can view resources in their entities" ON rental_inquiry_resources;
CREATE POLICY "Users can view resources in their entities"
  ON rental_inquiry_resources FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can insert resources in their entities" ON rental_inquiry_resources;
CREATE POLICY "Users can insert resources in their entities"
  ON rental_inquiry_resources FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can update resources in their entities" ON rental_inquiry_resources;
CREATE POLICY "Users can update resources in their entities"
  ON rental_inquiry_resources FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can delete resources in their entities" ON rental_inquiry_resources;
CREATE POLICY "Users can delete resources in their entities"
  ON rental_inquiry_resources FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));

-- ----------------------------------------------------------------------------
-- Storage — PUBLIC bucket (marketing assets meant to be shared with customers).
-- Writes stay restricted: authenticated users via storage RLS; the embed
-- uploads through /api/storage/signed-upload-url (service role) instead.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('inquiry-resources', 'inquiry-resources', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "Anyone can read inquiry resources"
ON storage.objects
FOR SELECT
USING (bucket_id = 'inquiry-resources');

CREATE POLICY "Authenticated users can upload inquiry resources"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'inquiry-resources');

CREATE POLICY "Authenticated users can update inquiry resources"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'inquiry-resources')
WITH CHECK (bucket_id = 'inquiry-resources');

CREATE POLICY "Authenticated users can delete inquiry resources"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'inquiry-resources');

-- Starter folders for HDR Site Services so the panel isn't empty on first load.
INSERT INTO rental_inquiry_resource_folders (entity_id, name, sort_order)
SELECT e.id, f.name, f.sort_order
FROM (VALUES
  ('Trailer Photos', 0),
  ('Spec Sheets', 1),
  ('Pricing & FAQ', 2)
) AS f(name, sort_order)
CROSS JOIN (SELECT id FROM entities WHERE id = '7529580d-3b44-4a9b-91f4-bc2db25f5211') e
WHERE NOT EXISTS (
  SELECT 1 FROM rental_inquiry_resource_folders x
  WHERE x.entity_id = e.id AND x.name = f.name
);
