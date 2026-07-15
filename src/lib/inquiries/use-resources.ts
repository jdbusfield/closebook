"use client";

// Client data layer for the inquiry resource library. Mirrors the dual-path
// pattern in use-templates.ts: with a Supabase session it reads/writes the
// tables directly (RLS-scoped); inside the key-authenticated embed it POSTs to
// /api/inquiries/embed. Uploads go through /api/storage/signed-upload-url in
// BOTH modes (that route accepts either a session or the embed key), then PUT
// directly to storage via the returned token, so big photos never transit a
// Vercel function body.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { toast } from "sonner";
import {
  RESOURCE_BUCKET,
  type ResourceFolder,
  type ResourceItem,
} from "@/lib/inquiries/resources";

const FOLDER_COLUMNS = "id, name, sort_order";
const RESOURCE_COLUMNS =
  "id, folder_id, label, file_path, mime_type, size_bytes, sort_order, created_at";

export interface UseResources {
  folders: ResourceFolder[];
  resources: ResourceItem[];
  loading: boolean;
  reload: () => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>; // items fall back to "Unfiled"
  uploadResource: (file: File, folderId: string | null, label?: string) => Promise<void>;
  updateResource: (
    id: string,
    patch: { label?: string; folder_id?: string | null }
  ) => Promise<void>;
  deleteResource: (id: string) => Promise<void>;
}

export function useResources(entityId: string): UseResources {
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const eid = entityId || embed?.entityId || "";

  const [folders, setFolders] = useState<ResourceFolder[]>([]);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);

  const embedPost = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/inquiries/embed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(embedKey ? { "x-embed-key": embedKey } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (HTTP ${res.status})`);
      }
      return res.json();
    },
    [embedKey]
  );

  const load = useCallback(async () => {
    try {
      if (isEmbed) {
        const data = await embedPost({ action: "list_resources" });
        setFolders((data.folders as ResourceFolder[]) ?? []);
        setResources((data.resources as ResourceItem[]) ?? []);
        return;
      }
      const supabase = createClient();
      const [f, r] = await Promise.all([
        supabase
          .from("rental_inquiry_resource_folders")
          .select(FOLDER_COLUMNS)
          .eq("entity_id", eid)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase
          .from("rental_inquiry_resources")
          .select(RESOURCE_COLUMNS)
          .eq("entity_id", eid)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
      ]);
      setFolders((f.data as ResourceFolder[]) ?? []);
      setResources((r.data as ResourceItem[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [eid, isEmbed, embedPost]);

  useEffect(() => {
    load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<void>, ok?: string) => {
      try {
        await fn();
        if (ok) toast.success(ok);
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Something went wrong");
      }
    },
    [load]
  );

  const createFolder = useCallback(
    (name: string) =>
      run(async () => {
        if (isEmbed) {
          await embedPost({ action: "save_resource_folder", folder: { name } });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_resource_folders")
            .insert({ entity_id: eid, name });
          if (error) throw new Error(error.message);
        }
      }, "Folder created"),
    [eid, isEmbed, embedPost, run]
  );

  const renameFolder = useCallback(
    (id: string, name: string) =>
      run(async () => {
        if (isEmbed) {
          await embedPost({ action: "save_resource_folder", folder: { id, name } });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_resource_folders")
            .update({ name })
            .eq("id", id)
            .eq("entity_id", eid);
          if (error) throw new Error(error.message);
        }
      }),
    [eid, isEmbed, embedPost, run]
  );

  const deleteFolder = useCallback(
    (id: string) =>
      run(async () => {
        if (isEmbed) {
          await embedPost({ action: "delete_resource_folder", folderId: id });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_resource_folders")
            .delete()
            .eq("id", id)
            .eq("entity_id", eid);
          if (error) throw new Error(error.message);
        }
      }, "Folder deleted"),
    [eid, isEmbed, embedPost, run]
  );

  const uploadResource = useCallback(
    async (file: File, folderId: string | null, label?: string) => {
      try {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${eid}/${Date.now()}-${safeName}`;
        const res = await fetch("/api/storage/signed-upload-url", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(isEmbed && embedKey ? { "x-embed-key": embedKey } : {}),
          },
          body: JSON.stringify({ bucket: RESOURCE_BUCKET, path }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Upload URL failed (HTTP ${res.status})`);
        }
        const { token } = await res.json();
        const supabase = createClient();
        const { error: upErr } = await supabase.storage
          .from(RESOURCE_BUCKET)
          .uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
        if (upErr) throw new Error(upErr.message);

        const row = {
          folder_id: folderId,
          label: label?.trim() || file.name.replace(/\.[^.]+$/, ""),
          file_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
        };
        if (isEmbed) {
          await embedPost({ action: "save_resource", resource: row });
        } else {
          const { error } = await supabase
            .from("rental_inquiry_resources")
            .insert({ ...row, entity_id: eid });
          if (error) throw new Error(error.message);
        }
        toast.success("Uploaded");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      }
    },
    [eid, isEmbed, embedKey, embedPost, load]
  );

  const updateResource = useCallback(
    (id: string, patch: { label?: string; folder_id?: string | null }) =>
      run(async () => {
        if (isEmbed) {
          await embedPost({ action: "save_resource", resource: { id, ...patch } });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_resources")
            .update(patch)
            .eq("id", id)
            .eq("entity_id", eid);
          if (error) throw new Error(error.message);
        }
      }),
    [eid, isEmbed, embedPost, run]
  );

  const deleteResource = useCallback(
    (id: string) =>
      run(async () => {
        const item = resources.find((r) => r.id === id);
        if (isEmbed) {
          // The embed action also removes the storage object (service role).
          await embedPost({ action: "delete_resource", resourceId: id });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_resources")
            .delete()
            .eq("id", id)
            .eq("entity_id", eid);
          if (error) throw new Error(error.message);
          if (item) {
            // Best-effort cleanup; an orphaned file in the public bucket is harmless.
            await supabase.storage.from(RESOURCE_BUCKET).remove([item.file_path]);
          }
        }
      }, "Deleted"),
    [eid, isEmbed, embedPost, run, resources]
  );

  return {
    folders,
    resources,
    loading,
    reload: load,
    createFolder,
    renameFolder,
    deleteFolder,
    uploadResource,
    updateResource,
    deleteResource,
  };
}
