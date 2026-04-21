-- Add unique constraint on (entity_id, asset_tag) for import upsert behavior.
-- Partial index: only enforced when asset_tag is NOT NULL so untagged assets are fine.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fixed_assets_entity_tag
  ON fixed_assets (entity_id, asset_tag)
  WHERE asset_tag IS NOT NULL;
