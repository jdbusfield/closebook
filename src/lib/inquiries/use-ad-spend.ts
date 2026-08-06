"use client";

// Monthly ad-spend entries for the sales dashboard's Marketing ROI section.
// Mirrors use-inquiries' dual data path: direct Supabase (RLS-protected) with
// a session, or the key-authenticated embed route inside the admin-portal
// iframe.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { toast } from "sonner";

export interface AdSpendRow {
  id: string;
  month: string; // first of month, YYYY-MM-01
  amount: number;
  notes: string | null;
}

export interface UseAdSpend {
  rows: AdSpendRow[];
  loading: boolean;
  save: (month: string, amount: number) => Promise<void>;
}

export function useAdSpend(entityId: string): UseAdSpend {
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const eid = entityId || embed?.entityId || "";

  const [rows, setRows] = useState<AdSpendRow[]>([]);
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
        const data = await embedPost({ action: "list_ad_spend" });
        setRows(data.rows ?? []);
      } else {
        const supabase = createClient();
        const { data } = await supabase
          .from("rental_inquiry_ad_spend")
          .select("id, month, amount, notes")
          .eq("entity_id", eid)
          .order("month", { ascending: false });
        setRows((data as AdSpendRow[]) ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [isEmbed, eid, embedPost]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (month: string, amount: number) => {
      try {
        if (isEmbed) {
          await embedPost({ action: "save_ad_spend", month, amount });
        } else {
          const supabase = createClient();
          const { error } = await supabase.from("rental_inquiry_ad_spend").upsert(
            {
              entity_id: eid,
              month,
              amount,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "entity_id,month" }
          );
          if (error) throw new Error(error.message);
        }
        await load();
        toast.success("Ad spend saved");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't save ad spend");
      }
    },
    [isEmbed, eid, embedPost, load]
  );

  return { rows, loading, save };
}
