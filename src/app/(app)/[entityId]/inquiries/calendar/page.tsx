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
  STAGES,
  STAGE_BY_KEY,
  normalizeStatus,
  parseDate,
  toISODate,
  today,
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
  color: string;
}

export default function InquiriesCalendarPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const data = useInquiries(entityId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const t0 = today();
  const [cursor, setCursor] = useState(() => new Date(t0.getFullYear(), t0.getMonth(), 1));

  const callbacks: DrawerCallbacks = {
    onMove: data.moveStage,
    onSetValue: data.setEstimatedValue,
    onSaveBilling: (id, billingName, billingAddress) =>
      data.updateTriage(
        id,
        { billing_name: billingName, billing_address: billingAddress },
        "Bill-to saved"
      ),
    onAddTask: data.addTask,
    onToggleTask: data.toggleTask,
    onAddActivity: data.addActivity,
    onDeleteActivity: data.deleteActivity,
    onAddQuote: data.addQuote,
    onUpdateQuoteStatus: data.updateQuoteStatus,
    onDeleteQuote: data.deleteQuote,
  };
  const selected = data.inquiries.find((i) => i.id === selectedId) ?? null;

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // Every non-lost inquiry that has a start date, plotted from start → end and
  // colored by its pipeline stage.
  const reservations: Res[] = useMemo(() => {
    return data.inquiries
      .filter((i) => i.status !== "lost" && parseDate(i.start_date))
      .map((inq) => {
        const s = parseDate(inq.start_date)!;
        const e = parseDate(inq.end_date) || s;
        return {
          inq,
          startIso: toISODate(s),
          endIso: toISODate(e < s ? s : e),
          color: STAGE_BY_KEY[normalizeStatus(inq.status)].color,
        };
      });
  }, [data.inquiries]);

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
        <h1 className="text-2xl font-semibold tracking-tight">Rental calendar</h1>
        <p className="text-sm text-muted-foreground">
          Rentals by date, colored by pipeline stage
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
          {monthResCount} rental{monthResCount === 1 ? "" : "s"} this month
        </span>

        {/* Stage legend */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {STAGES.map((s) => (
            <span
              key={s.key}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
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
                      return (
                        <button
                          key={r.inq.id}
                          onClick={() => setSelectedId(r.inq.id)}
                          title={`${r.inq.name ?? "Inquiry"} · ${STAGE_BY_KEY[normalizeStatus(r.inq.status)].label}`}
                          className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] font-medium"
                          style={{
                            background: hexA(r.color, 0.12),
                            color: r.color,
                            borderLeft: isStart ? `3px solid ${r.color}` : undefined,
                            opacity: isEnd && !isStart ? 0.72 : 1,
                          }}
                        >
                          {isStart && <ArrowUp className="size-3 shrink-0" />}
                          {isEnd && !isStart && <ArrowDown className="size-3 shrink-0" />}
                          <span className="truncate">
                            {isEnd && !isStart
                              ? `Return · ${r.inq.name ?? "rental"}`
                              : r.inq.name ?? "Inquiry"}
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
          <ArrowUp className="size-3.5" /> Rental start
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ArrowDown className="size-3.5" /> Rental end
        </span>
        <span>Bars span the full rental window · click any to open</span>
      </div>

      <InquiryDrawer
        inquiry={selected}
        entityId={entityId}
        onClose={() => setSelectedId(null)}
        callbacks={callbacks}
        actor={data.actor}
      />
    </div>
  );
}
