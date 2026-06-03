-- ============================================================================
-- HDR Sales CRM — editable follow-up templates
-- Persists the follow-up copy (texts / emails / call scripts) so the team can
-- edit it in-app on the Inquiries → Templates page, instead of it living only
-- in code. Code still ships the DEFAULT set (src/lib/inquiries/templates.ts);
-- a row here is an *override* of a default (same template_key) or a brand-new
-- custom template (template_key = 'custom-<uuid>'). Archiving a default's key
-- hides that default. Entity-scoped, mirrors the rental_inquiry_tasks model.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rental_inquiry_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  template_key text NOT NULL,          -- matches a code default id, or 'custom-<uuid>'
  label text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'call')),
  track text NOT NULL
    CHECK (track IN ('production', 'construction', 'event', 'emergency', 'general')),
  stages text[] NOT NULL DEFAULT '{}', -- subset of inquiry statuses this step applies to
  cadence text,                         -- human hint, e.g. "Within 5 min of the inquiry"
  subject text,                         -- email only
  body text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (entity_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_rental_inquiry_templates_entity
  ON rental_inquiry_templates(entity_id, archived);

CREATE TRIGGER update_rental_inquiry_templates_updated_at
  BEFORE UPDATE ON rental_inquiry_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security — any member of the entity gets full read/write, matching
-- the rest of the inquiry CRM (operational, not financial-sensitive).
-- ----------------------------------------------------------------------------
ALTER TABLE rental_inquiry_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view inquiry templates in their entities" ON rental_inquiry_templates;
CREATE POLICY "Users can view inquiry templates in their entities"
  ON rental_inquiry_templates FOR SELECT
  USING (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can insert inquiry templates in their entities" ON rental_inquiry_templates;
CREATE POLICY "Users can insert inquiry templates in their entities"
  ON rental_inquiry_templates FOR INSERT
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can update inquiry templates in their entities" ON rental_inquiry_templates;
CREATE POLICY "Users can update inquiry templates in their entities"
  ON rental_inquiry_templates FOR UPDATE
  USING (entity_id IN (SELECT public.user_entity_ids()))
  WITH CHECK (entity_id IN (SELECT public.user_entity_ids()));

DROP POLICY IF EXISTS "Users can delete inquiry templates in their entities" ON rental_inquiry_templates;
CREATE POLICY "Users can delete inquiry templates in their entities"
  ON rental_inquiry_templates FOR DELETE
  USING (entity_id IN (SELECT public.user_entity_ids()));
