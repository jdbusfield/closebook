"use client";

// Follow-up email template picker for the deal drawer. Surfaces the copy that
// fits the inquiry's use case and pipeline stage, renders the merge fields live
// (including {details} — everything the customer submitted — and {quote} from
// the built-in quote builder), and lets the rep copy the finished email (or open
// it in their mail client) and log the touch to the timeline in one click. It
// does not send anything itself — the rep still sends from their own inbox.

import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Check, Send, Sparkles } from "lucide-react";
import {
  type MessageTemplate,
  TRACK_LABEL,
  selectTemplates,
  inferTrack,
  renderTemplate,
} from "@/lib/inquiries/templates";
import { useTemplates } from "@/lib/inquiries/use-templates";
import {
  QuoteBuilder,
  seedQuoteLines,
  formatQuote,
  type QuoteLine,
} from "@/components/inquiries/quote-builder";
import { type Inquiry, type InquiryActivity } from "@/lib/inquiries/shared";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

export function TemplatePicker({
  inquiry,
  entityId,
  rep,
  onLog,
  onSetValue,
  open: openProp,
  onOpenChange,
  trigger,
}: {
  inquiry: Inquiry;
  entityId: string;
  rep: string;
  onLog: (type: InquiryActivity["type"], body: string) => void;
  onSetValue?: (id: string, value: number | null) => void;
  /** Controlled open state. Omit to let the built-in trigger manage it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Custom trigger element (e.g. a card's email icon). Omit for the default
   * "Email templates" button; pass `null` to render no trigger when driving
   * `open` from outside.
   */
  trigger?: ReactNode | null;
}) {
  const [openState, setOpenState] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const setOpen = (o: boolean) => {
    if (!isControlled) setOpenState(o);
    onOpenChange?.(o);
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [quoteLines, setQuoteLines] = useState<QuoteLine[]>(() =>
    seedQuoteLines(inquiry)
  );

  const { templates } = useTemplates(entityId);
  const all = useMemo(
    () => selectTemplates(templates, inquiry),
    [templates, inquiry]
  );
  const track = useMemo(() => inferTrack(inquiry), [inquiry]);

  const selected = all.find((t) => t.id === selectedId) ?? all[0] ?? null;
  const showQuote = !!selected && selected.body.includes("{quote}");
  const quote = useMemo(() => formatQuote(quoteLines), [quoteLines]);

  const rendered: { subject?: string; body: string } = selected
    ? renderTemplate(
        selected,
        inquiry,
        rep,
        showQuote ? { quote: quote.text } : undefined
      )
    : { subject: undefined, body: "" };

  const reset = () => {
    setSelectedId(null);
    setCopied(false);
  };

  const logEntry = (tpl: MessageTemplate, subject?: string) => ({
    type: "email" as InquiryActivity["type"],
    body: `Sent email — “${subject || tpl.label}”`,
  });

  // Push the quote total onto the deal's estimated value when sending a quote.
  const maybeSaveValue = () => {
    if (showQuote && onSetValue && quote.total > 0) {
      onSetValue(inquiry.id, quote.total);
    }
  };

  const doCopy = async () => {
    const ok = await copyText(rendered.body);
    if (ok) {
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast.error("Couldn't access clipboard");
    }
  };

  const doCopyAndLog = async () => {
    if (!selected) return;
    await copyText(rendered.body);
    const { type, body } = logEntry(selected, rendered.subject);
    onLog(type, body);
    maybeSaveValue();
    setOpen(false);
    reset();
  };

  const mailto = () => {
    if (!selected) return undefined;
    const to = inquiry.email ?? "";
    const params = new URLSearchParams();
    if (rendered.subject) params.set("subject", rendered.subject);
    params.set("body", rendered.body);
    return `mailto:${to}?${params.toString()}`;
  };

  if (all.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
              <Sparkles className="size-3.5" />
              Email templates
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-[calc(100%-2rem)] gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2 text-base">
            Email templates
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {TRACK_LABEL[track]} track
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid sm:grid-cols-[210px_1fr]">
          {/* Template list */}
          <div className="max-h-[460px] overflow-y-auto border-b sm:border-b-0 sm:border-r">
            {all.map((t) => {
              const active = selected?.id === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`block w-full border-b px-4 py-2.5 text-left last:border-b-0 transition-colors ${
                    active ? "bg-muted/70" : "hover:bg-muted/40"
                  }`}
                >
                  <div className="text-sm font-medium">{t.label}</div>
                  {t.cadence && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {t.cadence}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Preview + builder */}
          <div className="flex max-h-[460px] flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {selected ? (
                <>
                  {showQuote && (
                    <QuoteBuilder lines={quoteLines} setLines={setQuoteLines} />
                  )}
                  {/* Email preview */}
                  <div className="overflow-hidden rounded-lg border bg-white">
                    <div className="border-b bg-muted/30 px-3 py-2 text-xs">
                      <span className="text-muted-foreground">Subject </span>
                      <span className="font-semibold text-foreground">
                        {rendered.subject || (
                          <span className="italic text-muted-foreground">
                            No subject
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap break-words px-3 py-3 text-sm leading-relaxed text-foreground/90">
                      {rendered.body}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Pick a template to preview it.
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
              <Button variant="outline" size="sm" onClick={doCopy} className="gap-1.5">
                {copied ? (
                  <Check className="size-4 text-emerald-600" />
                ) : (
                  <Copy className="size-4" />
                )}
                Copy
              </Button>
              {inquiry.email && (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a
                    href={mailto()}
                    onClick={() => {
                      if (!selected) return;
                      const { type, body } = logEntry(selected, rendered.subject);
                      onLog(type, body);
                      maybeSaveValue();
                      setOpen(false);
                      reset();
                    }}
                  >
                    <Send className="size-4" />
                    Compose &amp; log
                  </a>
                </Button>
              )}
              <Button size="sm" onClick={doCopyAndLog} className="ml-auto gap-1.5">
                <Check className="size-4" />
                Copy &amp; log
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
