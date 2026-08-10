-- ============================================================================
-- Diligence Documents
-- File attachments on diligence request-list items, stored in the private
-- diligence-docs bucket. Rows carry deal_id so the deal page can list every
-- document with its item association in one query.
-- ============================================================================

CREATE TABLE diligence_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES diligence_deals(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES diligence_items(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_diligence_documents_org ON diligence_documents(organization_id);
CREATE INDEX idx_diligence_documents_deal ON diligence_documents(deal_id);
CREATE INDEX idx_diligence_documents_item ON diligence_documents(item_id);

-- ============================================================================
-- Row Level Security (same org-membership pattern as the other diligence tables)
-- ============================================================================

DO $$
DECLARE
  t text := 'diligence_documents';
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format(
    'CREATE POLICY "Members can view %I" ON %I FOR SELECT USING (organization_id IN (SELECT public.user_org_ids()))', t, t);
  EXECUTE format(
    'CREATE POLICY "Members can insert %I" ON %I FOR INSERT WITH CHECK (organization_id IN (SELECT public.user_org_ids()))', t, t);
  EXECUTE format(
    'CREATE POLICY "Members can update %I" ON %I FOR UPDATE USING (organization_id IN (SELECT public.user_org_ids()))', t, t);
  EXECUTE format(
    'CREATE POLICY "Members can delete %I" ON %I FOR DELETE USING (organization_id IN (SELECT public.user_org_ids()))', t, t);
END $$;

-- ============================================================================
-- Storage bucket + policies
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('diligence-docs', 'diligence-docs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload diligence docs"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'diligence-docs');

CREATE POLICY "Authenticated users can read diligence docs"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'diligence-docs');

CREATE POLICY "Authenticated users can delete diligence docs"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'diligence-docs');
