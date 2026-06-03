"use client";

// Follow-up template picker for the deal drawer. Surfaces the copy that fits the
// inquiry's use case and pipeline stage, renders the merge fields live, and lets
// the rep copy the finished message (or open it in their mail client) and log
// the touch to the timeline in one click. It does not send anything itself — the
// rep still sends from their own phone/inbox; this just makes persistence fast.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Mail,
  MessageSquare,
  Phone,
  Copy,
  Check,
  Send,
  Sparkles,
} from "lucide-react";
import {
  type MessageTemplate,
  type TemplateChannel,
  CHANNEL_LABEL,
  TRACK_LABEL,
  selectTemplates,
  inferTrack,
  renderTemplate,
} from "@/lib/inquiries/templates";
import { useTemplates } from "@/lib/inquiries/use-templates";
import { type Inquiry, type InquiryActivity } from "@/lib/inquiries/shared";

const CHANNEL_ICON: Record<TemplateChannel, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  call: Phone,
};

// How a chosen template gets recorded on the activity timeline.
function logEntry(
  tpl: MessageTemplate,
  subject: string | undefined
): { type: InquiryActivity["type"]; body: string } {
  if (tpl.channel === "email")
    return { type: "email", body: `Sent email — “${subject || tpl.label}”` };
  if (tpl.channel === "sms")
    return { type: "note", body: `Sent text — ${tpl.label}` };
  return { type: "call", body: `Logged call — ${tpl.label}` };
}

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
}: {
  inquiry: Inquiry;
  entityId: string;
  rep: string;
  onLog: (type: InquiryActivity["type"], body: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<TemplateChannel | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { templates } = useTemplates(entityId);
  const all = useMemo(
    () => selectTemplates(templates, inquiry),
    [templates, inquiry]
  );
  const track = useMemo(() => inferTrack(inquiry), [inquiry]);

  // Channels present for this inquiry/stage, in a stable order.
  const channels = useMemo(() => {
    const order: TemplateChannel[] = ["sms", "call", "email"];
    return order.filter((c) => all.some((t) => t.channel === c));
  }, [all]);

  const activeChannel = channel ?? channels[0] ?? "email";
  const list = all.filter((t) => t.channel === activeChannel);
  const selected =
    list.find((t) => t.id === selectedId) ?? list[0] ?? all[0] ?? null;

  const rendered = selected
    ? renderTemplate(selected, inquiry, rep)
    : { subject: undefined, body: "" };

  const reset = () => {
    setChannel(null);
    setSelectedId(null);
    setCopied(false);
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
    setOpen(false);
    reset();
  };

  const mailto = () => {
    if (!selected) return;
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
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Sparkles className="size-3.5" />
          Templates
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-3.5">
          <DialogTitle className="flex items-center gap-2 text-base">
            Follow-up templates
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {TRACK_LABEL[track]} track
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Channel filter */}
        <div className="flex gap-1 border-b px-5 py-2.5">
          {channels.map((c) => {
            const Icon = CHANNEL_ICON[c];
            const active = c === activeChannel;
            return (
              <button
                key={c}
                onClick={() => {
                  setChannel(c);
                  setSelectedId(null);
                }}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                <Icon className="size-3.5" />
                {CHANNEL_LABEL[c]}
              </button>
            );
          })}
        </div>

        <div className="grid sm:grid-cols-[200px_1fr]">
          {/* Template list */}
          <div className="max-h-[340px] overflow-y-auto border-b sm:border-b-0 sm:border-r">
            {list.map((t) => {
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

          {/* Preview */}
          <div className="flex max-h-[340px] flex-col">
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {selected ? (
                <>
                  {rendered.subject && (
                    <div className="mb-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Subject
                      </div>
                      <div className="text-sm font-medium">{rendered.subject}</div>
                    </div>
                  )}
                  <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                    {rendered.body}
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
              {activeChannel === "email" && inquiry.email && (
                <Button asChild variant="outline" size="sm" className="gap-1.5">
                  <a
                    href={mailto()}
                    onClick={() => {
                      if (!selected) return;
                      const { type, body } = logEntry(selected, rendered.subject);
                      onLog(type, body);
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
