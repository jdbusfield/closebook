"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  INQUIRY_STATUSES,
  STATUS_LABELS,
  type InquiryStatus,
} from "@/lib/inquiries/shared";

interface InquiryRow {
  id: string;
  reference: string;
  status: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  use_case: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  units: number | null;
  last_activity_at: string | null;
  created_at: string;
}

// Per-stage accent. `dot` tints the column header marker; `ring` highlights a
// column while a card is dragged over it.
const COLUMN_ACCENT: Record<InquiryStatus, { dot: string; ring: string }> = {
  new: { dot: "bg-blue-500", ring: "ring-blue-400 bg-blue-50/60" },
  quote_sent: { dot: "bg-amber-500", ring: "ring-amber-400 bg-amber-50/60" },
  rental_confirmed: { dot: "bg-violet-500", ring: "ring-violet-400 bg-violet-50/60" },
  completed: { dot: "bg-green-500", ring: "ring-green-400 bg-green-50/60" },
  lost: { dot: "bg-gray-400", ring: "ring-gray-400 bg-gray-100/70" },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeStatus(status: string): InquiryStatus {
  return (status in STATUS_LABELS ? status : "new") as InquiryStatus;
}

export default function InquiriesPage() {
  const params = useParams();
  const router = useRouter();
  const entityId = params.entityId as string;

  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragOverCol, setDragOverCol] = useState<InquiryStatus | null>(null);
  // True between dragstart and dragend so the trailing click doesn't navigate.
  const draggedRef = useRef(false);

  const fetchInquiries = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("rental_inquiries")
      .select(
        "id, reference, status, name, email, phone, use_case, location, start_date, end_date, units, last_activity_at, created_at"
      )
      .eq("entity_id", entityId)
      .order("last_activity_at", { ascending: false })
      .limit(500);
    setInquiries((data as InquiryRow[]) ?? []);
    setLoading(false);
  }, [entityId]);

  useEffect(() => {
    fetchInquiries();
  }, [fetchInquiries]);

  const move = useCallback(
    async (id: string, newStatus: InquiryStatus) => {
      let changed = false;
      setInquiries((prev) =>
        prev.map((i) => {
          if (i.id === id && normalizeStatus(i.status) !== newStatus) {
            changed = true;
            return { ...i, status: newStatus };
          }
          return i;
        })
      );
      if (!changed) return;

      try {
        const res = await fetch(`/api/inquiries/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Update failed");
        }
        toast.success(`Moved to ${STATUS_LABELS[newStatus]}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
        fetchInquiries(); // revert to server truth
      }
    },
    [fetchInquiries]
  );

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inquiries</h1>
        <p className="text-sm text-muted-foreground">
          Inbound rental requests from hdrsiteservices.com · drag a card to move it
          through the pipeline
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
          {INQUIRY_STATUSES.map((status) => {
            const items = inquiries.filter(
              (i) => normalizeStatus(i.status) === status
            );
            const accent = COLUMN_ACCENT[status];
            const isOver = dragOverCol === status;
            return (
              <div
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverCol !== status) setDragOverCol(status);
                }}
                onDragLeave={() =>
                  setDragOverCol((c) => (c === status ? null : c))
                }
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  setDragOverCol(null);
                  if (id) move(id, status);
                }}
                className={`flex w-[270px] shrink-0 flex-col rounded-lg border bg-muted/30 ${
                  isOver ? `ring-2 ${accent.ring}` : ""
                }`}
              >
                <div className="flex items-center gap-2 border-b px-3 py-2.5">
                  <span className={`size-2 rounded-full ${accent.dot}`} />
                  <span className="text-sm font-semibold">
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="ml-auto text-xs font-medium text-muted-foreground">
                    {items.length}
                  </span>
                </div>

                <div className="flex-1 space-y-2 p-2">
                  {items.length === 0 && (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                      Drop cards here
                    </p>
                  )}
                  {items.map((inq) => (
                    <div
                      key={inq.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", inq.id);
                        e.dataTransfer.effectAllowed = "move";
                        draggedRef.current = true;
                      }}
                      onDragEnd={() => {
                        // Defer so the synthetic click (if any) is suppressed.
                        setTimeout(() => {
                          draggedRef.current = false;
                        }, 0);
                      }}
                      onClick={() => {
                        if (draggedRef.current) return;
                        router.push(`/${entityId}/inquiries/${inq.id}`);
                      }}
                      className="cursor-pointer rounded-md border bg-card p-2.5 text-sm shadow-sm transition-shadow hover:shadow-md"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {inq.reference}
                        </span>
                        {inq.units != null && (
                          <span className="text-[11px] text-muted-foreground">
                            {inq.units} unit{inq.units === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-medium leading-tight">
                        {inq.name || "—"}
                      </div>
                      {inq.use_case && (
                        <div className="text-xs text-muted-foreground">
                          {inq.use_case}
                        </div>
                      )}
                      {inq.location && (
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          📍 {inq.location}
                        </div>
                      )}
                      {inq.start_date && (
                        <div className="text-xs text-muted-foreground">
                          🗓 {inq.start_date}
                          {inq.end_date ? ` → ${inq.end_date}` : ""}
                        </div>
                      )}
                      <div className="mt-1.5 text-[11px] text-muted-foreground">
                        {formatDateTime(inq.last_activity_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
