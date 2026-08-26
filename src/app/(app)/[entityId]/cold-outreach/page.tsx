"use client";

// Cold outreach board — Joe's preferred-vendor pipeline for HDR Site Services.
// Same data layer as Inquiries but loaded with lane='cold', so nothing here can
// touch an inbound card. Board view (drag across stages) and a Follow-ups list
// (sorted by next follow-up date, overdue first).

import { useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, CalendarClock, Globe, Mail, KanbanSquare, ListChecks } from "lucide-react";
import { useInquiries } from "@/lib/inquiries/use-inquiries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InquiryAvatar, LastContacted, CorrespondenceBadge } from "@/components/inquiries/atoms";
import { ColdDrawer, type ColdDrawerCallbacks } from "@/components/inquiries/cold-drawer";
import {
  type Inquiry,
  type InquiryStatus,
  COLD_STAGES,
  DEAD_STAGE,
  COLD_VERTICALS,
  COLD_SOURCES,
  STAGE_BY_KEY,
  parseDate,
  daysBetween,
  today,
  fmtDate,
} from "@/lib/inquiries/shared";

function followUpState(inq: Inquiry): { due: Date | null; overdue: boolean; dueToday: boolean } {
  const due = parseDate(inq.next_follow_up ?? null);
  if (!due) return { due: null, overdue: false, dueToday: false };
  const diff = daysBetween(today(), due);
  return { due, overdue: diff < 0, dueToday: diff === 0 };
}

function FollowUpBadge({ inq }: { inq: Inquiry }) {
  const { due, overdue, dueToday } = followUpState(inq);
  if (!due) return null;
  const tone = overdue
    ? "bg-red-100 text-red-700"
    : dueToday
      ? "bg-amber-100 text-amber-800"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      <CalendarClock className="size-3" />
      {overdue ? "Overdue · " : dueToday ? "Today · " : ""}
      {fmtDate(due)}
    </span>
  );
}

function VendorCard({
  inq,
  onOpen,
  onDragStart,
}: {
  inq: Inquiry;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="cursor-pointer rounded-md border bg-card p-2.5 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-2">
        <InquiryAvatar name={inq.company || inq.name} size={26} />
        <span className="flex-1 truncate text-sm font-semibold">{inq.company || "—"}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{inq.reference}</span>
      </div>
      <div className="mt-1.5 text-xs">
        <span className="font-semibold">{inq.vertical || "Vertical not set"}</span>
        {inq.name && <span className="text-muted-foreground"> · {inq.name}</span>}
      </div>
      <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
        <Mail className="size-3 shrink-0" />
        <span className="truncate">{inq.email}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <FollowUpBadge inq={inq} />
        {inq.sequence && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {inq.sequence}
          </span>
        )}
        <CorrespondenceBadge inq={inq} />
      </div>
      <div className="mt-1.5">
        <LastContacted inq={inq} />
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  company: "",
  email: "",
  vertical: "",
  name: "",
  contact_title: "",
  phone: "",
  website: "",
  outreach_source: "Research list",
  next_follow_up: "",
  notes: "",
};

function NewCardDialog({
  entityId,
  open,
  onOpenChange,
  onCreated,
}: {
  entityId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.company.trim() && /\S+@\S+\.\S+/.test(form.email) && form.vertical;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { entityId };
      for (const [k, v] of Object.entries(form)) payload[k] = v.trim() === "" ? null : v.trim();
      const res = await fetch("/api/inquiries/cold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `Create failed (HTTP ${res.status})`);
      }
      toast.success(`Added ${form.company.trim()}`);
      setForm(EMPTY_FORM);
      onOpenChange(false);
      await onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create card");
    } finally {
      setSaving(false);
    }
  };

  const field = (k: keyof typeof EMPTY_FORM, label: string, type = "text", required = false) => (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <Input type={type} value={form[k]} onChange={(e) => set(k, e.target.value)} className="h-8 text-sm" />
    </label>
  );
  const select = (k: keyof typeof EMPTY_FORM, label: string, options: readonly string[], required = false) => (
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New cold outreach card</DialogTitle>
          <DialogDescription>
            Starts in Not contacted. Nothing is emailed — send from Gmail with
            sales@hdrsiteservices.com on CC and the thread attaches to the card.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {field("company", "Company", "text", true)}
          {select("vertical", "Vertical", COLD_VERTICALS, true)}
          {field("email", "Email", "email", true)}
          {field("phone", "Phone", "tel")}
          {field("name", "Contact name")}
          {field("contact_title", "Title")}
          {field("website", "Website", "url")}
          {select("outreach_source", "Source", COLD_SOURCES)}
          {field("next_follow_up", "Next follow-up", "date")}
        </div>
        <label className="block text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Notes</span>
          <Textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={3}
            placeholder="Pitch angle, caveats"
            className="text-sm"
          />
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving ? "Adding…" : "Add card"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ColdOutreachPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const data = useInquiries(entityId, "cold");

  const [view, setView] = useState<"board" | "followups">("board");
  const [showDead, setShowDead] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragOverCol, setDragOverCol] = useState<InquiryStatus | null>(null);
  const draggedRef = useRef(false);

  const callbacks: ColdDrawerCallbacks = {
    onMove: data.moveStage,
    onSaveDetails: (id, patch, msg) => data.updateTriage(id, patch, msg ?? "Saved"),
    onAddTask: data.addTask,
    onToggleTask: data.toggleTask,
    onAddActivity: data.addActivity,
    onDeleteActivity: data.deleteActivity,
    onDelete: (id) => {
      setSelectedId(null);
      data.deleteInquiry(id);
    },
  };

  const selected = data.inquiries.find((i) => i.id === selectedId) ?? null;
  const working = useMemo(
    () => data.inquiries.filter((i) => showDead || i.status !== DEAD_STAGE.key),
    [data.inquiries, showDead]
  );
  const deadCount = data.inquiries.filter((i) => i.status === DEAD_STAGE.key).length;

  const followUps = useMemo(
    () =>
      [...working].sort((a, b) => {
        const ad = a.next_follow_up || "";
        const bd = b.next_follow_up || "";
        if (ad && bd) return ad.localeCompare(bd);
        if (ad) return -1;
        if (bd) return 1;
        return (a.company || "").localeCompare(b.company || "");
      }),
    [working]
  );

  const columns = showDead ? [...COLD_STAGES, DEAD_STAGE] : COLD_STAGES;

  const startDrag = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    draggedRef.current = true;
    setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  };
  const open = (id: string) => {
    if (draggedRef.current) return;
    setSelectedId(id);
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cold outreach</h1>
          <p className="text-sm text-muted-foreground">
            Preferred-vendor prospects · drag a card across stages · click to open
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New card
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ["board", "Board", KanbanSquare],
              ["followups", "Follow-ups", ListChecks],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                view === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDead}
            onChange={(e) => setShowDead(e.target.checked)}
            className="size-3.5"
          />
          Show dead{deadCount > 0 ? ` (${deadCount})` : ""}
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {working.length} card{working.length === 1 ? "" : "s"} in play
        </span>
      </div>

      {data.loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : view === "board" ? (
        <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
          {columns.map((stage) => {
            // Dead needs a reason, so it's not a drop target — use the card's
            // Mark dead button.
            const droppable = stage.key !== DEAD_STAGE.key;
            const items = working
              .filter((i) => i.status === stage.key)
              .sort((a, b) => {
                const ao = followUpState(a);
                const bo = followUpState(b);
                if (ao.overdue !== bo.overdue) return ao.overdue ? -1 : 1;
                return (a.next_follow_up || "9999").localeCompare(b.next_follow_up || "9999");
              });
            const isOver = droppable && dragOverCol === stage.key;
            return (
              <div
                key={stage.key}
                onDragOver={(e) => {
                  if (!droppable) return;
                  e.preventDefault();
                  if (dragOverCol !== stage.key) setDragOverCol(stage.key);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget === e.target) setDragOverCol(null);
                }}
                onDrop={(e) => {
                  if (!droppable) return;
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  setDragOverCol(null);
                  if (id) data.moveStage(id, stage.key);
                }}
                className={`flex w-[290px] shrink-0 flex-col rounded-xl bg-muted/40 ${
                  isOver ? "outline-dashed outline-2 outline-primary/60" : ""
                }`}
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="size-2.5 rounded-full" style={{ background: stage.color }} />
                  <div className="flex-1 text-sm font-semibold leading-tight">{stage.label}</div>
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    {items.length}
                  </span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {items.length === 0 && (
                    <p className="px-1 py-5 text-center text-xs text-muted-foreground">
                      {droppable ? "Drop here" : "Mark dead from the card"}
                    </p>
                  )}
                  {items.map((inq) => (
                    <VendorCard
                      key={inq.id}
                      inq={inq}
                      onDragStart={(e) => startDrag(e, inq.id)}
                      onOpen={() => open(inq.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-[10.5px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Next follow-up</th>
                <th className="px-3 py-2 text-left font-semibold">Company</th>
                <th className="px-3 py-2 text-left font-semibold">Vertical</th>
                <th className="px-3 py-2 text-left font-semibold">Stage</th>
                <th className="px-3 py-2 text-left font-semibold">Last touch</th>
                <th className="px-3 py-2 text-left font-semibold">Contact</th>
              </tr>
            </thead>
            <tbody>
              {followUps.map((inq) => {
                const stage = STAGE_BY_KEY[inq.status as InquiryStatus];
                return (
                  <tr
                    key={inq.id}
                    onClick={() => setSelectedId(inq.id)}
                    className="cursor-pointer border-b last:border-b-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-2">
                      <FollowUpBadge inq={inq} />
                      {!inq.next_follow_up && <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <InquiryAvatar name={inq.company || inq.name} size={28} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{inq.company || "—"}</div>
                          <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                            {inq.website && <Globe className="size-3" />}
                            {inq.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{inq.vertical || "—"}</td>
                    <td className="px-3 py-2">
                      {stage && (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                          style={{ background: `${stage.color}22`, color: stage.color }}
                        >
                          <span className="size-1.5 rounded-full" style={{ background: stage.color }} />
                          {stage.label}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {inq.last_touch_at ? fmtDate(inq.last_touch_at) : "never"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {inq.name || "—"}
                      {inq.contact_title ? (
                        <span className="text-muted-foreground"> · {inq.contact_title}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {followUps.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No cards yet — add one to get started.
            </div>
          )}
        </div>
      )}

      <ColdDrawer inquiry={selected} onClose={() => setSelectedId(null)} callbacks={callbacks} />

      <NewCardDialog
        entityId={entityId}
        open={creating}
        onOpenChange={setCreating}
        onCreated={data.reload}
      />
    </div>
  );
}
