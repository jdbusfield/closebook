"use client";

// The "Email funnel" block in the inquiry drawer: put this customer on an
// automated follow-up sequence, see exactly which emails will go out and when,
// and watch/stop/resume the running chain. A customer reply pauses the funnel
// automatically (and opens a follow-up task); booking or losing the inquiry
// stops it.

import { useEffect, useState } from "react";
import {
  Zap,
  Square,
  Play,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Mail,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  needsOutreachStatus,
  fmtDate,
  fmtMoney,
  funnelThreadAnchor,
  quoteEmailBlock,
  type Inquiry,
  type InquiryQuote,
} from "@/lib/inquiries/shared";
import type { FunnelStep } from "@/lib/inquiries/funnels";

// Does any step of this funnel merge the saved quote in? (Client twin of the
// server check in funnel-send.ts.)
function usesQuote(steps: Pick<FunnelStep, "subject" | "body">[]): boolean {
  return steps.some((s) => s.body.includes("{quote}") || (s.subject ?? "").includes("{quote"));
}

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
  onSaveDetails,
}: {
  inquiry: Inquiry;
  entityId: string;
  actor?: string;
  onSaveDetails?: (id: string, patch: Record<string, unknown>) => void | Promise<void>;
}) {
  const fn = useFunnels(entityId);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [candidate, setCandidate] = useState<Funnel | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(inquiry.name ?? "");
  const [greetingDraft, setGreetingDraft] = useState("");
  const [greetingEdited, setGreetingEdited] = useState(false);
  const [starting, setStarting] = useState(false);

  // Seed the drafts on every open (the drawer reuses one mounted instance
  // across inquiry selections). An existing greeting override counts as
  // "edited" so re-opening the dialog never clobbers it.
  const openPicker = () => {
    setNameDraft(inquiry.name ?? "");
    setGreetingDraft(inquiry.greeting_name?.trim() ?? "");
    setGreetingEdited(!!inquiry.greeting_name?.trim());
    setPickerOpen(true);
  };

  // Until the greeting is touched, it tracks the name's first word — the same
  // default the send would use. Once touched, it's used verbatim.
  const fallbackName = nameDraft.trim() || inquiry.name?.trim() || "";
  const greeting = greetingEdited
    ? greetingDraft
    : fallbackName.split(/\s+/)[0] ?? "";
  const setGreeting = (v: string) => {
    setGreetingDraft(v);
    setGreetingEdited(true);
  };

  const enrollment = fn.enrollmentFor(inquiry.id);
  const enrolledFunnel = enrollment
    ? fn.allFunnels.find((f) => f.id === enrollment.funnel_id)
    : undefined;
  const open = needsOutreachStatus(inquiry.status ?? "new");

  const start = async () => {
    if (!candidate) return;
    setStarting(true);
    // Persist name/greeting edits BEFORE enrolling — the day-0 send (and every
    // cron send after it) reads the inquiry fresh from the DB.
    if (onSaveDetails) {
      const patch: Record<string, unknown> = {};
      const trimmed = nameDraft.trim();
      if (trimmed && trimmed !== (inquiry.name ?? "").trim()) patch.name = trimmed;
      // Only store an override that actually differs from the first-word
      // default; matching it again clears any override already on the row.
      const wanted = greeting.trim();
      const fallback = (trimmed || inquiry.name?.trim() || "").split(/\s+/)[0] ?? "";
      const stored = inquiry.greeting_name?.trim() ?? "";
      if (wanted && wanted !== fallback) {
        if (wanted !== stored) patch.greeting_name = wanted;
      } else if (stored) {
        patch.greeting_name = null;
      }
      if (Object.keys(patch).length > 0) await onSaveDetails(inquiry.id, patch);
    }
    const ok = await fn.enroll(inquiry.id, candidate.id, actor, quoteId);
    setStarting(false);
    if (ok) {
      setPickerOpen(false);
      setCandidate(null);
      setQuoteId(null);
    }
  };

  const pickCandidate = (f: Funnel | null) => {
    setCandidate(f);
    // Default the quote to the inquiry's latest whenever the funnel merges one in.
    setQuoteId(f && usesQuote(fn.stepsFor(f.id)) ? (inquiry.quotes?.[0]?.id ?? null) : null);
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
              onClick={openPicker}
            >
              <Zap className="size-3.5" /> Start another funnel
            </Button>
          </div>
        )}
        <StartDialog
          open={pickerOpen}
          onOpenChange={(o) => {
            setPickerOpen(o);
            if (!o) pickCandidate(null);
          }}
          fn={fn}
          inquiry={inquiry}
          candidate={candidate}
          setCandidate={pickCandidate}
          quoteId={quoteId}
          setQuoteId={setQuoteId}
          name={nameDraft}
          setName={setNameDraft}
          greeting={greeting}
          setGreeting={setGreeting}
          canEditName={!!onSaveDetails}
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
        onClick={openPicker}
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
          if (!o) pickCandidate(null);
        }}
        fn={fn}
        inquiry={inquiry}
        candidate={candidate}
        setCandidate={pickCandidate}
        quoteId={quoteId}
        setQuoteId={setQuoteId}
        name={nameDraft}
        setName={setNameDraft}
        greeting={greeting}
        setGreeting={setGreeting}
        canEditName={!!onSaveDetails}
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
  quoteId,
  setQuoteId,
  name,
  setName,
  greeting,
  setGreeting,
  canEditName,
  onStart,
  starting,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  fn: ReturnType<typeof useFunnels>;
  inquiry: Inquiry;
  candidate: Funnel | null;
  setCandidate: (f: Funnel | null) => void;
  quoteId: string | null;
  setQuoteId: (id: string | null) => void;
  name: string;
  setName: (v: string) => void;
  greeting: string;
  setGreeting: (v: string) => void;
  canEditName: boolean;
  onStart: () => void;
  starting: boolean;
}) {
  const quotes: InquiryQuote[] = inquiry.quotes ?? [];
  // The previews render with the edited name and greeting, so what you read
  // here is exactly what sends.
  const previewInquiry: Inquiry = {
    ...inquiry,
    name: name.trim() || inquiry.name,
    greeting_name: greeting.trim() || null,
  };
  const candidateSteps = candidate ? fn.stepsFor(candidate.id) : [];
  const needsQuote = candidate ? usesQuote(candidateSteps) : false;
  const selectedQuote = quotes.find((q) => q.id === quoteId) ?? null;
  const missingQuote = needsQuote && !selectedQuote;
  const extra = selectedQuote
    ? { quote: quoteEmailBlock(selectedQuote), quote_number: selectedQuote.quote_number }
    : undefined;
  // Same anchor rule as the server send: when the customer already has an email
  // thread, every funnel email goes out as a reply on it ("Re: <thread>").
  const anchor = funnelThreadAnchor(inquiry.messages ?? []);
  // Which step's full email is open in the preview; null = the first step.
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    setExpanded(null);
  }, [candidate?.id]);
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
                    {usesQuote(steps) && (
                      <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[11px] font-medium text-emerald-700">
                        sends your quote
                      </span>
                    )}
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

            {/* Name + greeting — fix a bad captured name, or a first name the
                first-word default splits wrong ("La Trina"), before sending */}
            {canEditName && (
              <div className="rounded-lg border bg-muted/30 p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      Customer name
                    </span>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Full name"
                      className="h-8"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">
                      Greeting
                    </span>
                    <Input
                      value={greeting}
                      onChange={(e) => setGreeting(e.target.value)}
                      placeholder="First name"
                      className="h-8"
                    />
                  </label>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Emails open with{" "}
                  <span className="font-medium text-foreground">
                    &quot;Hi {greeting.trim() || "there"},&quot;
                  </span>{" "}
                  — type it exactly, spaces and all. Saves to this inquiry when the
                  funnel starts.
                </p>
              </div>
            )}

            {/* Quote rider — shown when any step merges {quote} in */}
            {needsQuote &&
              (quotes.length > 0 ? (
                <div className="rounded-lg border bg-muted/30 p-2.5">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                    This funnel sends a quote (itemized in the email + attached as a PDF) —
                    which one?
                  </div>
                  <div className="space-y-1">
                    {quotes.map((q) => (
                      <label
                        key={q.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60"
                      >
                        <input
                          type="radio"
                          name="funnel-quote"
                          checked={quoteId === q.id}
                          onChange={() => setQuoteId(q.id)}
                        />
                        <span className="font-mono text-xs">{q.quote_number}</span>
                        <span className="font-medium">{fmtMoney(q.total)}</span>
                        <span className="text-xs capitalize text-muted-foreground">
                          {q.status} · {fmtDate(q.created_at)}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                  This funnel sends your quote, but this inquiry has none saved yet. Close this,
                  use &quot;Draft a Quote&quot;, then come back.
                </div>
              ))}

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
                const rendered = renderTemplate(tpl, previewInquiry, "", extra);
                const subject = anchor?.subject || rendered.subject || "(no subject)";
                const isExpanded = expanded === null ? i === 0 : expanded === step.id;
                return (
                  <div key={step.id} className="rounded-lg border">
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? "" : step.id)}
                      className="flex w-full items-center gap-2 p-2.5 text-left text-xs text-muted-foreground"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0" />
                      )}
                      <Mail className="size-3.5 shrink-0" />
                      <span className="font-medium text-foreground">
                        {i + 1}. {subject}
                      </span>
                      <span className="ml-auto inline-flex shrink-0 items-center gap-1">
                        <Clock className="size-3" />
                        {step.day_offset === 0 ? "sends immediately" : fmtWhen(at)}
                      </span>
                    </button>
                    {isExpanded ? (
                      <div className="border-t bg-muted/20 px-2.5 py-2">
                        <p className="whitespace-pre-wrap text-xs text-foreground/80">
                          {rendered.body}
                        </p>
                      </div>
                    ) : (
                      <p className="line-clamp-2 whitespace-pre-wrap px-2.5 pb-2.5 text-xs text-muted-foreground">
                        {rendered.body}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Sends to <span className="font-medium">{inquiry.email}</span> from the brand
              inbox
              {anchor
                ? " as replies on the existing email thread — no new chain."
                : ". No email thread exists yet, so the first send starts one."}{" "}
              The chain breaks automatically if they reply, and a follow-up task brings a
              human in.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={onStart}
                disabled={starting || missingQuote}
                className="gap-1.5"
              >
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
