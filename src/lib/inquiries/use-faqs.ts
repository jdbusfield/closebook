"use client";

// Client data layer for the inquiry FAQ reference (the FAQ tab of the resource
// library). Mirrors the dual-path pattern in use-resources.ts: with a Supabase
// session it reads/writes rental_inquiry_faqs directly (RLS-scoped); inside
// the key-authenticated embed it POSTs to /api/inquiries/embed.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { toast } from "sonner";

const FAQ_COLUMNS = "id, question, answer, sort_order, created_at";

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  sort_order: number;
  created_at: string;
}

export interface UseFaqs {
  faqs: FaqItem[];
  loading: boolean;
  reload: () => Promise<void>;
  createFaq: (question: string, answer: string) => Promise<void>;
  updateFaq: (id: string, patch: { question?: string; answer?: string }) => Promise<void>;
  deleteFaq: (id: string) => Promise<void>;
}

export function useFaqs(entityId: string): UseFaqs {
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const eid = entityId || embed?.entityId || "";

  const [faqs, setFaqs] = useState<FaqItem[]>([]);
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
        const data = await embedPost({ action: "list_faqs" });
        setFaqs((data.faqs as FaqItem[]) ?? []);
        return;
      }
      const supabase = createClient();
      const { data } = await supabase
        .from("rental_inquiry_faqs")
        .select(FAQ_COLUMNS)
        .eq("entity_id", eid)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      setFaqs((data as FaqItem[]) ?? []);
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

  const createFaq = useCallback(
    (question: string, answer: string) =>
      run(async () => {
        if (isEmbed) {
          await embedPost({ action: "save_faq", faq: { question, answer } });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_faqs")
            .insert({ entity_id: eid, question, answer });
          if (error) throw new Error(error.message);
        }
      }, "FAQ added"),
    [eid, isEmbed, embedPost, run]
  );

  const updateFaq = useCallback(
    (id: string, patch: { question?: string; answer?: string }) =>
      run(async () => {
        if (isEmbed) {
          await embedPost({ action: "save_faq", faq: { id, ...patch } });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_faqs")
            .update(patch)
            .eq("id", id)
            .eq("entity_id", eid);
          if (error) throw new Error(error.message);
        }
      }, "Saved"),
    [eid, isEmbed, embedPost, run]
  );

  const deleteFaq = useCallback(
    (id: string) =>
      run(async () => {
        if (isEmbed) {
          await embedPost({ action: "delete_faq", faqId: id });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_faqs")
            .delete()
            .eq("id", id)
            .eq("entity_id", eid);
          if (error) throw new Error(error.message);
        }
      }, "Deleted"),
    [eid, isEmbed, embedPost, run]
  );

  return { faqs, loading, reload: load, createFaq, updateFaq, deleteFaq };
}
