"use client";

// Slide-in deal detail drawer for the HDR Sales CRM — ports the design's
// detail.jsx: quick actions, stage progress bar, event/contact grid, fleet-unit
// assignment, follow-up tasks, and the activity timeline. The sub-blocks are
// exported so the full-page detail view can reuse them.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useEmbed } from "@/lib/inquiries/embed-context";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Phone,
  Mail,
  FileText,
  Plus,
  Check,
  CheckCircle2,
  ExternalLink,
  Trash2,
  XCircle,
  RotateCcw,
  Pencil,
} from "lucide-react";
import {
  InquiryAvatar,
  DueBadge,
  ActivityIcon,
  GoogleAdBadge,
  hexA,
} from "@/components/inquiries/atoms";
import { TemplatePicker } from "@/components/inquiries/template-picker";
import { QuoteDialog } from "@/components/inquiries/quote-dialog";
import { QuotesList } from "@/components/inquiries/quotes-list";
import { useTemplates } from "@/lib/inquiries/use-templates";
import { selectTemplates } from "@/lib/inquiries/templates";
import { type QuoteDraft } from "@/lib/inquiries/use-inquiries";
import {
  type Inquiry,
  type InquiryStatus,
  type InquiryTask,
  type InquiryActivity,
  type InquiryMessage,
  type InquiryQuote,
  STAGES,
  LOST_STAGE,
  COMPLETED_STAGE,
  LOST_REASONS,
  fmtMoney,
  fmtDateTime,
  fmtRange,
  relTime,
  isBookedStatus,
  genuineMessages,
  emailBodyText,
  addressName,
  messageDate,
  messageSide,
  isReservationRequest,
} from "@/lib/inquiries/shared";

export interface DrawerCallbacks {
  onMove: (id: string, status: InquiryStatus) => void;
  onSetValue: (id: string, value: number | null) => void;
  /** Save the bill-to override shown on the quote/invoice. Optional — when
   * omitted the Bill-to section renders read-only (no editing). */
  onSaveBilling?: (
    id: string,
    billingName: string | null,
    billingAddress: string | null
  ) => void;
  /** Save edits to the Event & contact fields (only the changed keys are sent).
   * Optional — when omitted the grid renders read-only. */
  onSaveDetails?: (id: string, patch: Record<string, unknown>) => void;
  onAddTask: (id: string, title: string, kind?: InquiryTask["kind"]) => void;
  onToggleTask: (taskId: string, done: boolean) => void;
  onAddActivity: (id: string, type: InquiryActivity["type"], body: string) => void;
  onDeleteActivity: (activityId: string) => void;
  onAddQuote: (id: string, draft: QuoteDraft) => Promise<InquiryQuote | null>;
  onUpdateQuoteStatus: (quoteId: string, status: InquiryQuote["status"]) => void;
  onDeleteQuote: (quoteId: string) => void;
  /** Permanently delete the whole inquiry (e.g. a test/junk card). Optional —
   * when omitted the "delete instead" shortcut in the lost picker is hidden. */
  onDelete?: (id: string) => void;
}

// --- Stage progress bar ----------------------------------------------------
export function StageBar({
  inquiry,
  onMove,
  onMarkLost,
  onDelete,
}: {
  inquiry: Inquiry;
  onMove: DrawerCallbacks["onMove"];
  onMarkLost?: (id: string, reason: string) => void;
  onDelete?: DrawerCallbacks["onDelete"];
}) {
  const [picking, setPicking] = useState(false);
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // A lost deal lives off the board — show a terminal banner with its reason and
  // a one-click reopen (back to the first stage) instead of the progress bar.
  if (inquiry.status === LOST_STAGE.key) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2">
        <XCircle className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium text-muted-foreground">
          Marked as lost{inquiry.lost_reason ? ` — ${inquiry.lost_reason}` : ""}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onMove(inquiry.id, STAGES[0].key)}
        >
          <RotateCcw className="size-4" /> Reopen
        </Button>
      </div>
    );
  }

  // A completed order is archived off the board too — show a terminal "done"
  // banner (positive) with a one-click reopen back to the last active stage.
  if (inquiry.status === COMPLETED_STAGE.key) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-green-300 bg-green-50/60 px-3 py-2 dark:border-green-900/60 dark:bg-green-950/30">
        <CheckCircle2 className="size-4 shrink-0 text-green-600" />
        <span className="flex-1 text-sm font-medium text-green-800 dark:text-green-300">
          Completed order
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onMove(inquiry.id, "returned")}
        >
          <RotateCcw className="size-4" /> Reopen
        </Button>
      </div>
    );
  }

  const idx = STAGES.findIndex((s) => s.key === inquiry.status);
  return (
    <div className="space-y-2">
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
      {/* Off-board terminal state: drop a lead that won't convert, capturing why
          (preset reason or free-text "Other"). Reversible from the lost banner. */}
      {picking ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-2">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Why was it lost?</option>
            {LOST_REASONS.map((r) => (
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
              disabled={!reason || (reason === "__other" && !other.trim())}
              onClick={() => {
                const final = reason === "__other" ? other.trim() : reason;
                if (!final) return;
                if (onMarkLost) onMarkLost(inquiry.id, final);
                else onMove(inquiry.id, LOST_STAGE.key);
                setPicking(false);
                setReason("");
                setOther("");
              }}
            >
              <XCircle className="size-3.5" /> Mark as lost
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPicking(false);
                setReason("");
                setOther("");
                setConfirmingDelete(false);
              }}
            >
              Cancel
            </Button>
          </div>

          {/* Not actually lost — just a test/junk card? Delete it outright
              instead of parking it in the Lost list. Two-step to avoid a
              mis-click; only shown when a delete handler is wired. */}
          {onDelete && (
            <div className="border-t pt-2">
              {confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Delete this inquiry permanently?
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      onDelete(inquiry.id);
                      setPicking(false);
                      setConfirmingDelete(false);
                      setReason("");
                      setOther("");
                    }}
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-destructive"
                >
                  <Trash2 className="size-3.5" /> Just a test? Delete this inquiry instead
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {/* Close out a booked order → the Completed archive (positive terminal
              state). Only offered once the deal is booked. Reversible. */}
          {isBookedStatus(inquiry.status) && (
            <button
              type="button"
              title="Mark this order as completed"
              onClick={() => onMove(inquiry.id, COMPLETED_STAGE.key)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded px-1 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-green-600/10 hover:text-green-700"
            >
              <CheckCircle2 className="size-3.5" /> Mark as completed
            </button>
          )}
          <button
            type="button"
            title="Mark this rental as lost"
            onClick={() => setPicking(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded px-1 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <XCircle className="size-3.5" /> Mark as lost
          </button>
        </div>
      )}
    </div>
  );
}

// --- Quick action buttons --------------------------------------------------
export function QuickActions({
  inquiry,
  entityId,
  actor = "You",
  onAddActivity,
  onSetValue,
  onAddQuote,
}: {
  inquiry: Inquiry;
  entityId: string;
  actor?: string;
  onAddActivity: DrawerCallbacks["onAddActivity"];
  onSetValue?: DrawerCallbacks["onSetValue"];
  onAddQuote?: DrawerCallbacks["onAddQuote"];
}) {
  const tel = inquiry.phone ? inquiry.phone.replace(/[^\d+]/g, "") : "";
  const { templates } = useTemplates(entityId);
  const hasTemplates = selectTemplates(templates, inquiry).length > 0;
  const [emailOpen, setEmailOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);

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

      {/* Email — opens the template picker pre-filled from this inquiry. Falls
          back to a plain mailto: when the stage has no templates. */}
      {hasTemplates ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setEmailOpen(true)}
          >
            <Mail className="size-4" /> Email
          </Button>
          <TemplatePicker
            key={inquiry.id}
            inquiry={inquiry}
            entityId={entityId}
            rep={actor}
            onLog={(t, body) => onAddActivity(inquiry.id, t, body)}
            onSetValue={onSetValue}
            onSaveQuote={onAddQuote}
            open={emailOpen}
            onOpenChange={setEmailOpen}
            trigger={null}
          />
        </>
      ) : (
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
      )}

      {/* Draft a Quote — opens the line-item builder, saves the quote to the
          deal, and downloads the branded PDF to attach. Falls back to logging a
          written quote when the quote callback isn't wired (rare). */}
      {onAddQuote ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => setQuoteOpen(true)}
          >
            <FileText className="size-4" /> Draft a Quote
          </Button>
          <QuoteDialog
            key={inquiry.id}
            inquiry={inquiry}
            onSave={onAddQuote}
            onSetValue={onSetValue}
            open={quoteOpen}
            onOpenChange={setQuoteOpen}
            trigger={null}
          />
        </>
      ) : (
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
      )}
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

// Seed a <input type="date"> from a stored date string — only when it's a real
// yyyy-mm-dd (the website form can store free text, which the picker can't hold;
// we leave those blank and avoid clobbering them on save unless the rep edits).
function toDateInput(s: string | null | undefined): string {
  if (!s) return "";
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

// The Event & contact draft — strings for every field (numbers held as text so
// the inputs stay controlled), seeded from the inquiry.
function detailsDraft(inq: Inquiry) {
  return {
    use_case: inq.use_case ?? "",
    start_date: toDateInput(inq.start_date),
    end_date: toDateInput(inq.end_date),
    duration: inq.duration ?? "",
    location: inq.location ?? "",
    units: inq.units != null ? String(inq.units) : "",
    guests: inq.guests ?? "",
    attendant: inq.attendant ?? "",
    phone: inq.phone ?? "",
    email: inq.email ?? "",
    source: inq.source ?? "",
    estimated_value: inq.estimated_value != null ? String(inq.estimated_value) : "",
  };
}
type DetailsDraft = ReturnType<typeof detailsDraft>;

// A labeled input for the Event & contact edit form. Defined at module scope (not
// inside ContactGrid's render) so it keeps its identity across keystrokes —
// otherwise each edit would remount the input and drop focus.
function DetailField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
    </label>
  );
}

// --- Event & contact + editable value -------------------------------------
export function ContactGrid({
  inquiry,
  onSetValue,
  onSaveDetails,
}: {
  inquiry: Inquiry;
  onSetValue: DrawerCallbacks["onSetValue"];
  onSaveDetails?: DrawerCallbacks["onSaveDetails"];
}) {
  const [editingValue, setEditingValue] = useState(false);
  const [valueDraft, setValueDraft] = useState(
    inquiry.estimated_value != null ? String(inquiry.estimated_value) : ""
  );
  const [editingAll, setEditingAll] = useState(false);
  const [draft, setDraft] = useState<DetailsDraft>(() => detailsDraft(inquiry));

  // Re-seed drafts whenever a different inquiry (or its fields) is shown — the
  // drawer reuses one mounted instance across selections.
  useEffect(() => {
    setDraft(detailsDraft(inquiry));
    setValueDraft(inquiry.estimated_value != null ? String(inquiry.estimated_value) : "");
    setEditingAll(false);
    setEditingValue(false);
  }, [inquiry]);

  const booked = isBookedStatus(inquiry.status);
  const dates = fmtRange(inquiry.start_date, inquiry.end_date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const set = (k: keyof DetailsDraft, v: string) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // Build a patch of ONLY the changed fields, normalizing "" → null and the
  // numeric fields to numbers. Dates compare against the picker-normalized
  // original so untouched free-text values are never overwritten.
  const saveAll = () => {
    if (!onSaveDetails) return;
    const patch: Record<string, unknown> = {};
    const textFields: (keyof DetailsDraft)[] = [
      "use_case", "duration", "location", "guests", "attendant", "phone", "email",
    ];
    for (const f of textFields) {
      const next = draft[f].trim() === "" ? null : draft[f].trim();
      if ((inquiry[f as keyof Inquiry] ?? null) !== next) patch[f] = next;
    }
    // source is NOT NULL — send a string (possibly empty), never null.
    const sourceNext = draft.source.trim();
    if (sourceNext !== (inquiry.source ?? "")) patch.source = sourceNext;
    // Dates
    if (draft.start_date !== toDateInput(inquiry.start_date)) {
      patch.start_date = draft.start_date || null;
    }
    if (draft.end_date !== toDateInput(inquiry.end_date)) {
      patch.end_date = draft.end_date || null;
    }
    // Units (int)
    const unitsNext = draft.units.trim() === "" ? null : Math.trunc(Number(draft.units));
    if (
      unitsNext !== (inquiry.units ?? null) &&
      !(unitsNext != null && Number.isNaN(unitsNext))
    ) {
      patch.units = unitsNext;
    }
    // Estimated value
    const valNext = draft.estimated_value.trim() === "" ? null : Number(draft.estimated_value);
    if (
      valNext !== (inquiry.estimated_value ?? null) &&
      !(valNext != null && Number.isNaN(valNext))
    ) {
      patch.estimated_value = valNext;
    }

    if (Object.keys(patch).length > 0) onSaveDetails(inquiry.id, patch);
    setEditingAll(false);
  };

  // --- Edit-all form -------------------------------------------------------
  if (editingAll) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <DetailField label="Event type" value={draft.use_case} onChange={(v) => set("use_case", v)} />
          <DetailField label="Source" value={draft.source} onChange={(v) => set("source", v)} />
          <DetailField label="Start date" type="date" value={draft.start_date} onChange={(v) => set("start_date", v)} />
          <DetailField label="End date" type="date" value={draft.end_date} onChange={(v) => set("end_date", v)} />
          <DetailField label="Duration" placeholder="e.g. 3 days" value={draft.duration} onChange={(v) => set("duration", v)} />
          <DetailField label="Location" value={draft.location} onChange={(v) => set("location", v)} />
          <DetailField label="Units" type="number" value={draft.units} onChange={(v) => set("units", v)} />
          <DetailField label="Guests" value={draft.guests} onChange={(v) => set("guests", v)} />
          <DetailField label="Attendant" value={draft.attendant} onChange={(v) => set("attendant", v)} />
          <DetailField label="Est. value ($)" type="number" value={draft.estimated_value} onChange={(v) => set("estimated_value", v)} />
          <DetailField label="Phone" type="tel" value={draft.phone} onChange={(v) => set("phone", v)} />
          <DetailField label="Email" type="email" value={draft.email} onChange={(v) => set("email", v)} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-8" onClick={saveAll}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => {
              setDraft(detailsDraft(inquiry));
              setEditingAll(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // --- Read view -----------------------------------------------------------
  return (
    <div className="space-y-3">
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
        <KV
          k="Source"
          v={
            <span className="inline-flex items-center gap-1.5">
              {inquiry.source || "—"}
              <GoogleAdBadge gclid={inquiry.gclid} />
            </span>
          }
        />

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

      {onSaveDetails && (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => {
            setDraft(detailsDraft(inquiry));
            setEditingAll(true);
          }}
        >
          <Pencil className="size-3.5" /> Edit details
        </Button>
      )}
    </div>
  );
}

// --- Bill-to override (what prints on the quote / invoice) -----------------
// By default the quote/invoice is issued in the inquiry's own name. When a
// rental is booked by one party but billed to another (e.g. a fundraiser
// booking on behalf of the organization), a rep sets a bill-to name + address
// here; it overrides only the "Customer / Issued To" block on the generated PDF
// — the working contact (name/email/phone) is untouched.
export function BillingBlock({
  inquiry,
  onSaveBilling,
}: {
  inquiry: Inquiry;
  onSaveBilling: NonNullable<DrawerCallbacks["onSaveBilling"]>;
}) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(inquiry.billing_name ?? "");
  const [addrDraft, setAddrDraft] = useState(inquiry.billing_address ?? "");

  // Re-seed the drafts whenever a different inquiry is shown (the drawer reuses
  // one mounted instance across selections).
  useEffect(() => {
    setNameDraft(inquiry.billing_name ?? "");
    setAddrDraft(inquiry.billing_address ?? "");
    setEditing(false);
  }, [inquiry.id, inquiry.billing_name, inquiry.billing_address]);

  const hasOverride = !!(inquiry.billing_name || inquiry.billing_address);

  const save = () => {
    const name = nameDraft.trim();
    const addr = addrDraft.trim();
    onSaveBilling(inquiry.id, name || null, addr || null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-2.5">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Bill-to name</label>
          <Input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder={inquiry.name || "Customer name on the invoice"}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Billing address</label>
          <Textarea
            value={addrDraft}
            onChange={(e) => setAddrDraft(e.target.value)}
            placeholder={"Street\nCity, ST ZIP"}
            rows={3}
            className="text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-8" onClick={save}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => {
              setNameDraft(inquiry.billing_name ?? "");
              setAddrDraft(inquiry.billing_address ?? "");
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          {hasOverride && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-8 text-muted-foreground hover:text-destructive"
              onClick={() => {
                setNameDraft("");
                setAddrDraft("");
                onSaveBilling(inquiry.id, null, null);
                setEditing(false);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 text-sm">
        {hasOverride ? (
          <>
            <div className="font-medium">{inquiry.billing_name || inquiry.name || "—"}</div>
            {inquiry.billing_address && (
              <div className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
                {inquiry.billing_address}
              </div>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">
            Invoice issued to <span className="font-medium text-foreground">{inquiry.name || "the contact"}</span>.
            Set a different name/address if needed.
          </span>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-8 shrink-0"
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-3.5" /> {hasOverride ? "Edit" : "Set bill-to"}
      </Button>
    </div>
  );
}

// --- Document note (prints on the quote / invoice) -------------------------
// A free-form note the rep wants on the customer-facing document — e.g.
// "Includes after-hours delivery" or "PO# required on invoice". Distinct from
// the private internal notes and from a quote's per-draft terms. The two toggles
// pick which generated PDF(s) it appears on (quote, invoice, or both).
export function DocumentNoteBlock({
  inquiry,
  onSave,
}: {
  inquiry: Inquiry;
  onSave: (
    id: string,
    note: string | null,
    onQuote: boolean,
    onInvoice: boolean
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(inquiry.document_note ?? "");
  const [onQuote, setOnQuote] = useState(inquiry.note_on_quote);
  const [onInvoice, setOnInvoice] = useState(inquiry.note_on_invoice);

  // Re-seed whenever a different inquiry is shown (the drawer reuses one mounted
  // instance across selections).
  useEffect(() => {
    setNoteDraft(inquiry.document_note ?? "");
    setOnQuote(inquiry.note_on_quote);
    setOnInvoice(inquiry.note_on_invoice);
    setEditing(false);
  }, [
    inquiry.id,
    inquiry.document_note,
    inquiry.note_on_quote,
    inquiry.note_on_invoice,
  ]);

  const hasNote = !!(inquiry.document_note && inquiry.document_note.trim());

  const save = () => {
    const note = noteDraft.trim();
    onSave(inquiry.id, note || null, onQuote, onInvoice);
    setEditing(false);
  };

  const reset = () => {
    setNoteDraft(inquiry.document_note ?? "");
    setOnQuote(inquiry.note_on_quote);
    setOnInvoice(inquiry.note_on_invoice);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-2.5">
        <Textarea
          autoFocus
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder={"e.g. Includes after-hours delivery.\nRates held through the end of the month."}
          rows={3}
          className="text-sm"
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={onQuote}
              onCheckedChange={(v) => setOnQuote(v === true)}
            />
            Show on quote
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={onInvoice}
              onCheckedChange={(v) => setOnInvoice(v === true)}
            />
            Show on invoice
          </label>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="h-8" onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={reset}>
            Cancel
          </Button>
          {hasNote && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-8 text-muted-foreground hover:text-destructive"
              onClick={() => {
                setNoteDraft("");
                onSave(inquiry.id, null, onQuote, onInvoice);
                setEditing(false);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 text-sm">
        {hasNote ? (
          <>
            <div className="whitespace-pre-wrap">{inquiry.document_note}</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {inquiry.note_on_quote && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  On quote
                </span>
              )}
              {inquiry.note_on_invoice && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  On invoice
                </span>
              )}
              {!inquiry.note_on_quote && !inquiry.note_on_invoice && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  Hidden — not on either document
                </span>
              )}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">
            No note. Add one to print on the quote or invoice.
          </span>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-8 shrink-0"
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-3.5" /> {hasNote ? "Edit" : "Add note"}
      </Button>
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

// A unified timeline entry — either a logged activity or a real email.
type TimelineEntry =
  | { kind: "activity"; id: string; date: string; activity: InquiryActivity }
  | { kind: "email"; id: string; date: string; message: InquiryMessage };

// An email rendered as a chat bubble — ours on the right (filled), the
// customer's on the left (muted). Shows the full body with the quoted reply
// history and forwarded headers stripped; the bubble's side/colour identifies
// the sender, so no From/To/subject clutter.
function EmailBubble({
  message,
  customerEmail,
  customerName,
}: {
  message: InquiryMessage;
  customerEmail: string | null;
  customerName: string | null;
}) {
  const mine = messageSide(message, customerEmail) === "us";
  const body = emailBodyText(message) || "(no message content)";
  const who = mine
    ? addressName(message.from_addr) || "You"
    : customerName || addressName(message.from_addr) || "Customer";

  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Measure (while collapsed) whether the body is taller than the 2-line clamp,
  // so the "Show more" toggle only appears when there's actually more to read.
  useEffect(() => {
    if (expanded) return;
    const el = bodyRef.current;
    if (el) setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [body, expanded]);

  const canToggle = overflowing || expanded;

  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      <div
        ref={bodyRef}
        onClick={() => canToggle && setExpanded((e) => !e)}
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
          canToggle ? "cursor-pointer" : ""
        } ${
          mine
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground"
        } ${expanded ? "" : "line-clamp-2"}`}
      >
        {body}
      </div>
      <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <span>
          {who} · {fmtDateTime(messageDate(message))}
        </span>
        {canToggle && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="font-medium text-primary hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    </div>
  );
}

// A logged note/call/quote, shown as a centered "system" line between bubbles.
function ActivityChip({
  activity,
  onDelete,
}: {
  activity: InquiryActivity;
  onDelete: DrawerCallbacks["onDeleteActivity"];
}) {
  return (
    <div className="flex justify-center">
      <div className="flex max-w-[92%] items-start gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground">
        <ActivityIcon type={activity.type} size={10} />
        <span className="min-w-0">
          <span className="font-semibold capitalize text-foreground/80">
            {activity.type}
          </span>{" "}
          {activity.body}
          <span className="opacity-70"> · {relTime(activity.occurred_at)}</span>
        </span>
        <button
          type="button"
          onClick={() => onDelete(activity.id)}
          title="Remove this activity"
          aria-label="Remove this activity"
          className="shrink-0 rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ActivityTimeline({
  inquiry,
  entityId,
  onAddActivity,
  onDeleteActivity,
  onSetValue,
  actor = "You",
}: {
  inquiry: Inquiry;
  entityId: string;
  onAddActivity: DrawerCallbacks["onAddActivity"];
  onDeleteActivity: DrawerCallbacks["onDeleteActivity"];
  onSetValue?: DrawerCallbacks["onSetValue"];
  actor?: string;
}) {
  const [type, setType] = useState<InquiryActivity["type"]>("note");
  const [text, setText] = useState("");

  // Build a chat-ordered (oldest → newest) feed: real emails as bubbles plus
  // logged activity as system lines. The automated lead-notification and "thank
  // you" autoreply (and their forwarded echoes) are hidden — they're not part of
  // the customer conversation.
  const entries: TimelineEntry[] = [
    ...genuineMessages(inquiry.messages || []).map(
      (m): TimelineEntry => ({
        kind: "email",
        id: `m-${m.id}`,
        date: messageDate(m),
        message: m,
      })
    ),
    ...(inquiry.activity || []).map(
      (a): TimelineEntry => ({
        kind: "activity",
        id: `a-${a.id}`,
        date: a.occurred_at,
        activity: a,
      })
    ),
  ].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const submit = () => {
    if (!text.trim()) return;
    onAddActivity(inquiry.id, type, text.trim());
    setText("");
  };
  return (
    <div>
      <div className="flex items-center gap-1">
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
        <div className="ml-auto">
          <TemplatePicker
            key={inquiry.id}
            inquiry={inquiry}
            entityId={entityId}
            rep={actor}
            onLog={(t, body) => onAddActivity(inquiry.id, t, body)}
            onSetValue={onSetValue}
          />
        </div>
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
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        )}
        {entries.map((e) =>
          e.kind === "email" ? (
            <EmailBubble
              key={e.id}
              message={e.message}
              customerEmail={inquiry.email}
              customerName={inquiry.name}
            />
          ) : (
            <ActivityChip key={e.id} activity={e.activity} onDelete={onDeleteActivity} />
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
  actor = "You",
}: {
  inquiry: Inquiry | null;
  entityId: string;
  onClose: () => void;
  callbacks: DrawerCallbacks;
  actor?: string;
}) {
  const embed = useEmbed();
  const base = embed ? embed.basePath : `/${entityId}/inquiries`;
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

            {isReservationRequest(inquiry) && (
              <div className="flex items-center gap-2 border-b border-green-200 bg-green-50 px-5 py-2.5 text-sm dark:border-green-900/60 dark:bg-green-950/30">
                <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                  Reservation request
                </span>
                <span className="text-green-800 dark:text-green-300">
                  Priced online via /reserve
                  {inquiry.deposit != null && inquiry.deposit > 0
                    ? ` · ${fmtMoney(inquiry.deposit)} deposit`
                    : ""}
                  {" — call to take the card on file."}
                </span>
              </div>
            )}

            <div className="px-5">
              <Section title="Pipeline stage">
                <div className="mb-3">
                  <QuickActions
                    inquiry={inquiry}
                    entityId={entityId}
                    actor={actor}
                    onAddActivity={callbacks.onAddActivity}
                    onSetValue={callbacks.onSetValue}
                    onAddQuote={callbacks.onAddQuote}
                  />
                </div>
                <StageBar
                  inquiry={inquiry}
                  onMove={callbacks.onMove}
                  onMarkLost={
                    callbacks.onSaveDetails
                      ? (id, lost_reason) =>
                          callbacks.onSaveDetails!(id, { status: "lost", lost_reason })
                      : undefined
                  }
                  onDelete={callbacks.onDelete}
                />
              </Section>

              <Section title="Event & contact">
                <ContactGrid
                  inquiry={inquiry}
                  onSetValue={callbacks.onSetValue}
                  onSaveDetails={callbacks.onSaveDetails}
                />
              </Section>

              {callbacks.onSaveBilling && (
                <Section title="Bill-to (invoice / quote)">
                  <BillingBlock
                    inquiry={inquiry}
                    onSaveBilling={callbacks.onSaveBilling}
                  />
                </Section>
              )}

              {callbacks.onSaveDetails && (
                <Section title="Note on quote / invoice">
                  <DocumentNoteBlock
                    inquiry={inquiry}
                    onSave={(id, note, onQuote, onInvoice) =>
                      callbacks.onSaveDetails!(id, {
                        document_note: note,
                        note_on_quote: onQuote,
                        note_on_invoice: onInvoice,
                      })
                    }
                  />
                </Section>
              )}

              <Section title="Quotes">
                <QuotesList
                  inquiry={inquiry}
                  onUpdateStatus={callbacks.onUpdateQuoteStatus}
                  onDelete={callbacks.onDeleteQuote}
                />
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
                  entityId={entityId}
                  onAddActivity={callbacks.onAddActivity}
                  onDeleteActivity={callbacks.onDeleteActivity}
                  onSetValue={callbacks.onSetValue}
                  actor={actor}
                />
              </Section>

              <div className="py-4">
                <Link
                  href={`${base}/${inquiry.id}`}
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
