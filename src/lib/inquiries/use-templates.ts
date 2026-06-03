"use client";

// Client data layer for the editable follow-up templates. Loads the entity's
// saved template rows, merges them over the shipped code defaults, and exposes
// the mutations the Templates page calls. The deal-drawer picker reads the same
// effective list, so an edit here changes what reps send everywhere.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("rental_inquiry_templates")
      .select(ROW_COLUMNS)
      .eq("entity_id", entityId)
      .order("sort_order", { ascending: true });
    setRows((data as TemplateRow[]) ?? []);
    setLoading(false);
  }, [entityId]);

  useEffect(() => {
    load();
  }, [load]);

  const all = mergeTemplates(rows);
  const templates = all.filter((t) => !t.archived);

  const save = useCallback(
    async (input: TemplateInput): Promise<boolean> => {
      const supabase = createClient();
      const { error } = await supabase
        .from("rental_inquiry_templates")
        .upsert(
          {
            entity_id: entityId,
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
          },
          { onConflict: "entity_id,template_key" }
        );
      if (error) {
        toast.error(error.message);
        return false;
      }
      toast.success("Template saved");
      await load();
      return true;
    },
    [entityId, load]
  );

  const remove = useCallback(
    async (templateKey: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("rental_inquiry_templates")
        .delete()
        .eq("entity_id", entityId)
        .eq("template_key", templateKey);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Reverted to default");
      await load();
    },
    [entityId, load]
  );

  const setArchived = useCallback(
    async (templateKey: string, archived: boolean) => {
      // Archiving a code default needs a row to hang the flag on; the default
      // may not have been saved yet, so upsert the current effective copy.
      const supabase = createClient();
      const eff = mergeTemplates(rows).find((t) => t.id === templateKey);
      if (!eff) return;
      const { error } = await supabase.from("rental_inquiry_templates").upsert(
        {
          entity_id: entityId,
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
        },
        { onConflict: "entity_id,template_key" }
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(archived ? "Template hidden" : "Template restored");
      await load();
    },
    [entityId, rows, load]
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
