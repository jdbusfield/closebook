// Shared types + helpers for the inquiry resource library (the folder-organized
// photos / spec sheets the team sends customers constantly). Files live in the
// PUBLIC `inquiry-resources` storage bucket, so a resource's URL is stable and
// safe to paste or embed in outbound email (including automated funnel sends).

export const RESOURCE_BUCKET = "inquiry-resources";

export interface ResourceFolder {
  id: string;
  name: string;
  sort_order: number;
}

export interface ResourceItem {
  id: string;
  folder_id: string | null;
  label: string;
  file_path: string; // path within the inquiry-resources bucket
  mime_type: string | null;
  size_bytes: number | null;
  sort_order: number;
  created_at: string;
}

// Public CDN URL for a resource — no signing, no expiry.
export function publicResourceUrl(filePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return `${base}/storage/v1/object/public/${RESOURCE_BUCKET}/${filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

export function isImage(r: Pick<ResourceItem, "mime_type" | "file_path">): boolean {
  if (r.mime_type) return r.mime_type.startsWith("image/");
  return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(r.file_path);
}

export function fmtSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
