"use client";

// Slide-in card detail for the Cold outreach board. A deliberately smaller
// cousin of InquiryDrawer: stage bar with the cold stages, a Mark-dead picker
// that requires a reason, the vendor/contact fields, tasks, and the shared
// email + activity timeline. No quotes, no funnels, no templates — cold cards
// are emailed by hand from Gmail (CC sales@) and the thread lands here.

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { XCircle, RotateCcw, Send, ExternalLink } from "lucide-react";
import { InquiryAvatar, hexA } from "@/components/inquiries/atoms";
import {
  ActivityChip,
  EmailBubble,
  TasksBlock,
  type DrawerCallbacks,
} from "@/components/inquiries/detail-drawer";
import {
  type Inquiry,
  type InquiryActivity,
  type InquiryMessage,
  type InquiryStatus,
  COLD_STAGES,
  DEAD_STAGE,
  DEAD_REASONS,
  COLD_VERTICALS,
  COLD_SOURCES,
  COLD_SEQUENCES,
  genuineMessages,
  messageDate,
  toISODate,
} from "@/lib/inquiries/shared";

export interface ColdDrawerCallbacks {
  onMove: (id: string, status: InquiryStatus) => void;
  onSaveDetails: (id: string, patch: Record<string, unknown>, msg?: string) => Promise<void>;
  onAddTask: DrawerCallbacks["onAddTask"];
  onToggleTask: DrawerCallbacks["onToggleTask"];
  onAddActivity: DrawerCallbacks["onAddActivity"];
  onDeleteActivity: DrawerCallbacks["onDeleteActivity"];
  onDelete?: (id: string) => void;
}

// Subject line Joe sends by hand; logging "Email N" records it on the timeline
// and advances the card. Nothing is sent from here.
export const COLD_EMAIL_SUBJECT = "Production-Grade Restroom Trailers For Your Activations";

function ColdStageBar({
  inquiry,
  onMove,
  onMarkDead,
}: {
  inquiry: Inquiry;
  onMove: ColdDrawerCallbacks["onMove"];
  onMarkDead: (id: string, reason: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");

  if (inquiry.status === DEAD_STAGE.key) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2">
        <XCircle className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium text-muted-foreground">
          Dead{inquiry.lost_reason ? ` — ${inquiry.lost_reason}` : ""}
        </span>
        <Button variant="outline" size="sm" onClick={() => onMove(inquiry.id, COLD_STAGES[0].key)}>
          <RotateCcw className="size-4" /> Reopen
        </Button>
      </div>
    );
  }

  const idx = COLD_STAGES.findIndex((s) => s.key === inquiry.status);
  const finalReason = reason === "__other" ? other.trim() : reason;
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {COLD_STAGES.map((s, i) => {
          const done = idx >= 0 && i < idx;
          const cur = i === idx;
          return (
            <button
              key={s.key}
              title={`Move to ${s.label}`}
              onClick={() => onMove(inquiry.id, s.key)}
              className={`flex-1 rounded px-1 py-1.5 text-[10px] font-semibold leading-tight transition-colors ${
                cur
                  ? "text-white"
                  : done
                    ? "text-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
              style={
                cur
                  ? { background: s.color }
                  : done
                    ? { background: hexA(s.color, 0.14), color: s.color }
                    : undefined
              }
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {picking ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Why is it dead?</option>
            {DEAD_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value="__other">Other…</option>
          </select>
          {reason === "__other" && (
            <input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="Reason…"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={!finalReason}
              onClick={() => {
                if (!finalReason) return;
                onMarkDead(inquiry.id, finalReason);
                setPicking(false);
                setReason("");
                setOther("");
              }}
            >
              <XCircle className="size-3.5" /> Mark dead
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPicking(false);
                setReason("");
                setOther("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
        >
          <XCircle className="size-3.5" /> Mark dead…
        </button>
      )}
    </div>
  );
}

type FieldKey =
  | "company"
  | "name"
  | "contact_title"
  | "email"
  | "phone"
  | "website"
  | "vertical"
  | "outreach_source"
  | "sequence"
  | "last_touch_at"
  | "next_follow_up"
  | "notes";

function fieldsOf(inq: Inquiry): Record<FieldKey, string> {
  return {
    company: inq.company ?? "",
    name: inq.name ?? "",
    contact_title: inq.contact_title ?? "",
    email: inq.email ?? "",
    phone: inq.phone ?? "",
    website: inq.website ?? "",
    vertical: inq.vertical ?? "",
    outreach_source: inq.outreach_source ?? "",
    sequence: inq.sequence ?? "",
    last_touch_at: inq.last_touch_at ?? "",
    next_follow_up: inq.next_follow_up ?? "",
    notes: inq.notes ?? "",
  };
}

function ColdFields({
  inquiry,
  onSaveDetails,
}: {
  inquiry: Inquiry;
  onSaveDetails: ColdDrawerCallbacks["onSaveDetails"];
}) {
  const [form, setForm] = useState<Record<FieldKey, string>>(() => fieldsOf(inquiry));
  const [saving, setSaving] = useState(false);
  const set = (k: FieldKey, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const original = fieldsOf(inquiry);
  const changed = (Object.keys(form) as FieldKey[]).filter((k) => form[k] !== original[k]);
  const missingRequired = !form.company.trim() || !form.email.trim() || !form.vertical;

  const save = async () => {
    if (changed.length === 0 || missingRequired) return;
    setSaving(true);
    const patch: Record<string, unknown> = {};
    for (const k of changed) patch[k] = form[k].trim() === "" ? null : form[k].trim();
    if ("email" in patch && patch.email) patch.email = String(patch.email).toLowerCase();
    try {
      await onSaveDetails(inquiry.id, patch, "Card saved");
    } finally {
      setSaving(false);
    }
  };

  const text = (k: FieldKey, label: string, type = "text", required = false) => (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <Input
        type={type}
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
        className="h-8 text-sm"
      />
    </label>
  );
  const select = (k: FieldKey, label: string, options: readonly string[], required = false) => (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <select
        value={form[k]}
        onChange={(e) => set(k, e.target.value)}
        className="h-8 w-full rounded-md border bg-background px-2 text-sm"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {text("company", "Company", "text", true)}
        {select("vertical", "Vertical", COLD_VERTICALS, true)}
        {text("email", "Email", "email", true)}
        {text("phone", "Phone", "tel")}
        {text("name", "Contact name")}
        {text("contact_title", "Title")}
        {text("website", "Website", "url")}
        {select("outreach_source", "Source", COLD_SOURCES)}
        {select("sequence", "Sequence", COLD_SEQUENCES)}
        {text("last_touch_at", "Last touch", "date")}
        {text("next_follow_up", "Next follow-up", "date")}
      </div>
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-muted-foreground">Notes</span>
        <Textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          rows={3}
          placeholder="Pitch angle, caveats (e.g. events only, they also do filming)"
          className="text-sm"
        />
      </label>
      {changed.length > 0 && (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save} disabled={saving || missingRequired}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setForm(fieldsOf(inquiry))}>
            Discard
          </Button>
          {missingRequired && (
            <span className="text-xs text-destructive">Company, email, and vertical are required.</span>
          )}
        </div>
      )}
    </div>
  );
}

type TimelineEntry =
  | { kind: "activity"; id: string; date: string; activity: InquiryActivity }
  | { kind: "email"; id: string; date: string; message: InquiryMessage };

function ColdTimeline({
  inquiry,
  onAddActivity,
  onDeleteActivity,
}: {
  inquiry: Inquiry;
  onAddActivity: ColdDrawerCallbacks["onAddActivity"];
  onDeleteActivity: ColdDrawerCallbacks["onDeleteActivity"];
}) {
  const [type, setType] = useState<InquiryActivity["type"]>("note");
  const [text, setText] = useState("");
  const entries: TimelineEntry[] = [
    ...genuineMessages(inquiry.messages || []).map(
      (m): TimelineEntry => ({ kind: "email", id: `m-${m.id}`, date: messageDate(m), message: m })
    ),
    ...(inquiry.activity || []).map(
      (a): TimelineEntry => ({ kind: "activity", id: `a-${a.id}`, date: a.occurred_at, activity: a })
    ),
  ].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const submit = () => {
    if (!text.trim()) return;
    onAddActivity(inquiry.id, type, text.trim());
    setText("");
  };
  const tabs: [InquiryActivity["type"], string][] = [
    ["call", "Log call"],
    ["email", "Log email"],
    ["note", "Note"],
  ];
  return (
    <div>
      <div className="flex items-center gap-1">
        {tabs.map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setType(k)}
            className={`rounded px-2.5 py-1 text-xs font-medium ${
              type === k
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          placeholder={`Add a ${type}…`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="h-9"
        />
        <Button size="sm" className="h-9" onClick={submit}>
          Log
        </Button>
      </div>
      <div className="mt-4 space-y-3">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No messages yet. Send from Gmail with sales@hdrsiteservices.com on CC and the thread
            shows up here.
          </p>
        )}
        {entries.map((e) =>
          e.kind === "email" ? (
            <EmailBubble
              key={e.id}
              message={e.message}
              customerEmail={inquiry.email}
              customerName={inquiry.name || inquiry.company || null}
            />
          ) : (
            <ActivityChip key={e.id} activity={e.activity} onDelete={onDeleteActivity} />
          )
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b py-4 last:border-b-0">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

export function ColdDrawer({
  inquiry,
  onClose,
  callbacks,
}: {
  inquiry: Inquiry | null;
  onClose: () => void;
  callbacks: ColdDrawerCallbacks;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // One click after Joe has sent Email 1/2 by hand: log it, stamp Last touch,
  // set the sequence, and advance a Not-contacted card. Never sends anything.
  const logEmail = async (n: 1 | 2) => {
    if (!inquiry) return;
    const today = toISODate(new Date());
    callbacks.onAddActivity(inquiry.id, "email", `Email ${n} sent — “${COLD_EMAIL_SUBJECT}”.`);
    const patch: Record<string, unknown> = { last_touch_at: today, sequence: `Email ${n}` };
    if (n === 1 && inquiry.status === "not_contacted") patch.status = "email1";
    await callbacks.onSaveDetails(inquiry.id, patch, `Email ${n} logged`);
  };

  return (
    <Sheet
      open={!!inquiry}
      onOpenChange={(o) => {
        if (!o) {
          setConfirmingDelete(false);
          onClose();
        }
      }}
    >
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
        {inquiry && (
          <>
            <SheetHeader className="flex-row items-center gap-3 border-b px-5 py-4">
              <InquiryAvatar name={inquiry.company || inquiry.name} size={42} />
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base">
                  {inquiry.company || "Cold outreach card"}
                </SheetTitle>
                <div className="text-xs text-muted-foreground">
                  {inquiry.vertical ? `${inquiry.vertical} · ` : ""}
                  <span className="font-mono">{inquiry.reference}</span>
                </div>
              </div>
            </SheetHeader>

            <div className="px-5">
              <Section title="Stage">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => logEmail(1)}>
                    <Send className="size-3.5" /> Log Email 1
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => logEmail(2)}>
                    <Send className="size-3.5" /> Log Email 2
                  </Button>
                  {inquiry.email && (
                    <a
                      href={`mailto:${inquiry.email}?cc=sales@hdrsiteservices.com&subject=${encodeURIComponent(COLD_EMAIL_SUBJECT)}`}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="size-3.5" /> Compose in mail client
                    </a>
                  )}
                </div>
                <ColdStageBar
                  inquiry={inquiry}
                  onMove={callbacks.onMove}
                  onMarkDead={(id, lost_reason) =>
                    callbacks.onSaveDetails(id, { status: DEAD_STAGE.key, lost_reason }, "Marked dead")
                  }
                />
              </Section>

              <Section title="Company & contact">
                <ColdFields key={inquiry.id} inquiry={inquiry} onSaveDetails={callbacks.onSaveDetails} />
              </Section>

              <Section title="Tasks & reminders">
                <TasksBlock
                  inquiry={inquiry}
                  onAddTask={callbacks.onAddTask}
                  onToggleTask={callbacks.onToggleTask}
                />
              </Section>

              <Section title="Activity & emails">
                <ColdTimeline
                  inquiry={inquiry}
                  onAddActivity={callbacks.onAddActivity}
                  onDeleteActivity={callbacks.onDeleteActivity}
                />
              </Section>

              {callbacks.onDelete && (
                <div className="py-4">
                  {confirmingDelete ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Delete this card permanently?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => callbacks.onDelete!(inquiry.id)}
                      >
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(true)}
                      className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                    >
                      Delete this card
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
