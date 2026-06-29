"use client";

// Client data layer for the HDR Sales CRM. Loads every inquiry for an entity
// joined with its follow-up tasks and activity timeline, and exposes the
// mutations the views call (stage move, unit assign, value, tasks, activity,
// triage, delete). Stage/value/triage go through the PATCH API route (RLS +
// last_activity_at bump); tasks/activity are written directly via the session
// client (RLS-protected) and reset the inquiry's activity clock.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { toast } from "sonner";
import {
  type Inquiry,
  type InquiryTask,
  type InquiryActivity,
  type InquiryMessage,
  type InquiryQuote,
  type InquiryStatus,
  STATUS_LABELS,
} from "@/lib/inquiries/shared";

const INQUIRY_COLUMNS =
  "id, reference, status, name, email, phone, use_case, start_date, end_date, duration, units, attendant, guests, location, notes, request_type, deposit, billing_name, billing_address, internal_notes, rw_quote_number, rw_order_number, source, unit_id, estimated_value, gclid, last_activity_at, created_at";

const QUOTE_COLUMNS =
  "id, inquiry_id, quote_number, status, lines, subtotal, tax_rate, tax, total, valid_until, terms, accepted_at, created_by, created_at, updated_at";

// The fields a rep fills in when drafting a quote (number + totals are computed).
export interface QuoteDraft {
  lines: { description: string; qty: number; rate: number }[];
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  valid_until?: string | null;
  terms?: string | null;
}

export interface UseInquiries {
  inquiries: Inquiry[];
  loading: boolean;
  actor: string;
  reload: () => Promise<void>;
  moveStage: (id: string, status: InquiryStatus) => Promise<void>;
  assignUnit: (id: string, unitId: string | null) => Promise<void>;
  setEstimatedValue: (id: string, value: number | null) => Promise<void>;
  updateTriage: (id: string, body: Record<string, unknown>, msg?: string) => Promise<void>;
  addTask: (
    id: string,
    title: string,
    kind?: InquiryTask["kind"],
    dueOffsetDays?: number
  ) => Promise<void>;
  toggleTask: (taskId: string, done: boolean) => Promise<void>;
  addActivity: (id: string, type: InquiryActivity["type"], body: string) => Promise<void>;
  deleteActivity: (activityId: string) => Promise<void>;
  deleteInquiry: (id: string) => Promise<boolean>;
  addQuote: (id: string, draft: QuoteDraft) => Promise<InquiryQuote | null>;
  updateQuoteStatus: (quoteId: string, status: InquiryQuote["status"]) => Promise<void>;
  deleteQuote: (quoteId: string) => Promise<void>;
}

function isoDateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function useInquiries(entityId: string): UseInquiries {
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const eid = entityId || embed?.entityId || "";

  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState(isEmbed ? "HDR Team" : "You");

  const inquiriesRef = useRef<Inquiry[]>([]);
  useEffect(() => {
    inquiriesRef.current = inquiries;
  }, [inquiries]);

  // POST an embed action to the key-authenticated route (no-op shape when not
  // embedded — callers guard on isEmbed first).
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
    let inqs: Inquiry[] | null;
    let tasks: InquiryTask[] | null;
    let activity: InquiryActivity[] | null;
    let messages: InquiryMessage[] | null;
    let quotes: InquiryQuote[] | null;

    if (isEmbed) {
      // No Supabase session in the iframe — read everything through the
      // key-authenticated embed route (admin client, scoped to HDR).
      const data = await embedPost({ action: "list_pipeline" });
      inqs = data.inquiries;
      tasks = data.tasks;
      activity = data.activity;
      messages = data.messages;
      quotes = data.quotes;
    } else {
      const supabase = createClient();
      const [inqRes, taskRes, actRes, msgRes, quoteRes, userRes] = await Promise.all([
        supabase
          .from("rental_inquiries")
          .select(INQUIRY_COLUMNS)
          .eq("entity_id", eid)
          .order("last_activity_at", { ascending: false })
          .limit(1000),
        supabase
          .from("rental_inquiry_tasks")
          .select("id, inquiry_id, title, due_date, done, kind, created_at")
          .eq("entity_id", eid)
          .limit(2000),
        supabase
          .from("rental_inquiry_activity")
          .select("id, inquiry_id, type, body, actor, occurred_at")
          .eq("entity_id", eid)
          .order("occurred_at", { ascending: false })
          .limit(2000),
        supabase
          .from("rental_inquiry_messages")
          .select(
            "id, inquiry_id, direction, kind, from_addr, to_addrs, cc_addrs, subject, body_text, body_html, sent_at, received_at, created_at"
          )
          .eq("entity_id", eid)
          .order("created_at", { ascending: true })
          .limit(3000),
        supabase
          .from("rental_inquiry_quotes")
          .select(QUOTE_COLUMNS)
          .eq("entity_id", eid)
          .order("created_at", { ascending: false })
          .limit(2000),
        supabase.auth.getUser(),
      ]);
      inqs = inqRes.data as Inquiry[] | null;
      tasks = taskRes.data as InquiryTask[] | null;
      activity = actRes.data as InquiryActivity[] | null;
      messages = msgRes.data as InquiryMessage[] | null;
      quotes = quoteRes.data as InquiryQuote[] | null;
      const user = userRes.data.user;
      if (user) {
        const meta = user.user_metadata as Record<string, unknown> | undefined;
        const name =
          (typeof meta?.full_name === "string" && meta.full_name) ||
          (typeof meta?.name === "string" && meta.name) ||
          (user.email ? user.email.split("@")[0] : "You");
        setActor(name as string);
      }
    }

    const tasksByInquiry = new Map<string, InquiryTask[]>();
    for (const t of (tasks as InquiryTask[]) ?? []) {
      if (!tasksByInquiry.has(t.inquiry_id)) tasksByInquiry.set(t.inquiry_id, []);
      tasksByInquiry.get(t.inquiry_id)!.push(t);
    }
    const activityByInquiry = new Map<string, InquiryActivity[]>();
    for (const a of (activity as InquiryActivity[]) ?? []) {
      if (!activityByInquiry.has(a.inquiry_id)) activityByInquiry.set(a.inquiry_id, []);
      activityByInquiry.get(a.inquiry_id)!.push(a);
    }
    const messagesByInquiry = new Map<string, InquiryMessage[]>();
    for (const msg of (messages as InquiryMessage[]) ?? []) {
      if (!msg.inquiry_id) continue;
      if (!messagesByInquiry.has(msg.inquiry_id)) messagesByInquiry.set(msg.inquiry_id, []);
      messagesByInquiry.get(msg.inquiry_id)!.push(msg);
    }
    const quotesByInquiry = new Map<string, InquiryQuote[]>();
    for (const q of (quotes as InquiryQuote[]) ?? []) {
      if (!q.inquiry_id) continue;
      if (!quotesByInquiry.has(q.inquiry_id)) quotesByInquiry.set(q.inquiry_id, []);
      quotesByInquiry.get(q.inquiry_id)!.push(q);
    }

    const assembled = ((inqs as Inquiry[]) ?? []).map((inq) => ({
      ...inq,
      tasks: tasksByInquiry.get(inq.id) ?? [],
      activity: activityByInquiry.get(inq.id) ?? [],
      messages: messagesByInquiry.get(inq.id) ?? [],
      quotes: quotesByInquiry.get(inq.id) ?? [],
    }));
    setInquiries(assembled);
    setLoading(false);
  }, [isEmbed, eid, embedPost]);

  useEffect(() => {
    load();
  }, [load]);

  // --- shared helpers ------------------------------------------------------
  const patch = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<boolean> => {
      const res = await fetch(`/api/inquiries/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(embedKey ? { "x-embed-key": embedKey } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.detail || `Save failed (HTTP ${res.status})`);
      }
      return true;
    },
    [embedKey]
  );

  const bumpActivityClock = useCallback(
    async (id: string) => {
      if (isEmbed) {
        await embedPost({ action: "bump_activity_clock", id });
        return;
      }
      const supabase = createClient();
      await supabase
        .from("rental_inquiries")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", id);
    },
    [isEmbed, embedPost]
  );

  // --- mutations -----------------------------------------------------------
  const moveStage = useCallback(
    async (id: string, status: InquiryStatus) => {
      const target = inquiriesRef.current.find((i) => i.id === id);
      if (!target || target.status === status) return;
      // Optimistic.
      setInquiries((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status } : i))
      );
      try {
        await patch(id, { status });
        // Log the move on the timeline (best-effort, like the design).
        const moveType = status === "confirmed" ? "payment" : "note";
        const moveBody = `Stage moved to “${STATUS_LABELS[status]}”.`;
        if (isEmbed) {
          await embedPost({
            action: "insert_activity",
            id,
            type: moveType,
            activityBody: moveBody,
            actor,
          });
        } else {
          const supabase = createClient();
          await supabase.from("rental_inquiry_activity").insert({
            inquiry_id: id,
            entity_id: eid,
            type: moveType,
            body: moveBody,
            actor,
          });
        }
        toast.success(`Moved to ${STATUS_LABELS[status]}`);
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't move card");
        await load();
      }
    },
    [patch, eid, isEmbed, embedPost, actor, load]
  );

  const assignUnit = useCallback(
    async (id: string, unitId: string | null) => {
      try {
        await patch(id, { unit_id: unitId });
        toast.success(unitId ? "Unit assigned" : "Unit unassigned");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't assign unit");
      }
    },
    [patch, load]
  );

  const setEstimatedValue = useCallback(
    async (id: string, value: number | null) => {
      try {
        await patch(id, { estimated_value: value });
        toast.success("Value saved");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't save value");
      }
    },
    [patch, load]
  );

  const updateTriage = useCallback(
    async (id: string, body: Record<string, unknown>, msg = "Saved") => {
      try {
        await patch(id, body);
        toast.success(msg);
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
      }
    },
    [patch, load]
  );

  const addTask = useCallback(
    async (
      id: string,
      title: string,
      kind: InquiryTask["kind"] = "call",
      dueOffsetDays = 2
    ) => {
      try {
        if (isEmbed) {
          await embedPost({
            action: "add_task",
            id,
            title,
            kind,
            due_date: isoDateInDays(dueOffsetDays),
          });
        } else {
          const supabase = createClient();
          const { error } = await supabase.from("rental_inquiry_tasks").insert({
            inquiry_id: id,
            entity_id: eid,
            title,
            kind,
            due_date: isoDateInDays(dueOffsetDays),
            done: false,
          });
          if (error) throw new Error(error.message);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't add reminder");
        return;
      }
      await bumpActivityClock(id);
      toast.success("Reminder added");
      await load();
    },
    [eid, isEmbed, embedPost, bumpActivityClock, load]
  );

  const toggleTask = useCallback(
    async (taskId: string, done: boolean) => {
      if (isEmbed) {
        try {
          await embedPost({ action: "toggle_task", taskId, done });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't update task");
          return;
        }
      } else {
        const supabase = createClient();
        const { error } = await supabase
          .from("rental_inquiry_tasks")
          .update({ done, completed_at: done ? new Date().toISOString() : null })
          .eq("id", taskId);
        if (error) {
          toast.error(error.message);
          return;
        }
      }
      // Optimistic local toggle for snappy checkboxes.
      setInquiries((prev) =>
        prev.map((i) => ({
          ...i,
          tasks: (i.tasks || []).map((t) =>
            t.id === taskId ? { ...t, done } : t
          ),
        }))
      );
    },
    [isEmbed, embedPost]
  );

  const addActivity = useCallback(
    async (id: string, type: InquiryActivity["type"], body: string) => {
      try {
        if (isEmbed) {
          await embedPost({ action: "insert_activity", id, type, activityBody: body, actor });
        } else {
          const supabase = createClient();
          const { error } = await supabase.from("rental_inquiry_activity").insert({
            inquiry_id: id,
            entity_id: eid,
            type,
            body,
            actor,
          });
          if (error) throw new Error(error.message);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't log activity");
        return;
      }
      await bumpActivityClock(id);
      toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} logged`);
      await load();
    },
    [eid, isEmbed, embedPost, actor, bumpActivityClock, load]
  );

  const deleteActivity = useCallback(
    async (activityId: string) => {
      // Optimistically drop it so an accidental log disappears immediately.
      setInquiries((prev) =>
        prev.map((i) => ({
          ...i,
          activity: (i.activity || []).filter((a) => a.id !== activityId),
        }))
      );
      if (isEmbed) {
        try {
          await embedPost({ action: "delete_activity", activityId });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't remove activity");
          await load();
          return;
        }
        toast.success("Activity removed");
        return;
      }
      const supabase = createClient();
      const { error } = await supabase
        .from("rental_inquiry_activity")
        .delete()
        .eq("id", activityId);
      if (error) {
        toast.error(error.message);
        await load(); // restore server truth on failure
        return;
      }
      toast.success("Activity removed");
    },
    [isEmbed, embedPost, load]
  );

  // --- Quotes --------------------------------------------------------------
  const addQuote = useCallback(
    async (id: string, draft: QuoteDraft): Promise<InquiryQuote | null> => {
      let created: InquiryQuote | null = null;
      try {
        if (isEmbed) {
          const res = await embedPost({ action: "create_quote", id, draft });
          created = res.quote as InquiryQuote;
        } else {
          const supabase = createClient();
          const { data, error } = await supabase
            .from("rental_inquiry_quotes")
            .insert({
              inquiry_id: id,
              entity_id: eid,
              lines: draft.lines,
              subtotal: draft.subtotal,
              tax_rate: draft.tax_rate,
              tax: draft.tax,
              total: draft.total,
              valid_until: draft.valid_until ?? null,
              terms: draft.terms ?? null,
              created_by: actor,
            })
            .select(QUOTE_COLUMNS)
            .single();
          if (error) throw new Error(error.message);
          created = data as unknown as InquiryQuote;
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't save quote");
        return null;
      }
      // Log the quote on the timeline, bump the clock, and refresh.
      await addActivity(
        id,
        "quote",
        `Drafted quote ${created?.quote_number ?? ""} — $${(draft.total || 0).toLocaleString("en-US")}.`
      );
      await load();
      return created;
    },
    [eid, isEmbed, embedPost, actor, addActivity, load]
  );

  const updateQuoteStatus = useCallback(
    async (quoteId: string, status: InquiryQuote["status"]) => {
      // Acceptance is stamped so the accepted PDF can show the date; moving a
      // quote out of accepted clears the stamp.
      const acceptedAt = status === "accepted" ? new Date().toISOString() : null;
      // Optimistic local status flip.
      setInquiries((prev) =>
        prev.map((i) => ({
          ...i,
          quotes: (i.quotes || []).map((q) =>
            q.id === quoteId ? { ...q, status, accepted_at: acceptedAt } : q
          ),
        }))
      );
      try {
        if (isEmbed) {
          await embedPost({ action: "update_quote", quoteId, status });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_quotes")
            .update({ status, accepted_at: acceptedAt })
            .eq("id", quoteId);
          if (error) throw new Error(error.message);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't update quote");
        await load();
      }
    },
    [isEmbed, embedPost, load]
  );

  const deleteQuote = useCallback(
    async (quoteId: string) => {
      setInquiries((prev) =>
        prev.map((i) => ({
          ...i,
          quotes: (i.quotes || []).filter((q) => q.id !== quoteId),
        }))
      );
      try {
        if (isEmbed) {
          await embedPost({ action: "delete_quote", quoteId });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_quotes")
            .delete()
            .eq("id", quoteId);
          if (error) throw new Error(error.message);
        }
        toast.success("Quote removed");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't remove quote");
        await load();
      }
    },
    [isEmbed, embedPost, load]
  );

  const deleteInquiry = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/inquiries/${id}`, {
          method: "DELETE",
          headers: embedKey ? { "x-embed-key": embedKey } : undefined,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Delete failed");
        }
        toast.success("Inquiry deleted");
        setInquiries((prev) => prev.filter((i) => i.id !== id));
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Delete failed");
        return false;
      }
    },
    [embedKey]
  );

  return {
    inquiries,
    loading,
    actor,
    reload: load,
    moveStage,
    assignUnit,
    setEstimatedValue,
    updateTriage,
    addTask,
    toggleTask,
    addActivity,
    deleteActivity,
    deleteInquiry,
    addQuote,
    updateQuoteStatus,
    deleteQuote,
  };
}
