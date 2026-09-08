-- Member access scopes: restrict a member to a subset of entities and modules.
--
-- NULL in either column means "everything" (today's behaviour), so every
-- existing member is unchanged by this migration.
--
--   modules     text[]  module keys the member may open (see src/lib/access/modules.ts)
--   entity_ids  uuid[]  entities the member may see; enforced in RLS via user_entity_ids()

ALTER TABLE organization_members
  ADD COLUMN IF NOT EXISTS modules text[] NULL,
  ADD COLUMN IF NOT EXISTS entity_ids uuid[] NULL;

ALTER TABLE organization_invites
  ADD COLUMN IF NOT EXISTS modules text[] NULL,
  ADD COLUMN IF NOT EXISTS entity_ids uuid[] NULL;

-- Entity IDs the current user has access to. Same signature as before, so the
-- ~130 RLS policies that call it pick up the entity allowlist automatically.
CREATE OR REPLACE FUNCTION public.user_entity_ids()
RETURNS SETOF uuid AS $$
  SELECT e.id FROM entities e
  INNER JOIN organization_members om ON om.organization_id = e.organization_id
  WHERE om.user_id = auth.uid()
    AND (om.entity_ids IS NULL OR e.id = ANY(om.entity_ids))
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Role for one entity: entity override first, then org role. Returns NULL when
-- the entity is outside the member's allowlist so "manage" policies fail closed.
CREATE OR REPLACE FUNCTION public.user_entity_role(p_entity_id uuid)
RETURNS text AS $$
  SELECT COALESCE(
    (SELECT ea.role FROM entity_access ea
     WHERE ea.entity_id = p_entity_id AND ea.user_id = auth.uid()),
    (SELECT om.role FROM organization_members om
     INNER JOIN entities e ON e.organization_id = om.organization_id
     WHERE e.id = p_entity_id AND om.user_id = auth.uid())
  )
  WHERE p_entity_id IN (SELECT public.user_entity_ids())
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- The entities list itself (entity switcher, org dashboard) must honour the allowlist.
DROP POLICY IF EXISTS "Members can view entities in their org" ON entities;
CREATE POLICY "Members can view entities in their org" ON entities FOR SELECT USING (
  id IN (SELECT public.user_entity_ids())
);
