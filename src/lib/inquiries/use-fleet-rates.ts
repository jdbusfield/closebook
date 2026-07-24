"use client";

// Client data layer for the Avon fleet rate card. Mirrors use-resources.ts:
// with a Supabase session it reads/writes the table directly (RLS-scoped);
// inside the key-authenticated embed it POSTs to /api/inquiries/embed.
// Photo uploads go through /api/storage/signed-upload-url in BOTH modes (that
// route accepts either a session or the embed key) into the same public
// inquiry-resources bucket the resource library uses, then PUT directly to
// storage via the returned token.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { toast } from "sonner";
import { FLEET_PHOTO_PREFIX, type FleetRateRow } from "@/lib/inquiries/fleet-rates";

const RATE_COLUMNS =
  "id, vehicle_id, vehicle_name, class_slug, class_name, class_code, reporting_group, day_rate, week_rate, month_rate, photo_path, sort_order, updated_at";

export interface RatePatch {
  day_rate?: number | null;
  week_rate?: number | null;
  month_rate?: number | null;
  photo_path?: string | null;
}

export interface UseFleetRates {
  rows: FleetRateRow[];
  loading: boolean;
  reload: () => Promise<void>;
  saveRate: (id: string, patch: RatePatch) => Promise<void>;
  uploadPhoto: (vehicleId: string, id: string, file: File) => Promise<void>;
}

export function useFleetRates(entityId: string): UseFleetRates {
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const eid = entityId || embed?.entityId || "";

  const [rows, setRows] = useState<FleetRateRow[]>([]);
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
        const data = await embedPost({ action: "list_fleet_rates" });
        setRows((data.rows as FleetRateRow[]) ?? []);
        return;
      }
      const supabase = createClient();
      const { data } = await supabase
        .from("rental_inquiry_fleet_rates")
        .select(RATE_COLUMNS)
        .eq("entity_id", eid)
        .order("sort_order", { ascending: true });
      setRows((data as FleetRateRow[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [eid, isEmbed, embedPost]);

  useEffect(() => {
    load();
  }, [load]);

  const saveRate = useCallback(
    async (id: string, patch: RatePatch) => {
      try {
        if (isEmbed) {
          await embedPost({ action: "save_fleet_rate", id, patch });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_fleet_rates")
            .update(patch)
            .eq("id", id)
            .eq("entity_id", eid);
          if (error) throw new Error(error.message);
        }
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't save that rate");
        await load();
      }
    },
    [eid, isEmbed, embedPost, load]
  );

  const uploadPhoto = useCallback(
    async (vehicleId: string, id: string, file: File) => {
      try {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${eid}/${FLEET_PHOTO_PREFIX}/${vehicleId}-${Date.now()}-${safeName}`;
        const res = await fetch("/api/storage/signed-upload-url", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(isEmbed && embedKey ? { "x-embed-key": embedKey } : {}),
          },
          body: JSON.stringify({ bucket: "inquiry-resources", path }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Upload URL failed (HTTP ${res.status})`);
        }
        const { token } = await res.json();
        const supabase = createClient();
        const { error: upErr } = await supabase.storage
          .from("inquiry-resources")
          .uploadToSignedUrl(path, token, file, { contentType: file.type || undefined });
        if (upErr) throw new Error(upErr.message);

        await saveRate(id, { photo_path: path });
        toast.success("Photo uploaded");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Photo upload failed");
      }
    },
    [eid, isEmbed, embedKey, saveRate]
  );

  return { rows, loading, reload: load, saveRate, uploadPhoto };
}
