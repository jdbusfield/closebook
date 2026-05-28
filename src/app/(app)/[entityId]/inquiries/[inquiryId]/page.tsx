"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
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
import { ArrowLeft, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "../status-badge";
import { INQUIRY_STATUSES, STATUS_LABELS } from "@/lib/inquiries/shared";

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

export default function InquiryDetailPage() {
  const params = useParams();
  const entityId = params.entityId as string;
  const inquiryId = params.inquiryId as string;

  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [events, setEvents] = useState<EmailEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [internalNotes, setInternalNotes] = useState("");
  const [rwQuote, setRwQuote] = useState("");
  const [rwOrder, setRwOrder] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
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
  }, [inquiryId]);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(body: Record<string, unknown>, successMsg: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/inquiries/${inquiryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
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

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (!inquiry) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-muted-foreground">Inquiry not found.</p>
        <Link href={`/${entityId}/inquiries`} className="text-primary hover:underline">
          ← Back to inquiries
        </Link>
      </div>
    );
  }

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
          href={`/${entityId}/inquiries`}
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
          </CardContent>
        </Card>
      </div>

      {/* Email timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">No emails recorded yet.</p>
          )}
          {messages.map((m) => {
            const outbound = m.direction === "outbound";
            const evs = eventsByMessage.get(m.id);
            return (
              <div
                key={m.id}
                className="rounded-md border p-3 text-sm"
                style={{ marginLeft: outbound ? 0 : "1.5rem" }}
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
                  {m.to_addrs && m.to_addrs.length ? ` · To ${m.to_addrs.join(", ")}` : ""}
                </div>
                {m.subject && <div className="mt-1 font-medium">{m.subject}</div>}
                {m.body_text && (
                  <div className="mt-1 whitespace-pre-wrap text-muted-foreground line-clamp-6">
                    {m.body_text}
                  </div>
                )}
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
