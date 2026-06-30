"use client";

// Inquiries → Templates: manage the follow-up emails reps send. Edit any
// default, add custom templates, hide ones you don't use, and visualize each
// email exactly as the customer will see it, with the merge fields (including
// {details} — everything they submitted) filled from a sample lead. Edits
// persist per entity and immediately drive the deal-drawer template picker.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Mail,
  Plus,
  Save,
  RotateCcw,
  Trash2,
  EyeOff,
  Eye,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTemplates, type TemplateInput } from "@/lib/inquiries/use-templates";
import {
  type EffectiveTemplate,
  type MessageTemplate,
  type TemplateChannel,
  type TemplateTrack,
  DEFAULT_TEMPLATES,
  TRACK_LABEL,
  TEMPLATE_TRACKS,
  MERGE_FIELDS,
  renderTemplate,
} from "@/lib/inquiries/templates";
import {
  type Inquiry,
  STAGES,
  LOST_STAGE,
  STATUS_LABELS,
} from "@/lib/inquiries/shared";

const ALL_STAGES = [...STAGES, LOST_STAGE];

// A representative lead so the preview shows realistic, filled-in copy.
const SAMPLE_INQUIRY: Inquiry = {
  id: "sample",
  reference: "HDR-7F3K2",
  status: "new",
  name: "Jordan Avery",
  email: "jordan.avery@example.com",
  phone: "(818) 555-0142",
  use_case: "Film shoot",
  start_date: "2026-07-04",
  end_date: "2026-07-07",
  duration: "3 days",
  units: 2,
  attendant: "Yes",
  guests: "60",
  location: "Griffith Park, Los Angeles",
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
  source: "Google Ads",
  unit_id: null,
  estimated_value: 4200,
  gclid: null,
  last_activity_at: null,
  created_at: "2026-06-01T17:00:00.000Z",
};

interface Draft {
  template_key: string;
  label: string;
  channel: TemplateChannel;
  track: TemplateTrack;
  stages: string[];
  cadence: string;
  subject: string;
  body: string;
  source: "default" | "custom";
  overridden: boolean;
}

function toDraft(
  t: MessageTemplate,
  source: "default" | "custom",
  overridden: boolean
): Draft {
  return {
    template_key: t.id,
    label: t.label,
    channel: t.channel,
    track: t.track,
    stages: [...t.stages],
    cadence: t.cadence ?? "",
    subject: t.subject ?? "",
    body: t.body,
    source,
    overridden,
  };
}

export default function TemplatesPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const tpl = useTemplates(entityId);

  const [rep, setRep] = useState("You");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // Grab the rep's display name so the preview's {rep} reads naturally.
  useEffect(() => {
    (async () => {
      const { data } = await createClient().auth.getUser();
      const user = data.user;
      if (!user) return;
      const meta = user.user_metadata as Record<string, unknown> | undefined;
      const name =
        (typeof meta?.full_name === "string" && meta.full_name) ||
        (typeof meta?.name === "string" && meta.name) ||
        (user.email ? user.email.split("@")[0] : "You");
      setRep(name as string);
    })();
  }, []);

  const select = (t: EffectiveTemplate) => {
    setSelectedKey(t.id);
    setDraft(toDraft(t, t.source, t.overridden));
  };

  // Auto-select the first template once the list is loaded.
  useEffect(() => {
    if (selectedKey || tpl.loading) return;
    const first = tpl.allTemplates.find((t) => !t.archived);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialize the selection once the list loads
    if (first) select(first);
  }, [tpl.loading, tpl.allTemplates, selectedKey]);

  const grouped = useMemo(() => {
    const list = tpl.allTemplates.filter((t) => showHidden || !t.archived);
    return TEMPLATE_TRACKS.map((track) => ({
      track,
      items: list.filter((t) => t.track === track),
    })).filter((g) => g.items.length > 0);
  }, [tpl.allTemplates, showHidden]);

  const hiddenCount = tpl.allTemplates.filter((t) => t.archived).length;

  const insertToken = (token: string) => {
    if (!draft) return;
    const ins = `{${token}}`;
    const ta = bodyRef.current;
    if (!ta) {
      setDraft({ ...draft, body: draft.body + ins });
      return;
    }
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const next = draft.body.slice(0, s) + ins + draft.body.slice(e);
    setDraft({ ...draft, body: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + ins.length;
    });
  };

  const toggleStage = (key: string) => {
    if (!draft) return;
    const has = draft.stages.includes(key);
    setDraft({
      ...draft,
      stages: has
        ? draft.stages.filter((s) => s !== key)
        : [...draft.stages, key],
    });
  };

  const startNew = () => {
    const key = tpl.newCustomKey();
    const d: Draft = {
      template_key: key,
      label: "New template",
      channel: "email",
      track: "general",
      stages: ["new"],
      cadence: "",
      subject: "",
      body: "",
      source: "custom",
      overridden: false,
    };
    setSelectedKey(key);
    setDraft(d);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.label.trim() || !draft.body.trim()) return;
    const input: TemplateInput = {
      template_key: draft.template_key,
      label: draft.label.trim(),
      channel: draft.channel,
      track: draft.track,
      stages: draft.stages,
      cadence: draft.cadence.trim() || null,
      subject: draft.channel === "email" ? draft.subject.trim() || null : null,
      body: draft.body,
    };
    const ok = await tpl.save(input);
    if (ok) setDraft({ ...draft, source: draft.source, overridden: true });
  };

  const revert = async () => {
    if (!draft) return;
    await tpl.remove(draft.template_key);
    const def = DEFAULT_TEMPLATES.find((d) => d.id === draft.template_key);
    if (def) setDraft(toDraft(def, "default", false));
  };

  const removeCustom = async () => {
    if (!draft) return;
    await tpl.remove(draft.template_key);
    setSelectedKey(null);
    setDraft(null);
  };

  const draftAsTemplate: MessageTemplate | null = draft
    ? {
        id: draft.template_key,
        label: draft.label,
        channel: draft.channel,
        track: draft.track,
        stages: draft.stages as MessageTemplate["stages"],
        cadence: draft.cadence,
        subject: draft.subject,
        body: draft.body,
      }
    : null;

  const preview = draftAsTemplate
    ? renderTemplate(draftAsTemplate, SAMPLE_INQUIRY, rep)
    : { subject: undefined, body: "" };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Follow-up templates</h1>
        <p className="text-sm text-muted-foreground">
          Edit the copy your team sends and preview each message before it goes out.
        </p>
      </div>
      <SectionTabs entityId={entityId} />

      {tpl.loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* Template list */}
          <div className="rounded-lg border bg-card shadow-sm">
            <div className="flex items-center gap-2 border-b px-3 py-2.5">
              <h3 className="text-sm font-semibold">All templates</h3>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 gap-1 text-xs"
                onClick={startNew}
              >
                <Plus className="size-3.5" /> New
              </Button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-2">
              {grouped.map((g) => (
                <div key={g.track} className="mb-2">
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {TRACK_LABEL[g.track]}
                  </div>
                  {g.items.map((t) => {
                    const active = t.id === selectedKey;
                    return (
                      <button
                        key={t.id}
                        onClick={() => select(t)}
                        className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                          active ? "bg-muted" : "hover:bg-muted/50"
                        } ${t.archived ? "opacity-50" : ""}`}
                      >
                        <Mail className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {t.label}
                          </span>
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {t.stages.map((s) => (
                              <span
                                key={s}
                                className="rounded bg-muted px-1 py-px text-[9px] font-medium uppercase text-muted-foreground"
                              >
                                {STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s}
                              </span>
                            ))}
                          </span>
                        </span>
                        {t.source === "custom" && (
                          <span className="rounded bg-violet-100 px-1 py-px text-[9px] font-semibold text-violet-700">
                            custom
                          </span>
                        )}
                        {t.overridden && !t.archived && (
                          <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-semibold text-amber-700">
                            edited
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowHidden((v) => !v)}
                  className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/50"
                >
                  {showHidden ? "Hide" : "Show"} {hiddenCount} hidden
                </button>
              )}
            </div>
          </div>

          {/* Editor + preview */}
          {draft ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {/* Editor */}
              <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
                <Labeled label="Track">
                  <Select
                    value={draft.track}
                    onValueChange={(v) =>
                      setDraft({ ...draft, track: v as TemplateTrack })
                    }
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_TRACKS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TRACK_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Labeled>

                <Labeled label="Name">
                  <Input
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    className="h-9"
                  />
                </Labeled>

                <Labeled label="When to send (cadence hint)">
                  <Input
                    value={draft.cadence}
                    onChange={(e) => setDraft({ ...draft, cadence: e.target.value })}
                    placeholder="e.g. Within 5 min of the inquiry"
                    className="h-9"
                  />
                </Labeled>

                <Labeled label="Applies to stages">
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_STAGES.map((s) => {
                      const on = draft.stages.includes(s.key);
                      return (
                        <button
                          key={s.key}
                          onClick={() => toggleStage(s.key)}
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                            on
                              ? "border-transparent text-white"
                              : "border-input text-muted-foreground hover:bg-muted"
                          }`}
                          style={on ? { background: s.color } : undefined}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </Labeled>

                <Labeled label="Subject">
                  <Input
                    value={draft.subject}
                    onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                    placeholder="Email subject line…"
                    className="h-9"
                  />
                </Labeled>

                <Labeled label="Message">
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {MERGE_FIELDS.map((f) => (
                      <button
                        key={f.token}
                        onClick={() => insertToken(f.token)}
                        title={f.label}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted/70"
                      >
                        {"{" + f.token + "}"}
                      </button>
                    ))}
                  </div>
                  <Textarea
                    ref={bodyRef}
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    rows={10}
                    placeholder="Write your email… use the {tokens} above to merge in lead details."
                    className="font-sans text-sm"
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    <span className="font-mono">{"{details}"}</span> drops in
                    everything the customer submitted.{" "}
                    <span className="font-mono">{"{quote}"}</span> turns this email
                    into a quote — you price it with the builder when sending from a
                    deal.
                  </p>
                </Labeled>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" onClick={save} className="gap-1.5">
                    <Save className="size-4" /> Save
                  </Button>
                  {draft.source === "custom" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={removeCustom}
                      className="gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-4" /> Delete
                    </Button>
                  ) : (
                    draft.overridden && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={revert}
                        className="gap-1.5"
                      >
                        <RotateCcw className="size-4" /> Revert to default
                      </Button>
                    )
                  )}
                  {selectedKey && (
                    <HideButton
                      archived={
                        tpl.allTemplates.find((t) => t.id === selectedKey)?.archived ??
                        false
                      }
                      onToggle={(a) => tpl.setArchived(selectedKey, a)}
                    />
                  )}
                </div>
              </div>

              {/* Live preview */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="size-3.5" /> Preview — sample lead{" "}
                  <span className="font-semibold text-foreground/70">
                    {SAMPLE_INQUIRY.name}
                  </span>
                </div>
                <Preview subject={preview.subject} body={preview.body} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-lg border bg-card p-12 text-sm text-muted-foreground shadow-sm">
              Select a template to edit, or create a new one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function HideButton({
  archived,
  onToggle,
}: {
  archived: boolean;
  onToggle: (archived: boolean) => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => onToggle(!archived)}
      className="ml-auto gap-1.5 text-muted-foreground"
    >
      {archived ? (
        <>
          <Eye className="size-4" /> Restore
        </>
      ) : (
        <>
          <EyeOff className="size-4" /> Hide
        </>
      )}
    </Button>
  );
}

// Visualizes the rendered email the way the customer receives it.
function Preview({ subject, body }: { subject?: string; body: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="space-y-1 border-b bg-muted/30 px-4 py-3 text-xs">
        <div className="flex gap-2">
          <span className="w-12 shrink-0 text-muted-foreground">From</span>
          <span className="font-medium text-foreground">
            Hollywood Depot Rentals &lt;sales@hdrsiteservices.com&gt;
          </span>
        </div>
        <div className="flex gap-2">
          <span className="w-12 shrink-0 text-muted-foreground">To</span>
          <span className="text-foreground">
            {SAMPLE_INQUIRY.name} &lt;{SAMPLE_INQUIRY.email}&gt;
          </span>
        </div>
        <div className="flex gap-2">
          <span className="w-12 shrink-0 text-muted-foreground">Subject</span>
          <span className="font-semibold text-foreground">
            {subject || <span className="italic text-muted-foreground">No subject</span>}
          </span>
        </div>
      </div>
      <div className="whitespace-pre-wrap break-words px-4 py-4 text-sm leading-relaxed text-foreground/90">
        {body || (
          <span className="italic text-muted-foreground">Nothing to preview yet.</span>
        )}
      </div>
    </div>
  );
}
