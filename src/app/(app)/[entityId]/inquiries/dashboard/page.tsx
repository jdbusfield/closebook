"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Inbox,
  Truck,
  DollarSign,
  Flame,
  ArrowUp,
  ArrowDown,
  Phone,
  Mail,
  FileText,
} from "lucide-react";
import { useInquiries } from "@/lib/inquiries/use-inquiries";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { InquiryDrawer, type DrawerCallbacks } from "@/components/inquiries/detail-drawer";
import {
  KPI,
  StagePill,
  DueBadge,
  InquiryAvatar,
} from "@/components/inquiries/atoms";
import {
  type Inquiry,
  type InquiryTask,
  fmtMoney,
  fmtDate,
  relDays,
  daysBetween,
  daysStale,
  today,
  parseDate,
  isOpenStatus,
  isReservation,
} from "@/lib/inquiries/shared";

const KIND_ICON = { call: Phone, quote: FileText, email: Mail, logistics: Truck };

export default function InquiriesDashboardPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const data = useInquiries(entityId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const callbacks: DrawerCallbacks = {
    onMove: data.moveStage,
    onSetValue: data.setEstimatedValue,
    onAddTask: data.addTask,
    onToggleTask: data.toggleTask,
    onAddActivity: data.addActivity,
    onDeleteActivity: data.deleteActivity,
  };
  const selected = data.inquiries.find((i) => i.id === selectedId) ?? null;

  const m = useMemo(() => {
    const inquiries = data.inquiries;
    const open = inquiries.filter((i) => isOpenStatus(i.status));

    // Flatten open tasks tied to their deal.
    const openTasks: { task: InquiryTask; inq: Inquiry }[] = [];
    inquiries.forEach((inq) =>
      (inq.tasks || []).forEach((t) => {
        if (!t.done) openTasks.push({ task: t, inq });
      })
    );
    openTasks.sort((a, b) =>
      (a.task.due_date || "9999").localeCompare(b.task.due_date || "9999")
    );

    const overdue = openTasks.filter((r) => {
      const d = parseDate(r.task.due_date);
      return d && daysBetween(today(), d) < 0;
    }).length;
    const dueToday = openTasks.filter((r) => {
      const d = parseDate(r.task.due_date);
      return d && daysBetween(today(), d) === 0;
    }).length;

    const pipelineVal = open.reduce((s, i) => s + (i.estimated_value || 0), 0);
    const outNow = inquiries.filter((i) => i.status === "out");
    const dueBack = outNow.filter((i) => {
      const d = parseDate(i.end_date);
      return d && daysBetween(today(), d) <= 3;
    }).length;
    const confirmedSoon = inquiries.filter((i) => {
      if (i.status !== "confirmed") return false;
      const d = parseDate(i.start_date);
      return d && daysBetween(today(), d) <= 7;
    }).length;

    // Going cold: open deals with no activity in 5+ days.
    const cold = inquiries
      .filter((i) => isOpenStatus(i.status))
      .map((i) => ({ inq: i, stale: daysStale(i) }))
      .filter((x) => x.stale >= 5)
      .sort((a, b) => b.stale - a.stale);

    // Delivery & pickup schedule for reservations within -2..+21 days.
    const sched: { kind: "out" | "back"; date: string; inq: Inquiry }[] = [];
    inquiries.filter(isReservation).forEach((inq) => {
      const s = parseDate(inq.start_date);
      const e = parseDate(inq.end_date);
      if (s) {
        const n = daysBetween(today(), s);
        if (n >= -2 && n <= 21) sched.push({ kind: "out", date: inq.start_date!, inq });
      }
      if (e) {
        const n = daysBetween(today(), e);
        if (n >= -2 && n <= 21) sched.push({ kind: "back", date: inq.end_date!, inq });
      }
    });
    sched.sort(
      (a, b) => a.date.localeCompare(b.date) || (a.kind === "out" ? -1 : 1)
    );

    return {
      open,
      openTasks,
      overdue,
      dueToday,
      pipelineVal,
      outNow: outNow.length,
      dueBack,
      confirmedSoon,
      cold,
      sched,
    };
  }, [data.inquiries]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sales dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {today().toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}{" "}
          · never drop a follow-up
        </p>
      </div>
      <SectionTabs entityId={entityId} openCount={m.open.length} overdueCount={m.overdue} />

      {data.loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            <KPI
              icon={AlertTriangle}
              label="Overdue follow-ups"
              value={m.overdue}
              flag={m.overdue > 0}
              foot={m.overdue > 0 ? "Act today — quotes go stale" : "Nothing overdue"}
              footTone={m.overdue > 0 ? "danger" : "ok"}
            />
            <KPI
              icon={Inbox}
              label="Open inquiries"
              value={m.open.length}
              foot={`${m.dueToday} due to contact today`}
              footTone={m.dueToday ? "warn" : "muted"}
            />
            <KPI
              icon={Truck}
              label="Out / due back"
              value={m.outNow}
              foot={`${m.dueBack} returning ≤3 days`}
            />
            <KPI
              icon={DollarSign}
              label="Open pipeline"
              value={fmtMoney(m.pipelineVal)}
              foot={`${m.confirmedSoon} confirmed delivering ≤7 days`}
              footTone="ok"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div className="space-y-4">
              {/* Follow-up queue */}
              <div className="rounded-lg border bg-card shadow-sm">
                <div className="flex items-center gap-2 border-b px-4 py-3">
                  <h3 className="text-sm font-semibold">Follow-up queue</h3>
                  {m.overdue > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                      <AlertTriangle className="size-3" /> {m.overdue} overdue
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {m.openTasks.length} open
                  </span>
                </div>
                {m.openTasks.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    All caught up. No open follow-ups. 🎉
                  </p>
                ) : (
                  <div className="divide-y">
                    {m.openTasks.map(({ task, inq }) => {
                      const Icon = KIND_ICON[task.kind] || FileText;
                      return (
                        <div
                          key={task.id}
                          onClick={() => setSelectedId(inq.id)}
                          className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/40"
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              data.toggleTask(task.id, true);
                            }}
                            className="size-[18px] shrink-0 rounded border border-muted-foreground/40 hover:border-emerald-600"
                            aria-label="Mark done"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{task.title}</div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                              <span className="inline-flex items-center gap-1 font-semibold text-foreground/80">
                                <Icon className="size-3" />
                                {inq.name}
                              </span>
                              <span className="text-muted-foreground">
                                · {inq.use_case || "Inquiry"}
                                {inq.start_date ? ` · ${fmtDate(inq.start_date)}` : ""}
                              </span>
                              <StagePill status={inq.status} />
                            </div>
                          </div>
                          <DueBadge due={task.due_date} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Going cold */}
              {m.cold.length > 0 && (
                <div className="rounded-lg border bg-card shadow-sm">
                  <div className="flex items-center gap-2 border-b px-4 py-3">
                    <Flame className="size-4 text-amber-600" />
                    <h3 className="text-sm font-semibold">Going cold</h3>
                    <span className="ml-auto text-xs text-muted-foreground">
                      no contact in 5+ days
                    </span>
                  </div>
                  <div className="divide-y">
                    {m.cold.map(({ inq, stale }) => (
                      <div
                        key={inq.id}
                        onClick={() => setSelectedId(inq.id)}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/40"
                      >
                        <InquiryAvatar name={inq.name} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {inq.name}{" "}
                            <span className="text-xs font-normal text-muted-foreground">
                              · {inq.use_case}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs">
                            <StagePill status={inq.status} />
                            <span className="text-muted-foreground">
                              {fmtMoney(inq.estimated_value)} est.
                            </span>
                          </div>
                        </div>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                          {stale}d cold
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Delivery & pickup schedule */}
            <div className="rounded-lg border bg-card shadow-sm">
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <Truck className="size-4" />
                <h3 className="text-sm font-semibold">Delivery &amp; pickup schedule</h3>
                <span className="ml-auto text-xs text-muted-foreground">next 3 weeks</span>
              </div>
              {m.sched.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nothing scheduled. Confirmed rentals with dates show up here.
                </p>
              ) : (
                <div className="divide-y">
                  {m.sched.map((it, i) => {
                    const isOut = it.kind === "out";
                    return (
                      <div
                        key={`${it.inq.id}-${it.kind}-${i}`}
                        onClick={() => setSelectedId(it.inq.id)}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/40"
                      >
                        <div
                          className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${
                            isOut
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {isOut ? (
                            <ArrowUp className="size-4" />
                          ) : (
                            <ArrowDown className="size-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">
                            {isOut ? "Deliver" : "Pick up"} · {it.inq.name}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs">
                            <StagePill status={it.inq.status} />
                            <span className="truncate text-muted-foreground">
                              {it.inq.location}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-xs font-semibold">
                            {fmtDate(it.date, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {relDays(it.date)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <InquiryDrawer
        inquiry={selected}
        entityId={entityId}
        onClose={() => setSelectedId(null)}
        callbacks={callbacks}
      />
    </div>
  );
}
