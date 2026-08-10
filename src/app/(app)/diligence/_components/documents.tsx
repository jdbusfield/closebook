"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { DiligenceDocumentRow } from "@/lib/db/queries/diligence";
import { DILIGENCE_BUCKET, formatBytes } from "@/lib/diligence/storage";

async function uploadDiligenceDoc(dealId: string, itemId: string, file: File): Promise<string | null> {
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${dealId}/${itemId}/${Date.now()}-${safeName}`;
  const res = await fetch("/api/storage/signed-upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket: DILIGENCE_BUCKET, path }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    return err?.error ?? `Upload URL failed (HTTP ${res.status})`;
  }
  const { token } = (await res.json()) as { token: string };
  const supabase = createClient();
  const { error: upErr } = await supabase.storage
    .from(DILIGENCE_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
  if (upErr) return upErr.message;

  const recordRes = await fetch("/api/diligence/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deal_id: dealId,
      item_id: itemId,
      file_name: file.name,
      file_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
    }),
  });
  if (!recordRes.ok) {
    const err = (await recordRes.json().catch(() => null)) as { error?: string } | null;
    return err?.error ?? "Failed to record document";
  }
  return null;
}

async function openDiligenceDoc(path: string) {
  const res = await fetch("/api/storage/signed-download-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket: DILIGENCE_BUCKET, path }),
  });
  if (!res.ok) return;
  const { signedUrl } = (await res.json()) as { signedUrl: string };
  window.open(signedUrl, "_blank");
}

async function deleteDiligenceDoc(id: string) {
  await fetch(`/api/diligence/documents/${id}`, { method: "DELETE" });
}

/** Attachment list + upload button shown inside an expanded checklist item. */
export function ItemAttachments({
  dealId,
  itemId,
  documents,
}: {
  dealId: string;
  itemId: string;
  documents: DiligenceDocumentRow[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(files)) {
      const err = await uploadDiligenceDoc(dealId, itemId, file);
      if (err) {
        setError(err);
        break;
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">Attachments</label>
      {documents.length > 0 && (
        <ul className="mb-2 space-y-1">
          {documents.map(doc => (
            <li key={doc.id} className="flex items-center gap-2 text-sm">
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="truncate text-left hover:underline"
                title={doc.file_name}
                onClick={() => openDiligenceDoc(doc.file_path)}
              >
                {doc.file_name}
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(doc.size_bytes)}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-rose-600"
                title="Delete attachment"
                onClick={async () => {
                  await deleteDiligenceDoc(doc.id);
                  router.refresh();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <Paperclip className="mr-1 h-3 w-3" />
        )}
        {uploading ? "Uploading…" : "Upload document"}
      </Button>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

function shortItemRef(doc: DiligenceDocumentRow): string {
  if (!doc.item) return "—";
  const title = doc.item.title.length > 48 ? `${doc.item.title.slice(0, 48)}…` : doc.item.title;
  return `${doc.item.category} · ${title}`;
}

/** Deal-level roll-up of every uploaded document and its item association. */
export function DocumentsSection({ documents }: { documents: DiligenceDocumentRow[] }) {
  const router = useRouter();
  if (documents.length === 0) return null;

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="flex items-center justify-between text-sm font-semibold">
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> Documents
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {documents.length} {documents.length === 1 ? "file" : "files"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">File</th>
              <th className="px-4 py-2 text-left">Checklist item</th>
              <th className="px-4 py-2 text-left">Size</th>
              <th className="px-4 py-2 text-left">Uploaded</th>
              <th className="px-4 py-2 text-right" />
            </tr>
          </thead>
          <tbody>
            {documents.map(doc => (
              <tr key={doc.id} className="border-t hover:bg-muted/30">
                <td className="max-w-[16rem] truncate px-4 py-2 font-medium" title={doc.file_name}>
                  <button
                    type="button"
                    className="inline-flex max-w-full items-center gap-1.5 hover:underline"
                    onClick={() => openDiligenceDoc(doc.file_path)}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{doc.file_name}</span>
                  </button>
                </td>
                <td className="px-4 py-2 text-muted-foreground" title={doc.item?.title ?? undefined}>
                  {shortItemRef(doc)}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{formatBytes(doc.size_bytes)}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {new Date(doc.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    className="mr-2 text-muted-foreground hover:text-foreground"
                    title="Download"
                    onClick={() => openDiligenceDoc(doc.file_path)}
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-rose-600"
                    title="Delete"
                    onClick={async () => {
                      await deleteDiligenceDoc(doc.id);
                      router.refresh();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
