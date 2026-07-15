"use client";

// Client data layer for the email funnels. Reads + funnel/step editing follow
// the standard dual path (session -> Supabase direct, embed -> the embed data
// route). Enrollment actions (enroll/stop/resume) ALWAYS go through
// /api/inquiries/funnels regardless of mode — those send email, which only the
// server can do; the route accepts either a session or the embed key.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { toast } from "sonner";
import type { Funnel, FunnelStep, FunnelEnrollment } from "@/lib/inquiries/funnels";

const FUNNEL_COLUMNS = "id, name, description, archived, sort_order";
const STEP_COLUMNS = "id, funnel_id, day_offset, subject, body, resource_ids, sort_order";
const ENROLLMENT_COLUMNS =
  "id, inquiry_id, funnel_id, status, enrolled_at, enrolled_by, steps_sent, next_send_at, replied_at, stopped_reason";

export interface UseFunnels {
  funnels: Funnel[]; // live (unarchived)
  allFunnels: Funnel[];
  steps: FunnelStep[];
  enrollments: FunnelEnrollment[];
  loading: boolean;
  reload: () => Promise<void>;
  stepsFor: (funnelId: string) => FunnelStep[];
  enrollmentFor: (inquiryId: string) => FunnelEnrollment | undefined; // latest
  saveFunnel: (funnel: {
    id?: string;
    name: string;
    description?: string | null;
    archived?: boolean;
    sort_order?: number;
  }) => Promise<string | null>;
  deleteFunnel: (funnelId: string) => Promise<void>;
  saveStep: (step: {
    id?: string;
    funnel_id: string;
    day_offset?: number;
    subject?: string;
    body?: string;
    resource_ids?: string[];
    sort_order?: number;
  }) => Promise<boolean>;
  deleteStep: (stepId: string) => Promise<void>;
  enroll: (inquiryId: string, funnelId: string, actor?: string | null) => Promise<boolean>;
  stopEnrollment: (enrollmentId: string) => Promise<void>;
  resumeEnrollment: (enrollmentId: string) => Promise<void>;
}

export function useFunnels(entityId: string): UseFunnels {
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const eid = entityId || embed?.entityId || "";

  const [allFunnels, setAllFunnels] = useState<Funnel[]>([]);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [enrollments, setEnrollments] = useState<FunnelEnrollment[]>([]);
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

  // Enrollment control route — same call shape in both modes.
  const funnelsApi = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/inquiries/funnels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isEmbed && embedKey ? { "x-embed-key": embedKey } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
      return data;
    },
    [isEmbed, embedKey]
  );

  const load = useCallback(async () => {
    try {
      if (isEmbed) {
        const data = await embedPost({ action: "list_funnels" });
        setAllFunnels((data.funnels as Funnel[]) ?? []);
        setSteps((data.steps as FunnelStep[]) ?? []);
        setEnrollments((data.enrollments as FunnelEnrollment[]) ?? []);
        return;
      }
      const supabase = createClient();
      const [f, s, e] = await Promise.all([
        supabase
          .from("rental_inquiry_funnels")
          .select(FUNNEL_COLUMNS)
          .eq("entity_id", eid)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        supabase
          .from("rental_inquiry_funnel_steps")
          .select(STEP_COLUMNS)
          .eq("entity_id", eid)
          .order("day_offset", { ascending: true })
          .order("sort_order", { ascending: true }),
        supabase
          .from("rental_inquiry_funnel_enrollments")
          .select(ENROLLMENT_COLUMNS)
          .eq("entity_id", eid)
          .order("created_at", { ascending: false })
          .limit(2000),
      ]);
      setAllFunnels((f.data as Funnel[]) ?? []);
      setSteps((s.data as FunnelStep[]) ?? []);
      setEnrollments((e.data as FunnelEnrollment[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [eid, isEmbed, embedPost]);

  useEffect(() => {
    load();
  }, [load]);

  const funnels = allFunnels.filter((f) => !f.archived);

  const stepsFor = useCallback(
    (funnelId: string) =>
      steps
        .filter((s) => s.funnel_id === funnelId)
        .sort((a, b) => a.day_offset - b.day_offset || a.sort_order - b.sort_order),
    [steps]
  );

  const enrollmentFor = useCallback(
    (inquiryId: string) => enrollments.find((e) => e.inquiry_id === inquiryId),
    [enrollments]
  );

  const saveFunnel = useCallback(
    async (funnel: {
      id?: string;
      name: string;
      description?: string | null;
      archived?: boolean;
      sort_order?: number;
    }): Promise<string | null> => {
      try {
        if (isEmbed) {
          const data = await embedPost({ action: "save_funnel", funnel });
          await load();
          return (data.id as string) ?? null;
        }
        const supabase = createClient();
        if (funnel.id) {
          const { id, ...patch } = funnel;
          const { error } = await supabase
            .from("rental_inquiry_funnels")
            .update(patch)
            .eq("id", id)
            .eq("entity_id", eid);
          if (error) throw new Error(error.message);
          await load();
          return id;
        }
        const { data, error } = await supabase
          .from("rental_inquiry_funnels")
          .insert({ ...funnel, entity_id: eid })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        await load();
        return data.id;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
        return null;
      }
    },
    [eid, isEmbed, embedPost, load]
  );

  const deleteFunnel = useCallback(
    async (funnelId: string) => {
      try {
        if (isEmbed) {
          await embedPost({ action: "delete_funnel", funnelId });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_funnels")
            .delete()
            .eq("id", funnelId)
            .eq("entity_id", eid);
          if (error) throw new Error(error.message);
        }
        toast.success("Funnel deleted");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [eid, isEmbed, embedPost, load]
  );

  const saveStep = useCallback(
    async (step: {
      id?: string;
      funnel_id: string;
      day_offset?: number;
      subject?: string;
      body?: string;
      resource_ids?: string[];
      sort_order?: number;
    }): Promise<boolean> => {
      try {
        if (isEmbed) {
          await embedPost({ action: "save_funnel_step", step });
        } else {
          const supabase = createClient();
          if (step.id) {
            const { id, ...patch } = step;
            const { error } = await supabase
              .from("rental_inquiry_funnel_steps")
              .update(patch)
              .eq("id", id)
              .eq("entity_id", eid);
            if (error) throw new Error(error.message);
          } else {
            const { error } = await supabase
              .from("rental_inquiry_funnel_steps")
              .insert({ ...step, entity_id: eid });
            if (error) throw new Error(error.message);
          }
        }
        await load();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Save failed");
        return false;
      }
    },
    [eid, isEmbed, embedPost, load]
  );

  const deleteStep = useCallback(
    async (stepId: string) => {
      try {
        if (isEmbed) {
          await embedPost({ action: "delete_funnel_step", stepId });
        } else {
          const supabase = createClient();
          const { error } = await supabase
            .from("rental_inquiry_funnel_steps")
            .delete()
            .eq("id", stepId)
            .eq("entity_id", eid);
          if (error) throw new Error(error.message);
        }
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [eid, isEmbed, embedPost, load]
  );

  const enroll = useCallback(
    async (inquiryId: string, funnelId: string, actor?: string | null): Promise<boolean> => {
      try {
        const data = await funnelsApi({ action: "enroll", inquiryId, funnelId, actor });
        toast.success(
          data.sendResult?.outcome === "sent"
            ? "Funnel started — first email sent"
            : "Funnel started"
        );
        await load();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't start the funnel");
        return false;
      }
    },
    [funnelsApi, load]
  );

  const stopEnrollment = useCallback(
    async (enrollmentId: string) => {
      try {
        await funnelsApi({ action: "stop", enrollmentId });
        toast.success("Funnel stopped");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't stop the funnel");
      }
    },
    [funnelsApi, load]
  );

  const resumeEnrollment = useCallback(
    async (enrollmentId: string) => {
      try {
        await funnelsApi({ action: "resume", enrollmentId });
        toast.success("Funnel resumed — next email goes out on the next hourly tick");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't resume the funnel");
      }
    },
    [funnelsApi, load]
  );

  return {
    funnels,
    allFunnels,
    steps,
    enrollments,
    loading,
    reload: load,
    stepsFor,
    enrollmentFor,
    saveFunnel,
    deleteFunnel,
    saveStep,
    deleteStep,
    enroll,
    stopEnrollment,
    resumeEnrollment,
  };
}
