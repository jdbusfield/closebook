"use client";

// The "Email funnel" block in the inquiry drawer: put this customer on an
// automated follow-up sequence, see exactly which emails will go out and when,
// and watch/stop/resume the running chain. A customer reply pauses the funnel
// automatically (and opens a follow-up task); booking or losing the inquiry
// stops it.

import { useState } from "react";
import {
  Zap,
  Square,
  Play,
  ChevronLeft,
  Mail,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFunnels } from "@/lib/inquiries/use-funnels";
import {
  ENROLLMENT_STATUS_CLASS,
  ENROLLMENT_STATUS_LABEL,
  schedulePreview,
  type Funnel,
} from "@/lib/inquiries/funnels";
import { renderTemplate, type MessageTemplate } from "@/lib/inquiries/templates";
import { isOpenStatus, fmtDate, type Inquiry } from "@/lib/inquiries/shared";

function fmtWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FunnelBlock({
  inquiry,
  entityId,
  actor = "You",
}: {
  inquiry: Inquiry;
  entityId: string;
  actor?: string;
}) {
  const fn = useFunnels(entityId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidate, setCandidate] = useState<Funnel | null>(null);
  const [starting, setStarting] = useState(false);

  const enrollment = fn.enrollmentFor(inquiry.id);
  const enrolledFunnel = enrollment
    ? fn.allFunnels.find((f) => f.id === enrollment.funnel_id)
    : undefined;
  const open = isOpenStatus(inquiry.status ?? "new");

  const start = async () => {
    if (!candidate) return;
    setStarting(true);
    const ok = await fn.enroll(inquiry.id, candidate.id, actor);
    setStarting(false);
    if (ok) {
      setPickerOpen(false);
      setCandidate(null);
    }
  };

  // --- A live/paused/finished enrollment: status + controls -----------------
  if (enrollment && enrollment.status !== "stopped") {
    const steps = fn.stepsFor(enrollment.funnel_id);
    const total = steps.length;
    return (
      <div className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${ENROLLMENT_STATUS_CLASS[enrollment.status]}`}
          >
            <Zap className="size-3" />
            {ENROLLMENT_STATUS_LABEL[enrollment.status]}
          </span>
          <span className="text-sm font-medium">{enrolledFunnel?.name ?? "Funnel"}</span>
          <span className="text-xs text-muted-foreground">
            {enrollment.steps_sent} of {total || "?"} sent
            {enrollment.status === "active" && enrollment.next_send_at
              ? ` · next ${fmtWhen(new Date(enrollment.next_send_at))}`
              : ""}
          </span>
          <div className="ml-auto flex gap-1">
            {enrollment.status === "paused_replied" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => fn.resumeEnrollment(enrollment.id)}
              >
                <Play className="size-3.5" /> Resume
              </Button>
            )}
            {(enrollment.status === "active" || enrollment.status === "paused_replied") && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => fn.stopEnrollment(enrollment.id)}
              >
                <Square className="size-3.5" /> Stop
              </Button>
            )}
          </div>
        </div>
        {enrollment.status === "paused_replied" && (
          <p className="mt-2 text-xs text-muted-foreground">
            The customer wrote back, so the remaining emails are on hold — reply personally,
            then resume the funnel if they go quiet again.
          </p>
        )}
        {enrollment.status === "completed" && open && (
          <div className="mt-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setPickerOpen(true)}
            >
              <Zap className="size-3.5" /> Start another funnel
            </Button>
          </div>
        )}
        <StartDialog
          open={pickerOpen}
          onOpenChange={(o) => {
            setPickerOpen(o);
            if (!o) setCandidate(null);
          }}
          fn={fn}
          inquiry={inquiry}
          candidate={candidate}
          setCandidate={setCandidate}
          onStart={start}
          starting={starting}
        />
      </div>
    );
  }

  // --- Nothing running: offer to start ---------------------------------------
  if (!open) {
    return (
      <p className="text-xs text-muted-foreground">
        Funnels run on open inquiries only (New / Quoted / Follow-Up).
      </p>
    );
  }
  if (!inquiry.email) {
    return (
      <p className="text-xs text-muted-foreground">
        Add an email address to this inquiry to start a funnel.
      </p>
    );
  }

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setPickerOpen(true)}
      >
        <Zap className="size-4 text-amber-500" /> Start a funnel
      </Button>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Automated follow-up emails on a schedule. Stops on its own the moment they reply.
      </p>
      <StartDialog
        open={pickerOpen}
        onOpenChange={(o) => {
          setPickerOpen(o);
          if (!o) setCandidate(null);
        }}
        fn={fn}
        inquiry={inquiry}
        candidate={candidate}
        setCandidate={setCandidate}
        onStart={start}
        starting={starting}
      />
    </div>
  );
}

function StartDialog({
  open,
  onOpenChange,
  fn,
  inquiry,
  candidate,
  setCandidate,
  onStart,
  starting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fn: ReturnType<typeof useFunnels>;
  inquiry: Inquiry;
  candidate: Funnel | null;
  setCandidate: (f: Funnel | null) => void;
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-4 text-amber-500" />
            {candidate ? candidate.name : "Start a funnel"}
          </DialogTitle>
        </DialogHeader>

        {!candidate ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Pick a sequence for {inquiry.name || "this customer"}
              {inquiry.start_date ? ` (${fmtDate(inquiry.start_date)})` : ""}. You&apos;ll see
              the exact schedule before anything sends.
            </p>
            {fn.funnels.map((f) => {
              const steps = fn.stepsFor(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setCandidate(f)}
                  className="w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{f.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {steps.length} email{steps.length === 1 ? "" : "s"} ·{" "}
                      {steps.map((s) => (s.day_offset === 0 ? "now" : `d${s.day_offset}`)).join(" / ")}
                    </span>
                  </div>
                  {f.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>
                  )}
                </button>
              );
            })}
            {fn.funnels.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No funnels set up yet — build one on the Templates tab.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setCandidate(null)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" /> All funnels
            </button>
            <div className="space-y-2">
              {schedulePreview(fn.stepsFor(candidate.id)).map(({ step, at }, i) => {
                const tpl: MessageTemplate = {
                  id: step.id,
                  label: "",
                  channel: "email",
                  track: "general",
                  stages: [],
                  subject: step.subject,
                  body: step.body,
                };
                const rendered = renderTemplate(tpl, inquiry, "");
                return (
                  <div key={step.id} className="rounded-lg border p-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Mail className="size-3.5" />
                      <span className="font-medium text-foreground">
                        {i + 1}. {rendered.subject || "(no subject)"}
                      </span>
                      <span className="ml-auto inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        {step.day_offset === 0 ? "sends immediately" : fmtWhen(at)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                      {rendered.body}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Sends to <span className="font-medium">{inquiry.email}</span> from the brand
              inbox. The chain breaks automatically if they reply, and a follow-up task brings
              a human in.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={onStart} disabled={starting} className="gap-1.5">
                <Zap className="size-3.5" />
                {starting ? "Starting…" : "Start funnel"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
