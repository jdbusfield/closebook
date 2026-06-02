"use client";

// Slide-in deal detail drawer for the HDR Sales CRM — ports the design's
// detail.jsx: quick actions, stage progress bar, event/contact grid, fleet-unit
// assignment, follow-up tasks, and the activity timeline. The sub-blocks are
// exported so the full-page detail view can reuse them.

import { useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Phone,
  Mail,
  FileText,
  Plus,
  Check,
  ExternalLink,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import {
  InquiryAvatar,
  DueBadge,
  ActivityIcon,
  hexA,
} from "@/components/inquiries/atoms";
import {
  type Inquiry,
  type InquiryStatus,
  type InquiryTask,
  type InquiryActivity,
  type InquiryMessage,
  STAGES,
  FLEET,
  FLEET_BY_ID,
  fmtMoney,
  fmtDate,
  fmtRange,
  relDays,
  isBookedStatus,
  visibleThreadMessages,
  messageSnippet,
  messageDate,
} from "@/lib/inquiries/shared";

export interface DrawerCallbacks {
  onMove: (id: string, status: InquiryStatus) => void;
  onAssignUnit: (id: string, unitId: string | null) => void;
  onSetValue: (id: string, value: number | null) => void;
  onAddTask: (id: string, title: string, kind?: InquiryTask["kind"]) => void;
  onToggleTask: (taskId: string, done: boolean) => void;
  onAddActivity: (id: string, type: InquiryActivity["type"], body: string) => void;
}

// --- Stage progress bar ----------------------------------------------------
export function StageBar({
  inquiry,
  onMove,
}: {
  inquiry: Inquiry;
  onMove: DrawerCallbacks["onMove"];
}) {
  const idx = STAGES.findIndex((s) => s.key === inquiry.status);
  return (
    <div className="flex gap-1">
      {STAGES.map((s, i) => {
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
  );
}

// --- Quick action buttons --------------------------------------------------
export function QuickActions({
  inquiry,
  onAddActivity,
}: {
  inquiry: Inquiry;
  onAddActivity: DrawerCallbacks["onAddActivity"];
}) {
  const tel = inquiry.phone ? inquiry.phone.replace(/[^\d+]/g, "") : "";
  return (
    <div className="flex gap-2">
      <Button
        asChild
        variant="outline"
        size="sm"
        className="flex-1"
        disabled={!tel}
      >
        <a href={tel ? `tel:${tel}` : undefined}>
          <Phone className="size-4" /> Call
        </a>
      </Button>
      <Button
        asChild
        variant="outline"
        size="sm"
        className="flex-1"
        disabled={!inquiry.email}
      >
        <a href={inquiry.email ? `mailto:${inquiry.email}` : undefined}>
          <Mail className="size-4" /> Email
        </a>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="flex-1"
        onClick={() =>
          onAddActivity(
            inquiry.id,
            "quote",
            `Sent written quote — ${fmtMoney(inquiry.estimated_value)}.`
          )
        }
      >
        <FileText className="size-4" /> Quote
      </Button>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className={`text-sm ${mono ? "font-mono" : ""}`}>{v || "—"}</span>
    </>
  );
}

// --- Event & contact + editable value -------------------------------------
export function ContactGrid({
  inquiry,
  onSetValue,
}: {
  inquiry: Inquiry;
  onSetValue: DrawerCallbacks["onSetValue"];
}) {
  const [editingValue, setEditingValue] = useState(false);
  const [valueDraft, setValueDraft] = useState(
    inquiry.estimated_value != null ? String(inquiry.estimated_value) : ""
  );
  const booked = isBookedStatus(inquiry.status);
  const dates = fmtRange(inquiry.start_date, inquiry.end_date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
      <KV k="Event type" v={inquiry.use_case} />
      <KV k="Dates" v={dates} mono />
      <KV k="Duration" v={inquiry.duration} />
      <KV k="Location" v={inquiry.location} />
      <KV
        k="Units"
        v={inquiry.units != null ? `${inquiry.units} (${inquiry.units * 4} stalls)` : null}
      />
      <KV k="Guests" v={inquiry.guests} />
      <KV k="Attendant" v={inquiry.attendant} />
      <KV k="Phone" v={inquiry.phone} mono />
      <KV k="Email" v={inquiry.email} />
      <KV k="Source" v={inquiry.source} />

      <span className="text-xs text-muted-foreground">Est. value</span>
      <span className="text-sm">
        {editingValue ? (
          <span className="flex items-center gap-1.5">
            <Input
              autoFocus
              type="number"
              value={valueDraft}
              onChange={(e) => setValueDraft(e.target.value)}
              className="h-7 w-28"
            />
            <Button
              size="sm"
              className="h-7"
              onClick={() => {
                onSetValue(
                  inquiry.id,
                  valueDraft.trim() === "" ? null : Number(valueDraft)
                );
                setEditingValue(false);
              }}
            >
              Save
            </Button>
          </span>
        ) : (
          <button
            className="font-mono font-semibold hover:underline"
            onClick={() => setEditingValue(true)}
          >
            {inquiry.estimated_value != null
              ? fmtMoney(inquiry.estimated_value)
              : "Set value"}
          </button>
        )}
      </span>

      {booked && (
        <>
          <KV k="RW quote" v={inquiry.rw_quote_number} mono />
          <KV k="RW order" v={inquiry.rw_order_number} mono />
        </>
      )}
    </div>
  );
}

// --- Fleet-unit assignment -------------------------------------------------
export function UnitAssign({
  inquiry,
  onAssignUnit,
}: {
  inquiry: Inquiry;
  onAssignUnit: DrawerCallbacks["onAssignUnit"];
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onAssignUnit(inquiry.id, null)}
          className="rounded-full border bg-background px-2.5 py-1 text-xs"
          style={
            !inquiry.unit_id
              ? { borderColor: "#2845F0", borderWidth: 1.5 }
              : undefined
          }
        >
          None
        </button>
        {FLEET.map((u) => {
          const active = inquiry.unit_id === u.id;
          return (
            <button
              key={u.id}
              onClick={() => onAssignUnit(inquiry.id, u.id)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs font-semibold"
              style={{
                background: active ? hexA(u.color, 0.1) : "#fff",
                color: active ? u.color : "var(--muted-foreground)",
                borderColor: active ? u.color : "var(--border)",
                borderWidth: active ? 1.5 : 1,
              }}
            >
              <span className="size-1.5 rounded-full" style={{ background: u.color }} />
              {u.name}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {inquiry.unit_id && FLEET_BY_ID[inquiry.unit_id]
          ? `${FLEET_BY_ID[inquiry.unit_id].config} · ${FLEET_BY_ID[inquiry.unit_id].note}`
          : "Assign a unit to place this rental on the calendar."}
      </p>
    </div>
  );
}

// --- Tasks & reminders -----------------------------------------------------
export function TasksBlock({
  inquiry,
  onAddTask,
  onToggleTask,
}: {
  inquiry: Inquiry;
  onAddTask: DrawerCallbacks["onAddTask"];
  onToggleTask: DrawerCallbacks["onToggleTask"];
}) {
  const [title, setTitle] = useState("");
  const tasks = [...(inquiry.tasks || [])].sort(
    (a, b) =>
      Number(a.done) - Number(b.done) ||
      (a.due_date || "").localeCompare(b.due_date || "")
  );
  const submit = () => {
    if (!title.trim()) return;
    onAddTask(inquiry.id, title.trim());
    setTitle("");
  };
  return (
    <div className="space-y-2">
      {tasks.map((t) => (
        <div key={t.id} className="flex items-center gap-2.5">
          <button
            onClick={() => onToggleTask(t.id, !t.done)}
            className={`flex size-[18px] shrink-0 items-center justify-center rounded border ${
              t.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/40"
            }`}
          >
            {t.done && <Check className="size-3" />}
          </button>
          <span
            className={`flex-1 text-sm ${
              t.done ? "text-muted-foreground line-through" : "font-medium"
            }`}
          >
            {t.title}
          </span>
          {!t.done && <DueBadge due={t.due_date} />}
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Input
          placeholder="Add a reminder / task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="h-9"
        />
        <Button variant="outline" size="sm" className="h-9" onClick={submit}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </div>
  );
}

// --- Activity timeline -----------------------------------------------------
const LOG_TABS: [InquiryActivity["type"], string][] = [
  ["call", "Log call"],
  ["email", "Log email"],
  ["note", "Note"],
  ["quote", "Quote"],
];

// A unified timeline entry — either a logged activity or a summarized email.
type TimelineEntry =
  | { kind: "activity"; id: string; date: string; activity: InquiryActivity }
  | { kind: "email"; id: string; date: string; message: InquiryMessage };

function EmailEntry({ message }: { message: InquiryMessage }) {
  const outbound = message.direction === "outbound";
  const snippet = messageSnippet(message);
  const who = outbound
    ? message.to_addrs?.length
      ? `To ${message.to_addrs.join(", ")}`
      : "Sent"
    : message.from_addr
      ? `From ${message.from_addr}`
      : "Received";
  return (
    <div className="flex gap-2.5">
      <ActivityIcon type="email" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          {outbound ? (
            <ArrowUpRight className="size-3.5 shrink-0 text-blue-600" />
          ) : (
            <ArrowDownLeft className="size-3.5 shrink-0 text-emerald-600" />
          )}
          <span className="font-semibold">
            {outbound ? "Email sent" : "Email received"}
          </span>
          {message.subject && (
            <span className="truncate text-muted-foreground">— {message.subject}</span>
          )}
        </div>
        {snippet && (
          <div className="mt-0.5 line-clamp-3 rounded bg-muted/50 px-2 py-1 text-xs text-foreground/80">
            {snippet}
          </div>
        )}
        <div className="mt-0.5 text-xs text-muted-foreground">
          {who} · {fmtDate(messageDate(message), { month: "short", day: "numeric" })} ·{" "}
          {relDays(messageDate(message))}
        </div>
      </div>
    </div>
  );
}

export function ActivityTimeline({
  inquiry,
  onAddActivity,
}: {
  inquiry: Inquiry;
  onAddActivity: DrawerCallbacks["onAddActivity"];
}) {
  const [type, setType] = useState<InquiryActivity["type"]>("note");
  const [text, setText] = useState("");

  // Merge logged activity with the de-duplicated email thread into one
  // chronological feed (newest first), so the timeline shows the full
  // back-and-forth — what we sent and what came back — alongside manual notes.
  const entries: TimelineEntry[] = [
    ...(inquiry.activity || []).map(
      (a): TimelineEntry => ({
        kind: "activity",
        id: `a-${a.id}`,
        date: a.occurred_at,
        activity: a,
      })
    ),
    ...visibleThreadMessages(inquiry.messages || []).map(
      (m): TimelineEntry => ({
        kind: "email",
        id: `m-${m.id}`,
        date: messageDate(m),
        message: m,
      })
    ),
  ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const submit = () => {
    if (!text.trim()) return;
    onAddActivity(inquiry.id, type, text.trim());
    setText("");
  };
  return (
    <div>
      <div className="flex gap-1">
        {LOG_TABS.map(([k, lbl]) => (
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
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        )}
        {entries.map((e) =>
          e.kind === "email" ? (
            <EmailEntry key={e.id} message={e.message} />
          ) : (
            <div key={e.id} className="flex gap-2.5">
              <ActivityIcon type={e.activity.type} />
              <div className="min-w-0 flex-1">
                <div className="text-sm">
                  <span className="font-semibold capitalize">{e.activity.type}</span> —{" "}
                  {e.activity.body}
                </div>
                <div className="text-xs text-muted-foreground">
                  {e.activity.actor ? `${e.activity.actor} · ` : ""}
                  {fmtDate(e.activity.occurred_at, { month: "short", day: "numeric" })} ·{" "}
                  {relDays(e.activity.occurred_at)}
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b py-4 last:border-b-0">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

// --- The drawer itself -----------------------------------------------------
export function InquiryDrawer({
  inquiry,
  entityId,
  onClose,
  callbacks,
}: {
  inquiry: Inquiry | null;
  entityId: string;
  onClose: () => void;
  callbacks: DrawerCallbacks;
}) {
  return (
    <Sheet open={!!inquiry} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
        {inquiry && (
          <>
            <SheetHeader className="flex-row items-center gap-3 border-b px-5 py-4">
              <InquiryAvatar name={inquiry.name} size={42} />
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base">
                  {inquiry.name || "Inquiry"}
                </SheetTitle>
                <div className="text-xs text-muted-foreground">
                  {inquiry.use_case ? `${inquiry.use_case} · ` : ""}
                  <span className="font-mono">{inquiry.reference}</span>
                </div>
              </div>
            </SheetHeader>

            <div className="px-5">
              <Section title="Pipeline stage">
                <div className="mb-3">
                  <QuickActions
                    inquiry={inquiry}
                    onAddActivity={callbacks.onAddActivity}
                  />
                </div>
                <StageBar inquiry={inquiry} onMove={callbacks.onMove} />
              </Section>

              <Section title="Event & contact">
                <ContactGrid inquiry={inquiry} onSetValue={callbacks.onSetValue} />
              </Section>

              <Section title="Assigned unit">
                <UnitAssign inquiry={inquiry} onAssignUnit={callbacks.onAssignUnit} />
              </Section>

              <Section title="Tasks & reminders">
                <TasksBlock
                  inquiry={inquiry}
                  onAddTask={callbacks.onAddTask}
                  onToggleTask={callbacks.onToggleTask}
                />
              </Section>

              <Section title="Activity & emails">
                <ActivityTimeline
                  inquiry={inquiry}
                  onAddActivity={callbacks.onAddActivity}
                />
              </Section>

              <div className="py-4">
                <Link
                  href={`/${entityId}/inquiries/${inquiry.id}`}
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="size-4" />
                  Open full inquiry & email thread
                </Link>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
