import { HDR_ENTITY_ID, VERSATILE_ENTITY_ID, SILVERCO_ENTITY_ID } from "@/lib/inquiries/shared";

// Single source of truth for embed-key -> entity resolution, shared by every
// key-authenticated embed route (the data route + the per-inquiry / message REST
// routes). Each brand has its OWN embed key, and a presented key resolves to
// EXACTLY one entity — derived server-side from the `x-embed-key` header, never
// from the request body. So a given key can only ever read/write that brand's
// data; there is no cross-tenant path. Returns null for a missing/unknown key.
export function resolveEmbedEntity(request: Request): string | null {
  const k = request.headers.get("x-embed-key");
  if (!k) return null;
  if (process.env.EMBED_API_KEY && k === process.env.EMBED_API_KEY) return HDR_ENTITY_ID;
  if (process.env.EMBED_API_KEY_VERSATILE && k === process.env.EMBED_API_KEY_VERSATILE) {
    return VERSATILE_ENTITY_ID;
  }
  if (process.env.EMBED_API_KEY_AVON && k === process.env.EMBED_API_KEY_AVON) {
    return SILVERCO_ENTITY_ID;
  }
  return null;
}
