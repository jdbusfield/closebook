"use client";

// Client data layer for the HDR Sales CRM. Loads every inquiry for an entity
// joined with its follow-up tasks and activity timeline, and exposes the
// mutations the views call (stage move, unit assign, value, tasks, activity,
// triage, delete). Stage/value/triage go through the PATCH API route (RLS +
// last_activity_at bump); tasks/activity are written directly via the session
// client (RLS-protected) and reset the inquiry's activity clock.

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  type Inquiry,
  type InquiryTask,
  type InquiryActivity,
  type InquiryMessage,
  type InquiryStatus,
  STATUS_LABELS,
} from "@/lib/inquiries/shared";

const INQUIRY_COLUMNS =
  "id, reference, status, name, email, phone, use_case, start_date, end_date, duration, units, attendant, guests, location, notes, internal_notes, rw_quote_number, rw_order_number, source, unit_id, estimated_value, last_activity_at, created_at";

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
}

function isoDateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function useInquiries(entityId: string): UseInquiries {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState("You");

  const inquiriesRef = useRef<Inquiry[]>([]);
  useEffect(() => {
    inquiriesRef.current = inquiries;
  }, [inquiries]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: inqs }, { data: tasks }, { data: activity }, { data: messages }, userRes] =
      await Promise.all([
        supabase
          .from("rental_inquiries")
          .select(INQUIRY_COLUMNS)
          .eq("entity_id", entityId)
          .order("last_activity_at", { ascending: false })
          .limit(1000),
        supabase
          .from("rental_inquiry_tasks")
          .select("id, inquiry_id, title, due_date, done, kind, created_at")
          .eq("entity_id", entityId)
          .limit(2000),
        supabase
          .from("rental_inquiry_activity")
          .select("id, inquiry_id, type, body, actor, occurred_at")
          .eq("entity_id", entityId)
          .order("occurred_at", { ascending: false })
          .limit(2000),
        supabase
          .from("rental_inquiry_messages")
          .select(
            "id, inquiry_id, direction, kind, from_addr, to_addrs, cc_addrs, subject, body_text, body_html, sent_at, received_at, created_at"
          )
          .eq("entity_id", entityId)
          .order("created_at", { ascending: true })
          .limit(3000),
        supabase.auth.getUser(),
      ]);

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

    const assembled = ((inqs as Inquiry[]) ?? []).map((inq) => ({
      ...inq,
      tasks: tasksByInquiry.get(inq.id) ?? [],
      activity: activityByInquiry.get(inq.id) ?? [],
      messages: messagesByInquiry.get(inq.id) ?? [],
    }));
    setInquiries(assembled);

    const user = userRes.data.user;
    if (user) {
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const name =
        (typeof meta?.full_name === "string" && meta.full_name) ||
        (typeof meta?.name === "string" && meta.name) ||
        (user.email ? user.email.split("@")[0] : "You");
      setActor(name as string);
    }
    setLoading(false);
  }, [entityId]);

  useEffect(() => {
    load();
  }, [load]);

  // --- shared helpers ------------------------------------------------------
  const patch = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<boolean> => {
      const res = await fetch(`/api/inquiries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.detail || `Save failed (HTTP ${res.status})`);
      }
      return true;
    },
    []
  );

  const bumpActivityClock = useCallback(async (id: string) => {
    const supabase = createClient();
    await supabase
      .from("rental_inquiries")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", id);
  }, []);

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
        const supabase = createClient();
        await supabase.from("rental_inquiry_activity").insert({
          inquiry_id: id,
          entity_id: entityId,
          type: status === "confirmed" ? "payment" : "note",
          body: `Stage moved to “${STATUS_LABELS[status]}”.`,
          actor,
        });
        toast.success(`Moved to ${STATUS_LABELS[status]}`);
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't move card");
        await load();
      }
    },
    [patch, entityId, actor, load]
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
      const supabase = createClient();
      const { error } = await supabase.from("rental_inquiry_tasks").insert({
        inquiry_id: id,
        entity_id: entityId,
        title,
        kind,
        due_date: isoDateInDays(dueOffsetDays),
        done: false,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      await bumpActivityClock(id);
      toast.success("Reminder added");
      await load();
    },
    [entityId, bumpActivityClock, load]
  );

  const toggleTask = useCallback(
    async (taskId: string, done: boolean) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("rental_inquiry_tasks")
        .update({ done, completed_at: done ? new Date().toISOString() : null })
        .eq("id", taskId);
      if (error) {
        toast.error(error.message);
        return;
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
    []
  );

  const addActivity = useCallback(
    async (id: string, type: InquiryActivity["type"], body: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("rental_inquiry_activity").insert({
        inquiry_id: id,
        entity_id: entityId,
        type,
        body,
        actor,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      await bumpActivityClock(id);
      toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} logged`);
      await load();
    },
    [entityId, actor, bumpActivityClock, load]
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
    [load]
  );

  const deleteInquiry = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/inquiries/${id}`, { method: "DELETE" });
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
    []
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
  };
}
