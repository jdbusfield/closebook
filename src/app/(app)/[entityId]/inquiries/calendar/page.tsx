"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { useInquiries } from "@/lib/inquiries/use-inquiries";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { InquiryDrawer, type DrawerCallbacks } from "@/components/inquiries/detail-drawer";
import { hexA } from "@/components/inquiries/atoms";
import { Button } from "@/components/ui/button";
import {
  type Inquiry,
  FLEET,
  FLEET_BY_ID,
  parseDate,
  toISODate,
  today,
  isReservation,
} from "@/lib/inquiries/shared";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Res {
  inq: Inquiry;
  startIso: string;
  endIso: string;
  unitColor: string;
}

export default function InquiriesCalendarPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const data = useInquiries(entityId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const t0 = today();
  const [cursor, setCursor] = useState(() => new Date(t0.getFullYear(), t0.getMonth(), 1));

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

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const reservations: Res[] = useMemo(() => {
    return data.inquiries
      .filter(isReservation)
      .filter((i) => unitFilter === "all" || i.unit_id === unitFilter)
      .map((inq) => {
        const s = parseDate(inq.start_date)!;
        const e = parseDate(inq.end_date) || s;
        const u = inq.unit_id ? FLEET_BY_ID[inq.unit_id] : null;
        return {
          inq,
          startIso: toISODate(s),
          endIso: toISODate(e < s ? s : e),
          unitColor: u?.color || "#64748b",
        };
      });
  }, [data.inquiries, unitFilter]);

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return d;
    });
  }, [year, month]);

  const todayIso = toISODate(t0);
  const monthResCount = reservations.filter((r) => {
    const s = parseDate(r.startIso)!;
    const e = parseDate(r.endIso)!;
    return (
      (s.getFullYear() === year && s.getMonth() === month) ||
      (e.getFullYear() === year && e.getMonth() === month)
    );
  }).length;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reservation calendar</h1>
        <p className="text-sm text-muted-foreground">
          Deliveries &amp; returns across the fleet
        </p>
      </div>
      <SectionTabs entityId={entityId} />

      {/* Control bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
        <h2 className="min-w-[170px] text-lg font-bold">
          {MONTHS[month]} {year}
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCursor(new Date(t0.getFullYear(), t0.getMonth(), 1))}
        >
          Today
        </Button>
        <span className="text-xs font-medium text-muted-foreground">
          {monthResCount} reservation{monthResCount === 1 ? "" : "s"} this month
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setUnitFilter("all")}
            className={`rounded px-2 py-1 text-xs font-medium ${
              unitFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            All units
          </button>
          {FLEET.map((u) => (
            <button
              key={u.id}
              onClick={() => setUnitFilter(unitFilter === u.id ? "all" : u.id)}
              className="inline-flex items-center gap-1.5 px-1.5 py-1 text-xs"
              style={{ opacity: unitFilter === "all" || unitFilter === u.id ? 1 : 0.4 }}
            >
              <span className="size-2 rounded-full" style={{ background: u.color }} />
              {u.name}
            </button>
          ))}
        </div>
      </div>

      {data.loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-[11px] font-semibold uppercase text-muted-foreground">
            {DOW.map((d) => (
              <div key={d} className="px-2 py-1.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              const dayIso = toISODate(d);
              const oth = d.getMonth() !== month;
              const isToday = dayIso === todayIso;
              const evs = reservations
                .filter((r) => dayIso >= r.startIso && dayIso <= r.endIso)
                .sort((a, b) => a.startIso.localeCompare(b.startIso));
              return (
                <div
                  key={i}
                  className={`min-h-[112px] border-b border-r p-1 last:border-r-0 ${
                    oth ? "bg-muted/20 text-muted-foreground" : ""
                  } ${isToday ? "bg-primary/5" : ""}`}
                >
                  <div
                    className={`flex size-6 items-center justify-center rounded-full text-xs ${
                      isToday ? "bg-primary font-semibold text-primary-foreground" : ""
                    }`}
                  >
                    {d.getDate()}
                  </div>
                  <div className="mt-1 space-y-1">
                    {evs.map((r) => {
                      const isStart = dayIso === r.startIso;
                      const isEnd = dayIso === r.endIso;
                      const u = r.inq.unit_id ? FLEET_BY_ID[r.inq.unit_id] : null;
                      return (
                        <button
                          key={r.inq.id}
                          onClick={() => setSelectedId(r.inq.id)}
                          title={`${r.inq.name} · ${u?.name ?? ""}`}
                          className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] font-medium"
                          style={{
                            background: hexA(r.unitColor, 0.12),
                            color: r.unitColor,
                            borderLeft: isStart ? `3px solid ${r.unitColor}` : undefined,
                            opacity: isEnd && !isStart ? 0.72 : 1,
                          }}
                        >
                          {isStart && <ArrowUp className="size-3 shrink-0" />}
                          {isEnd && !isStart && <ArrowDown className="size-3 shrink-0" />}
                          <span className="truncate">
                            {isStart
                              ? r.inq.name
                              : isEnd
                                ? `Return · ${u?.name ?? "unit"}`
                                : r.inq.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ArrowUp className="size-3.5" /> Delivery (out)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ArrowDown className="size-3.5" /> Return (pickup)
        </span>
        <span>Bars span the full rental window · click any to open</span>
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
