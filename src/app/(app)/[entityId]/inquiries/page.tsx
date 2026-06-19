"use client";

import { useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { MapPin, AlertTriangle, Flame, Mail, Sparkles } from "lucide-react";
import { useInquiries } from "@/lib/inquiries/use-inquiries";
import { useTemplates } from "@/lib/inquiries/use-templates";
import { selectTemplates } from "@/lib/inquiries/templates";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { InquiryDrawer, type DrawerCallbacks } from "@/components/inquiries/detail-drawer";
import { TemplatePicker } from "@/components/inquiries/template-picker";
import {
  InquiryAvatar,
  LastTouched,
  CorrespondenceBadge,
} from "@/components/inquiries/atoms";
import {
  type Inquiry,
  type InquiryStatus,
  STAGES,
  fmtMoney,
  fmtRange,
  daysStale,
  daysBetween,
  today,
  parseDate,
  isOpenStatus,
  isReservationRequest,
} from "@/lib/inquiries/shared";

function firstOpenTask(inq: Inquiry) {
  return (inq.tasks || []).find((t) => !t.done) || null;
}

function DealCard({
  inq,
  onOpen,
  onEmail,
  onDragStart,
  dragging,
}: {
  inq: Inquiry;
  onOpen: () => void;
  onEmail?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  dragging: boolean;
}) {
  const openTask = firstOpenTask(inq);
  const due = parseDate(openTask?.due_date ?? null);
  const overdue = !!due && daysBetween(today(), due) < 0;
  const stale = isOpenStatus(inq.status) && daysStale(inq) >= 5;
  // Priced self-serve reservation requests are warmer leads — tint them green
  // so they stand out from plain quote inquiries on the same board.
  const reservation = isReservationRequest(inq);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className={`cursor-pointer rounded-md border p-2.5 shadow-sm transition-shadow hover:shadow-md ${
        reservation
          ? "border-green-300 bg-green-50 dark:border-green-900/60 dark:bg-green-950/30"
          : "bg-card"
      } ${dragging ? "opacity-40" : ""}`}
    >
      {reservation && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
            <Sparkles className="size-3" /> Reservation request
          </span>
          {inq.deposit != null && inq.deposit > 0 && (
            <span className="text-[11px] font-medium text-green-700 dark:text-green-400">
              {fmtMoney(inq.deposit)} deposit
            </span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <InquiryAvatar name={inq.name} size={26} />
        <span className="flex-1 truncate text-sm font-semibold">{inq.name || "—"}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{inq.reference}</span>
        {onEmail && (
          <button
            type="button"
            title="Email this customer from a template"
            aria-label="Email this customer from a template"
            onClick={(e) => {
              e.stopPropagation();
              onEmail();
            }}
            className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Mail className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-1.5 text-xs">
        <span className="font-semibold">{inq.use_case || "Inquiry"}</span>
        {inq.start_date && (
          <span className="text-muted-foreground">
            {" · "}
            {fmtRange(inq.start_date, inq.end_date)}
          </span>
        )}
      </div>
      {(inq.location || inq.guests) && (
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          <span className="truncate">
            {inq.location}
            {inq.guests ? ` · ${inq.guests} guests` : ""}
          </span>
        </div>
      )}
      {inq.estimated_value != null && (
        <div className="mt-2 flex items-center justify-end border-t pt-2">
          <span className="font-mono text-xs font-semibold">
            {fmtMoney(inq.estimated_value)}
          </span>
        </div>
      )}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <LastTouched inq={inq} />
        <CorrespondenceBadge inq={inq} />
      </div>
      {(overdue || stale) && (
        <div className="mt-1.5">
          {overdue ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
              <AlertTriangle className="size-3" /> Follow-up overdue
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
              <Flame className="size-3" /> {daysStale(inq)}d no contact
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function InquiriesPipelinePage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const data = useInquiries(entityId);
  const { templates } = useTemplates(entityId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [emailId, setEmailId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<InquiryStatus | null>(null);
  const draggedRef = useRef(false);

  const callbacks: DrawerCallbacks = {
    onMove: data.moveStage,
    onSetValue: data.setEstimatedValue,
    onSaveBilling: (id, billingName, billingAddress) =>
      data.updateTriage(
        id,
        { billing_name: billingName, billing_address: billingAddress },
        "Bill-to saved"
      ),
    onSaveDetails: (id, patch) => data.updateTriage(id, patch, "Details saved"),
    onAddTask: data.addTask,
    onToggleTask: data.toggleTask,
    onAddActivity: data.addActivity,
    onDeleteActivity: data.deleteActivity,
    onAddQuote: data.addQuote,
    onUpdateQuoteStatus: data.updateQuoteStatus,
    onDeleteQuote: data.deleteQuote,
  };

  const selected = data.inquiries.find((i) => i.id === selectedId) ?? null;
  const emailInquiry = data.inquiries.find((i) => i.id === emailId) ?? null;

  const { openCount, overdueCount } = useMemo(() => {
    const open = data.inquiries.filter((i) => isOpenStatus(i.status)).length;
    const overdue = data.inquiries.reduce(
      (s, i) =>
        s +
        (i.tasks || []).filter((t) => {
          const d = parseDate(t.due_date);
          return !t.done && d && daysBetween(today(), d) < 0;
        }).length,
      0
    );
    return { openCount: open, overdueCount: overdue };
  }, [data.inquiries]);

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inquiries</h1>
        <p className="text-sm text-muted-foreground">
          Drag a card across stages to update its status · click to open the deal
        </p>
      </div>
      <SectionTabs entityId={entityId} openCount={openCount} overdueCount={overdueCount} />

      {data.loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
          {STAGES.map((stage) => {
            const items = data.inquiries.filter((i) => i.status === stage.key);
            const colValue = items.reduce((s, i) => s + (i.estimated_value || 0), 0);
            const isOver = dragOverCol === stage.key;
            return (
              <div
                key={stage.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverCol !== stage.key) setDragOverCol(stage.key);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget === e.target) setDragOverCol(null);
                }}
                onDrop={(e) => {
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
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: stage.color }}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-semibold leading-tight">{stage.label}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {fmtMoney(colValue)}
                    </div>
                  </div>
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    {items.length}
                  </span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-2">
                  {items.length === 0 && (
                    <p className="px-1 py-5 text-center text-xs text-muted-foreground">
                      Drop here
                    </p>
                  )}
                  {items.map((inq) => (
                    <DealCard
                      key={inq.id}
                      inq={inq}
                      dragging={false}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", inq.id);
                        e.dataTransfer.effectAllowed = "move";
                        draggedRef.current = true;
                        setTimeout(() => {
                          draggedRef.current = false;
                        }, 0);
                      }}
                      onOpen={() => {
                        if (draggedRef.current) return;
                        setSelectedId(inq.id);
                      }}
                      onEmail={
                        selectTemplates(templates, inq).length > 0
                          ? () => setEmailId(inq.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <InquiryDrawer
        inquiry={selected}
        entityId={entityId}
        onClose={() => setSelectedId(null)}
        callbacks={callbacks}
        actor={data.actor}
      />

      {/* Quick-compose: clicking a card's email icon opens the template picker
          straight away, pre-filled from that inquiry's quote request. */}
      {emailInquiry && (
        <TemplatePicker
          key={emailInquiry.id}
          inquiry={emailInquiry}
          entityId={entityId}
          rep={data.actor}
          onLog={(t, body) => data.addActivity(emailInquiry.id, t, body)}
          onSetValue={data.setEstimatedValue}
          onSaveQuote={data.addQuote}
          open
          onOpenChange={(o) => {
            if (!o) setEmailId(null);
          }}
          trigger={null}
        />
      )}
    </div>
  );
}
