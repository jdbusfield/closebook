"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "../status-badge";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import {
  INQUIRY_STATUSES,
  STATUS_LABELS,
  visibleThreadMessages,
  messageSide,
  fmtMoney,
} from "@/lib/inquiries/shared";

interface Inquiry {
  id: string;
  reference: string;
  status: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  use_case: string | null;
  start_date: string | null;
  end_date: string | null;
  duration: string | null;
  units: number | null;
  attendant: string | null;
  guests: string | null;
  location: string | null;
  notes: string | null;
  internal_notes: string | null;
  rw_quote_number: string | null;
  rw_order_number: string | null;
  unit_id: string | null;
  estimated_value: number | null;
  created_at: string;
  last_activity_at: string | null;
}

interface Message {
  id: string;
  direction: string;
  kind: string | null;
  from_addr: string | null;
  to_addrs: string[] | null;
  cc_addrs: string[] | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  resend_email_id: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
}

interface EmailEvent {
  id: string;
  message_id: string | null;
  event_type: string;
  occurred_at: string | null;
}

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const EVENT_STYLES: Record<string, string> = {
  sent: "bg-gray-100 text-gray-700",
  delivered: "bg-blue-100 text-blue-800",
  opened: "bg-green-100 text-green-800",
  clicked: "bg-emerald-100 text-emerald-800",
  bounced: "bg-red-100 text-red-800",
  complained: "bg-red-100 text-red-800",
  delivery_delayed: "bg-amber-100 text-amber-800",
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

// Collapsed-height cap for a long HTML email, in px. Short emails render at
// their natural height (no scrollbar, no toggle); only taller ones clamp here
// and reveal a toggle.
const HTML_COLLAPSED_MAX = 360;

// Renders an HTML email body in a sandboxed iframe, auto-sized to its content so
// the page scrolls naturally instead of a cramped inner scroll box. The iframe
// is sandboxed without `allow-scripts`, so even malicious markup can't execute;
// `allow-same-origin` is what lets us measure the rendered content height (safe
// here precisely because scripting is disabled). The email's own CSS stays
// contained in the frame and can't leak into the app.
function HtmlBody({
  html,
  expanded,
  onToggle,
}: {
  html: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [naturalHeight, setNaturalHeight] = useState<number | null>(null);

  const measure = useCallback(() => {
    const doc = iframeRef.current?.contentWindow?.document;
    if (!doc) return;
    const h = Math.ceil(doc.documentElement.scrollHeight || doc.body.scrollHeight);
    if (h > 0) setNaturalHeight(h + 2); // +2 avoids a 1px rounding scrollbar
  }, []);

  // Measure on load, and keep tracking as late-loading images reflow the body.
  const handleLoad = useCallback(() => {
    measure();
    observerRef.current?.disconnect();
    const doc = iframeRef.current?.contentWindow?.document;
    if (doc && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => measure());
      ro.observe(doc.documentElement);
      observerRef.current = ro;
    }
  }, [measure]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:10px;background:#fff;color:#0b1320;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;word-break:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%!important}a{color:#2563eb}</style></head><body>${html}</body></html>`;

  const overflows = naturalHeight != null && naturalHeight > HTML_COLLAPSED_MAX;
  const full = naturalHeight ?? HTML_COLLAPSED_MAX;
  const height = !overflows || expanded ? full : HTML_COLLAPSED_MAX;

  return (
    <div className="mt-2 space-y-1">
      <div className="relative overflow-hidden rounded border bg-white">
        <iframe
          ref={iframeRef}
          title="Email body"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
          scrolling="no"
          onLoad={handleLoad}
          style={{ width: "100%", height, display: "block", border: 0 }}
        />
        {overflows && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white to-transparent" />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-primary hover:underline"
        >
          {expanded ? "Collapse" : "Expand full email"}
        </button>
      )}
    </div>
  );
}

// Renders an email body. HTML goes through the auto-sized sandboxed iframe above;
// falls back to plain text, then to an empty-state note.
function MessageBody({
  html,
  text,
  expanded,
  onToggle,
}: {
  html: string | null;
  text: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (html) {
    return <HtmlBody html={html} expanded={expanded} onToggle={onToggle} />;
  }
  if (text) {
    return (
      <div className="mt-2 space-y-1">
        <div
          className={`whitespace-pre-wrap text-sm text-foreground/90 ${
            expanded ? "" : "line-clamp-6"
          }`}
        >
          {text}
        </div>
        {text.length > 320 && (
          <button
            type="button"
            onClick={onToggle}
            className="text-xs text-primary hover:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mt-2 text-xs italic text-muted-foreground">
      (No message body was captured for this email.)
    </div>
  );
}

export default function InquiryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const entityId = (params.entityId as string) || embed?.entityId || "";
  const base = embed ? embed.basePath : `/${entityId}/inquiries`;
  const inquiryId = params.inquiryId as string;

  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [rwQuote, setRwQuote] = useState("");
  const [rwOrder, setRwOrder] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    if (isEmbed) {
      const res = await fetch("/api/inquiries/embed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(embedKey ? { "x-embed-key": embedKey } : {}),
        },
        body: JSON.stringify({ action: "inquiry_detail", inquiryId }),
      });
      const data = await res.json().catch(() => ({}));
      const inq = (data.inquiry as Inquiry) ?? null;
      setInquiry(inq);
      setInternalNotes(inq?.internal_notes ?? "");
      setRwQuote(inq?.rw_quote_number ?? "");
      setRwOrder(inq?.rw_order_number ?? "");
      setMessages((data.messages as Message[]) ?? []);
      setEvents((data.events as EmailEvent[]) ?? []);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data: inq } = await supabase
      .from("rental_inquiries")
      .select("*")
      .eq("id", inquiryId)
      .maybeSingle();
    setInquiry((inq as Inquiry) ?? null);
    setInternalNotes((inq as Inquiry)?.internal_notes ?? "");
    setRwQuote((inq as Inquiry)?.rw_quote_number ?? "");
    setRwOrder((inq as Inquiry)?.rw_order_number ?? "");

    const { data: msgs } = await supabase
      .from("rental_inquiry_messages")
      .select(
        "id, direction, kind, from_addr, to_addrs, cc_addrs, subject, body_text, body_html, resend_email_id, sent_at, received_at, created_at"
      )
      .eq("inquiry_id", inquiryId)
      .order("created_at", { ascending: true });
    const msgList = (msgs as Message[]) ?? [];
    setMessages(msgList);

    const ids = msgList.map((m) => m.id);
    if (ids.length > 0) {
      const { data: evs } = await supabase
        .from("rental_inquiry_email_events")
        .select("id, message_id, event_type, occurred_at")
        .in("message_id", ids)
        .order("occurred_at", { ascending: true });
      setEvents((evs as EmailEvent[]) ?? []);
    } else {
      setEvents([]);
    }
    setLoading(false);
  }, [inquiryId, isEmbed, embedKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(body: Record<string, unknown>, successMsg: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/inquiries/${inquiryId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(embedKey ? { "x-embed-key": embedKey } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Update failed");
      }
      toast.success(successMsg);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/inquiries/${inquiryId}`, {
        method: "DELETE",
        headers: embedKey ? { "x-embed-key": embedKey } : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Delete failed");
      }
      toast.success("Inquiry deleted");
      // Leave the (now-gone) detail page and return to the board.
      router.replace(base);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (!inquiry) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-muted-foreground">Inquiry not found.</p>
        <Link href={base} className="text-primary hover:underline">
          ← Back to inquiries
        </Link>
      </div>
    );
  }

  // Drop the automated autoreply and collapse the duplicated inquiry
  // notification so the thread shows genuine correspondence only.
  const thread = visibleThreadMessages(messages);

  // Distinct latest event types per message for the delivery chips.
  const eventsByMessage = new Map<string, Set<string>>();
  for (const ev of events) {
    if (!ev.message_id) continue;
    if (!eventsByMessage.has(ev.message_id)) eventsByMessage.set(ev.message_id, new Set());
    eventsByMessage.get(ev.message_id)!.add(ev.event_type);
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link
          href={base}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">
          {inquiry.name || "Inquiry"}
        </h1>
        <span className="font-mono text-xs text-muted-foreground">{inquiry.reference}</span>
        <StatusBadge status={inquiry.status} />
      </div>

      <SectionTabs entityId={entityId} />

      <div className="grid gap-6 md:grid-cols-3">
        {/* Left: request details */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Request</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Field label="Use case" value={inquiry.use_case} />
            <Field label="Location" value={inquiry.location} />
            <Field
              label="Dates"
              value={
                inquiry.start_date
                  ? `${inquiry.start_date}${inquiry.end_date ? ` → ${inquiry.end_date}` : ""}`
                  : null
              }
            />
            <Field label="Duration" value={inquiry.duration} />
            <Field
              label="Units"
              value={inquiry.units != null ? `${inquiry.units} (${inquiry.units * 4} stalls)` : null}
            />
            <Field label="Attendant" value={inquiry.attendant} />
            <Field label="Guest count" value={inquiry.guests} />
            <Field
              label="Est. value"
              value={
                inquiry.estimated_value != null
                  ? fmtMoney(inquiry.estimated_value)
                  : null
              }
            />
            <Field label="Submitted" value={fmt(inquiry.created_at)} />
            <Field label="Email" value={inquiry.email} />
            <Field label="Phone" value={inquiry.phone} />
            <div className="col-span-2">
              <Field label="Customer notes" value={inquiry.notes} />
            </div>
          </CardContent>
        </Card>

        {/* Right: triage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Triage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={inquiry.status}
                onValueChange={(v) => patch({ status: v }, "Status updated")}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INQUIRY_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <Label>RentalWorks quote #</Label>
              <Input
                value={rwQuote}
                onChange={(e) => setRwQuote(e.target.value)}
                placeholder="e.g. Q-10234"
              />
            </div>
            <div className="space-y-1.5">
              <Label>RentalWorks order #</Label>
              <Input
                value={rwOrder}
                onChange={(e) => setRwOrder(e.target.value)}
                placeholder="e.g. O-55012"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() =>
                patch(
                  { rw_quote_number: rwQuote || null, rw_order_number: rwOrder || null },
                  "Saved"
                )
              }
            >
              Save RW links
            </Button>

            <Separator />

            <div className="space-y-1.5">
              <Label>Internal notes</Label>
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                rows={4}
                placeholder="Private notes for the team…"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => patch({ internal_notes: internalNotes || null }, "Notes saved")}
              >
                Save notes
              </Button>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <Label className="text-destructive">Danger zone</Label>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={deleting}
                    className="w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                    {deleting ? "Deleting…" : "Delete inquiry"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this inquiry?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes inquiry{" "}
                      <span className="font-mono">{inquiry.reference}</span>
                      {inquiry.name ? ` (${inquiry.name})` : ""} and its entire email
                      thread. This can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={remove}
                      disabled={deleting}
                      className="bg-destructive text-white hover:bg-destructive/90"
                    >
                      {deleting ? "Deleting…" : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Communication thread */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Communication{thread.length > 0 ? ` (${thread.length})` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {thread.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No emails recorded yet. Replies that CC{" "}
              <span className="font-mono">sales@hdrsiteservices.com</span> and keep the{" "}
              <span className="font-mono">{inquiry.reference}</span> reference in the subject
              will appear here automatically.
            </p>
          )}
          {thread.map((m) => {
            const outbound = messageSide(m, inquiry.email) === "us";
            const evs = eventsByMessage.get(m.id);
            const recipients = [
              m.to_addrs?.length ? `To ${m.to_addrs.join(", ")}` : "",
              m.cc_addrs?.length ? `Cc ${m.cc_addrs.join(", ")}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div
                key={m.id}
                className={`rounded-md border p-3 text-sm ${
                  outbound
                    ? "border-blue-200 bg-blue-50/40"
                    : "ml-4 border-green-200 bg-green-50/40"
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {outbound ? (
                    <ArrowUpRight className="size-4 text-blue-600" />
                  ) : (
                    <ArrowDownLeft className="size-4 text-green-600" />
                  )}
                  <span className="font-medium">{outbound ? "Outbound" : "Inbound"}</span>
                  {m.kind && (
                    <Badge variant="outline" className="text-[10px]">
                      {m.kind.replace(/_/g, " ")}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {fmt(m.sent_at || m.received_at || m.created_at)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {m.from_addr ? `From ${m.from_addr}` : ""}
                  {recipients ? ` · ${recipients}` : ""}
                </div>
                {m.subject && <div className="mt-1 font-medium">{m.subject}</div>}
                <MessageBody
                  html={m.body_html}
                  text={m.body_text}
                  expanded={expanded.has(m.id)}
                  onToggle={() => toggleExpanded(m.id)}
                />
                {outbound && (
                  <div className="mt-2 flex gap-1.5 flex-wrap">
                    {evs && evs.size > 0 ? (
                      ["sent", "delivered", "opened", "clicked", "bounced", "complained"]
                        .filter((t) => evs.has(t))
                        .map((t) => (
                          <Badge
                            key={t}
                            variant="outline"
                            className={EVENT_STYLES[t] || ""}
                          >
                            {t}
                          </Badge>
                        ))
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {m.resend_email_id ? "Awaiting delivery events…" : "No tracking"}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
