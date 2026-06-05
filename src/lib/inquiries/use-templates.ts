"use client";

// Client data layer for the editable follow-up templates. Loads the entity's
// saved template rows, merges them over the shipped code defaults, and exposes
// the mutations the Templates page calls. The deal-drawer picker reads the same
// effective list, so an edit here changes what reps send everywhere.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { toast } from "sonner";
import {
  type EffectiveTemplate,
  type TemplateRow,
  type TemplateChannel,
  type TemplateTrack,
  mergeTemplates,
} from "@/lib/inquiries/templates";

const ROW_COLUMNS =
  "id, template_key, label, channel, track, stages, cadence, subject, body, sort_order, archived";

export interface TemplateInput {
  template_key: string;
  label: string;
  channel: TemplateChannel;
  track: TemplateTrack;
  stages: string[];
  cadence: string | null;
  subject: string | null;
  body: string;
  sort_order?: number;
}

export interface UseTemplates {
  templates: EffectiveTemplate[]; // live set (archived hidden) — for picker/preview
  allTemplates: EffectiveTemplate[]; // includes archived — for the editor
  loading: boolean;
  reload: () => Promise<void>;
  save: (input: TemplateInput) => Promise<boolean>;
  remove: (templateKey: string) => Promise<void>; // reset default / delete custom
  setArchived: (templateKey: string, archived: boolean) => Promise<void>;
  newCustomKey: () => string;
}

export function useTemplates(entityId: string): UseTemplates {
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const eid = entityId || embed?.entityId || "";

  const [rows, setRows] = useState<TemplateRow[]>([]);
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
    if (isEmbed) {
      const data = await embedPost({ action: "list_templates" });
      setRows((data.rows as TemplateRow[]) ?? []);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("rental_inquiry_templates")
      .select(ROW_COLUMNS)
      .eq("entity_id", eid)
      .order("sort_order", { ascending: true });
    setRows((data as TemplateRow[]) ?? []);
    setLoading(false);
  }, [eid, isEmbed, embedPost]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() is async; setState only runs after the await
    load();
  }, [load]);

  const all = mergeTemplates(rows);
  const templates = all.filter((t) => !t.archived);

  const save = useCallback(
    async (input: TemplateInput): Promise<boolean> => {
      const template = {
        template_key: input.template_key,
        label: input.label,
        channel: input.channel,
        track: input.track,
        stages: input.stages,
        cadence: input.cadence,
        subject: input.subject,
        body: input.body,
        sort_order: input.sort_order ?? 0,
        archived: false,
      };
      if (isEmbed) {
        try {
          await embedPost({ action: "save_template", template });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Save failed");
          return false;
        }
      } else {
        const supabase = createClient();
        const { error } = await supabase
          .from("rental_inquiry_templates")
          .upsert({ ...template, entity_id: eid }, { onConflict: "entity_id,template_key" });
        if (error) {
          toast.error(error.message);
          return false;
        }
      }
      toast.success("Template saved");
      await load();
      return true;
    },
    [eid, isEmbed, embedPost, load]
  );

  const remove = useCallback(
    async (templateKey: string) => {
      if (isEmbed) {
        try {
          await embedPost({ action: "delete_template", templateKey });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed");
          return;
        }
      } else {
        const supabase = createClient();
        const { error } = await supabase
          .from("rental_inquiry_templates")
          .delete()
          .eq("entity_id", eid)
          .eq("template_key", templateKey);
        if (error) {
          toast.error(error.message);
          return;
        }
      }
      toast.success("Reverted to default");
      await load();
    },
    [eid, isEmbed, embedPost, load]
  );

  const setArchived = useCallback(
    async (templateKey: string, archived: boolean) => {
      // Archiving a code default needs a row to hang the flag on; the default
      // may not have been saved yet, so upsert the current effective copy.
      const eff = mergeTemplates(rows).find((t) => t.id === templateKey);
      if (!eff) return;
      const template = {
        template_key: templateKey,
        label: eff.label,
        channel: eff.channel,
        track: eff.track,
        stages: eff.stages,
        cadence: eff.cadence ?? null,
        subject: eff.subject ?? null,
        body: eff.body,
        sort_order: eff.sortOrder,
        archived,
      };
      if (isEmbed) {
        try {
          await embedPost({ action: "save_template", template });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed");
          return;
        }
      } else {
        const supabase = createClient();
        const { error } = await supabase
          .from("rental_inquiry_templates")
          .upsert({ ...template, entity_id: eid }, { onConflict: "entity_id,template_key" });
        if (error) {
          toast.error(error.message);
          return;
        }
      }
      toast.success(archived ? "Template hidden" : "Template restored");
      await load();
    },
    [eid, isEmbed, embedPost, rows, load]
  );

  const newCustomKey = useCallback(
    () =>
      `custom-${
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2)
      }`,
    []
  );

  return {
    templates,
    allTemplates: all,
    loading,
    reload: load,
    save,
    remove,
    setArchived,
    newCustomKey,
  };
}
