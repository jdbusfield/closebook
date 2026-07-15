"use client";

// Editor for the automated email funnels, rendered on the Inquiries → Templates
// page. Left: the entity's funnels. Right: the selected funnel's steps — day
// offset, subject, body (same {merge} tokens as templates), and optional
// resource-library attachments whose public links get appended to the email.
// Live preview renders each step exactly as a customer would read it.

import { useMemo, useState } from "react";
import {
  Plus,
  Save,
  Trash2,
  Zap,
  Eye,
  EyeOff,
  Paperclip,
  Clock,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFunnels } from "@/lib/inquiries/use-funnels";
import { useResources } from "@/lib/inquiries/use-resources";
import { dayLabel, type Funnel, type FunnelStep } from "@/lib/inquiries/funnels";
import { renderTemplate, type MessageTemplate } from "@/lib/inquiries/templates";
import type { Inquiry } from "@/lib/inquiries/shared";

// A representative lead so previews show realistic, filled-in copy (mirrors the
// sample on the templates editor above).
const SAMPLE: Inquiry = {
  id: "sample",
  reference: "HDR-7F3K2",
  status: "new",
  name: "Jordan Avery",
  email: "jordan.avery@example.com",
  phone: "(818) 555-0142",
  use_case: "Wedding",
  start_date: "2026-08-22",
  end_date: "2026-08-23",
  duration: "2 days",
  units: 1,
  attendant: "Yes",
  guests: "120",
  location: "Malibu, CA",
  notes: null,
  request_type: "inquiry",
  deposit: null,
  billing_name: null,
  billing_address: null,
  document_note: null,
  note_on_quote: true,
  note_on_invoice: true,
  internal_notes: null,
  lost_reason: null,
  rw_quote_number: null,
  rw_order_number: null,
  source: "website",
  unit_id: null,
  estimated_value: 3800,
  gclid: null,
  last_activity_at: null,
  created_at: "2026-07-01T17:00:00.000Z",
} as Inquiry;

interface StepDraft {
  day_offset: string; // held as text so the input stays controlled
  subject: string;
  body: string;
  resource_ids: string[];
}

function toStepDraft(s: FunnelStep): StepDraft {
  return {
    day_offset: String(s.day_offset),
    subject: s.subject,
    body: s.body,
    resource_ids: [...(s.resource_ids ?? [])],
  };
}

function StepCard({
  step,
  resources,
  folders,
  onSave,
  onDelete,
}: {
  step: FunnelStep;
  resources: ReturnType<typeof useResources>["resources"];
  folders: ReturnType<typeof useResources>["folders"];
  onSave: (draft: StepDraft) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<StepDraft>(() => toStepDraft(step));
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);

  const patch = (p: Partial<StepDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };

  const rendered = useMemo(() => {
    const tpl: MessageTemplate = {
      id: "preview",
      label: "",
      channel: "email",
      track: "general",
      stages: [],
      subject: draft.subject,
      body: draft.body,
    };
    return renderTemplate(tpl, SAMPLE, "");
  }, [draft.subject, draft.body]);

  const attached = resources.filter((r) => draft.resource_ids.includes(r.id));

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
          <Clock className="size-3" />
          {dayLabel(Number(draft.day_offset) || 0)}
        </span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Send on day
          <Input
            type="number"
            min={0}
            value={draft.day_offset}
            onChange={(e) => patch({ day_offset: e.target.value })}
            className="h-7 w-16 text-sm"
          />
        </label>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                <Paperclip className="size-3.5" />
                {draft.resource_ids.length > 0
                  ? `${draft.resource_ids.length} attached`
                  : "Attach resources"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              <DropdownMenuLabel className="text-xs">
                Linked at the bottom of the email
              </DropdownMenuLabel>
              {resources.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No resources yet — add some via the Resources button up top.
                </div>
              )}
              {resources.map((r) => {
                const folder = folders.find((f) => f.id === r.folder_id);
                return (
                  <DropdownMenuCheckboxItem
                    key={r.id}
                    checked={draft.resource_ids.includes(r.id)}
                    onCheckedChange={(checked) =>
                      patch({
                        resource_ids: checked
                          ? [...draft.resource_ids, r.id]
                          : draft.resource_ids.filter((id) => id !== r.id),
                      })
                    }
                  >
                    <span className="truncate">
                      {r.label}
                      {folder ? (
                        <span className="text-muted-foreground"> · {folder.name}</span>
                      ) : null}
                    </span>
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setPreview((v) => !v)}
          >
            {preview ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            Preview
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-destructive"
            title="Delete step"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {preview ? (
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-1 text-sm font-medium">{rendered.subject || "(no subject)"}</div>
          <div className="whitespace-pre-wrap text-sm text-foreground/90">{rendered.body}</div>
          {attached.length > 0 && (
            <div className="mt-3 text-sm">
              <div className="font-medium">Photos &amp; resources</div>
              {attached.map((r) => (
                <div key={r.id} className="text-primary underline">
                  {r.label}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <Input
            placeholder="Subject — {merge} tokens work here too"
            value={draft.subject}
            onChange={(e) => patch({ subject: e.target.value })}
            className="h-8 text-sm"
          />
          <Textarea
            placeholder="Email body…"
            value={draft.body}
            onChange={(e) => patch({ body: e.target.value })}
            className="min-h-32 text-sm"
          />
        </div>
      )}

      {dirty && (
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={async () => {
              const ok = await onSave(draft);
              if (ok) setDirty(false);
            }}
          >
            <Save className="size-3.5" /> Save step
          </Button>
        </div>
      )}
    </div>
  );
}

export function FunnelsEditor({ entityId }: { entityId: string }) {
  const fn = useFunnels(entityId);
  const { resources, folders } = useResources(entityId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [metaDirty, setMetaDirty] = useState(false);

  const visible = showArchived ? fn.allFunnels : fn.funnels;
  const selected: Funnel | undefined =
    fn.allFunnels.find((f) => f.id === selectedId) ?? visible[0];

  // Keep the meta draft in sync with the selection.
  const selectedKey = selected?.id ?? null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (selectedKey !== lastKey) {
    setLastKey(selectedKey);
    setNameDraft(selected?.name ?? "");
    setDescDraft(selected?.description ?? "");
    setMetaDirty(false);
  }

  const steps = selected ? fn.stepsFor(selected.id) : [];
  const activeCount = (funnelId: string) =>
    fn.enrollments.filter((e) => e.funnel_id === funnelId && e.status === "active").length;

  const addFunnel = async () => {
    const id = await fn.saveFunnel({ name: "New funnel", description: null });
    if (id) setSelectedId(id);
  };

  const addStep = async () => {
    if (!selected) return;
    const last = steps[steps.length - 1];
    await fn.saveStep({
      funnel_id: selected.id,
      day_offset: last ? last.day_offset + 2 : 0,
      subject: "",
      body: "",
      sort_order: steps.length,
    });
  };

  if (fn.loading) {
    return <div className="text-sm text-muted-foreground">Loading funnels…</div>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      {/* Funnel list */}
      <div className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <h3 className="text-sm font-semibold">All funnels</h3>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-7 gap-1 text-xs"
            onClick={addFunnel}
          >
            <Plus className="size-3.5" /> New
          </Button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-2">
          {visible.map((f) => {
            const live = activeCount(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedId(f.id)}
                className={`mb-1 flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                  selected?.id === f.id ? "bg-muted font-medium" : "hover:bg-muted/60"
                }`}
              >
                <Zap className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {f.name}
                    {f.archived && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground">(archived)</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {fn.stepsFor(f.id).length} step{fn.stepsFor(f.id).length === 1 ? "" : "s"}
                    {live > 0 ? ` · ${live} running` : ""}
                  </span>
                </span>
              </button>
            );
          })}
          {visible.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              No funnels yet — create one to start automating follow-ups.
            </p>
          )}
          {fn.allFunnels.some((f) => f.archived) && (
            <button
              type="button"
              className="mt-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowArchived((v) => !v)}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
          )}
        </div>
      </div>

      {/* Selected funnel */}
      {selected ? (
        <div className="space-y-3">
          <div className="rounded-lg border bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={nameDraft}
                onChange={(e) => {
                  setNameDraft(e.target.value);
                  setMetaDirty(true);
                }}
                className="h-8 max-w-xs text-sm font-medium"
              />
              <div className="ml-auto flex items-center gap-1">
                {metaDirty && (
                  <Button
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={async () => {
                      await fn.saveFunnel({
                        id: selected.id,
                        name: nameDraft.trim() || selected.name,
                        description: descDraft.trim() || null,
                      });
                      setMetaDirty(false);
                    }}
                  >
                    <Save className="size-3.5" /> Save
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() =>
                    fn.saveFunnel({
                      id: selected.id,
                      name: selected.name,
                      archived: !selected.archived,
                    })
                  }
                >
                  {selected.archived ? (
                    <>
                      <ArchiveRestore className="size-3.5" /> Restore
                    </>
                  ) : (
                    <>
                      <Archive className="size-3.5" /> Archive
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (activeCount(selected.id) > 0) {
                      alert(
                        "This funnel has inquiries actively running on it. Stop them first, or archive the funnel instead."
                      );
                      return;
                    }
                    if (confirm(`Delete "${selected.name}" and all its steps?`)) {
                      fn.deleteFunnel(selected.id);
                      setSelectedId(null);
                    }
                  }}
                >
                  <Trash2 className="size-3.5" /> Delete
                </Button>
              </div>
            </div>
            <Textarea
              placeholder="When to use this funnel (shown in the Start funnel picker)…"
              value={descDraft}
              onChange={(e) => {
                setDescDraft(e.target.value);
                setMetaDirty(true);
              }}
              className="mt-2 min-h-16 text-sm"
            />
          </div>

          {steps.map((s) => (
            <StepCard
              key={s.id}
              step={s}
              resources={resources}
              folders={folders}
              onSave={(d) =>
                fn.saveStep({
                  id: s.id,
                  funnel_id: s.funnel_id,
                  day_offset: Math.max(0, Number(d.day_offset) || 0),
                  subject: d.subject,
                  body: d.body,
                  resource_ids: d.resource_ids,
                })
              }
              onDelete={() => {
                if (confirm("Delete this step?")) fn.deleteStep(s.id);
              }}
            />
          ))}

          <Button variant="outline" size="sm" className="gap-1.5" onClick={addStep}>
            <Plus className="size-3.5" /> Add step
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          Select a funnel on the left, or create one.
        </div>
      )}
    </div>
  );
}
