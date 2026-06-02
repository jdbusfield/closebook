"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useInquiries } from "@/lib/inquiries/use-inquiries";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { InquiryDrawer, type DrawerCallbacks } from "@/components/inquiries/detail-drawer";
import { hexA } from "@/components/inquiries/atoms";
import {
  type Inquiry,
  FLEET,
  fmtDate,
  relDays,
  toISODate,
  today,
  parseDate,
  isBookedStatus,
} from "@/lib/inquiries/shared";

export default function InquiriesFleetPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const data = useInquiries(entityId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const callbacks: DrawerCallbacks = {
    onMove: data.moveStage,
    onAssignUnit: data.assignUnit,
    onSetValue: data.setEstimatedValue,
    onAddTask: data.addTask,
    onToggleTask: data.toggleTask,
    onAddActivity: data.addActivity,
    onDeleteActivity: data.deleteActivity,
  };
  const selected = data.inquiries.find((i) => i.id === selectedId) ?? null;
  const todayIso = toISODate(today());

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fleet</h1>
        <p className="text-sm text-muted-foreground">
          {FLEET.length} units · at-a-glance availability
        </p>
      </div>
      <SectionTabs entityId={entityId} />

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {FLEET.map((u) => {
          const bookings = data.inquiries
            .filter((i) => i.unit_id === u.id && isBookedStatus(i.status))
            .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));

          const outNow = bookings.find((i) => {
            const s = parseDate(i.start_date);
            const e = parseDate(i.end_date) || s;
            if (!s) return false;
            return (
              todayIso >= toISODate(s) &&
              todayIso <= toISODate(e || s) &&
              i.status !== "returned"
            );
          });
          const next = bookings.find((i) => {
            const s = parseDate(i.start_date);
            return s && toISODate(s) > todayIso && i.status === "confirmed";
          });
          const onRental = !!outNow;

          return (
            <div key={u.id} className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono font-semibold">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.config}</div>
                </div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={
                    onRental
                      ? { background: hexA(u.color, 0.12), color: u.color }
                      : { background: "var(--muted)", color: "var(--muted-foreground)" }
                  }
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: onRental ? u.color : "#94a3b8" }}
                  />
                  {onRental ? "On rental" : "In yard"}
                </span>
              </div>

              <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">{u.note}</div>

              {outNow ? (
                <BookingLine
                  inq={outNow}
                  label="OUT NOW"
                  labelColor={u.color}
                  sub={`back ${relDays(outNow.end_date || outNow.start_date)}`}
                  onClick={() => setSelectedId(outNow.id)}
                />
              ) : next ? (
                <BookingLine
                  inq={next}
                  label="NEXT OUT"
                  sub={`${fmtDate(next.start_date)} · ${relDays(next.start_date)}`}
                  onClick={() => setSelectedId(next.id)}
                />
              ) : (
                <div className="mt-2 text-xs text-muted-foreground">No upcoming bookings.</div>
              )}
            </div>
          );
        })}
      </div>

      <InquiryDrawer
        inquiry={selected}
        entityId={entityId}
        onClose={() => setSelectedId(null)}
        callbacks={callbacks}
      />
    </div>
  );
}

function BookingLine({
  inq,
  label,
  labelColor,
  sub,
  onClick,
}: {
  inq: Inquiry;
  label: string;
  labelColor?: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="mt-3 block w-full text-left">
      <div
        className="text-[11px] font-semibold"
        style={labelColor ? { color: labelColor } : undefined}
      >
        {label}
      </div>
      <div className="text-sm font-semibold">{inq.name}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </button>
  );
}
