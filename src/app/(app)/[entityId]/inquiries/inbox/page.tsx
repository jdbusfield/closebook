"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Link2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { SectionTabs } from "@/components/inquiries/section-tabs";
import { MessageBody } from "@/components/inquiries/email-body";
import { messageSide } from "@/lib/inquiries/shared";

interface FeedMessage {
  id: string;
  inquiry_id: string | null;
  direction: string;
  kind: string | null;
  from_addr: string | null;
  to_addrs: string[] | null;
  cc_addrs: string[] | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
}

interface InquiryLite {
  id: string;
  reference: string;
  name: string | null;
}

// Gmail-style list timestamp: time for today, "Jun 5" within the year,
// "6/5/25" for older mail. The expanded header shows the full date.
function listDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" });
}

function fullDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Cheap plain-text snippet from a message body (strip tags from HTML-only mail).
function snippet(m: FeedMessage): string {
  const raw =
    m.body_text ||
    (m.body_html ? m.body_html.replace(/<[^>]+>/g, " ") : "");
  return raw.replace(/\s+/g, " ").trim().slice(0, 220);
}

// "Jane Doe <jane@x.com>" → "Jane Doe"; bare addresses show as-is.
function senderName(addr: string | null): string {
  if (!addr) return "(unknown sender)";
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : addr;
}

export default function InboxFeedPage() {
  const params = useParams();
  const router = useRouter();
  const embed = useEmbed();
  const isEmbed = !!embed?.embedKey;
  const embedKey = embed?.embedKey;
  const entityId = (params.entityId as string) || embed?.entityId || "";
  const base = embed ? embed.basePath : `/${entityId}/inquiries`;

  const [messages, setMessages] = useState<FeedMessage[]>([]);
  const [inquiries, setInquiries] = useState<InquiryLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  // Which rows are open (Gmail-style expand), and which open rows have had
  // their long body un-clamped.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [bodyExpanded, setBodyExpanded] = useState<Set<string>>(new Set());

  const toggleSet = (setter: typeof setOpen) => (id: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleOpen = toggleSet(setOpen);
  const toggleBody = toggleSet(setBodyExpanded);

  const load = useCallback(async () => {
    setLoading(true);
    if (isEmbed) {
      const res = await fetch("/api/inquiries/embed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(embedKey ? { "x-embed-key": embedKey } : {}),
        },
        body: JSON.stringify({ action: "inbox_feed" }),
      });
      const data = await res.json().catch(() => ({}));
      setMessages((data.messages as FeedMessage[]) ?? []);
      setInquiries((data.inquiries as InquiryLite[]) ?? []);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const [{ data: msgs }, { data: inqs }] = await Promise.all([
      supabase
        .from("rental_inquiry_messages")
        .select(
          "id, inquiry_id, direction, kind, from_addr, to_addrs, cc_addrs, subject, body_text, body_html, sent_at, received_at, created_at"
        )
        .eq("entity_id", entityId)
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("rental_inquiries")
        .select("id, reference, name")
        .eq("entity_id", entityId)
        .order("last_activity_at", { ascending: false })
        .limit(500),
    ]);
    setMessages((msgs as FeedMessage[]) ?? []);
    setInquiries((inqs as InquiryLite[]) ?? []);
    setLoading(false);
  }, [entityId, isEmbed, embedKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(messageId: string, inquiryId: string) {
    if (!inquiryId) return;
    setAssigning(messageId);
    try {
      const res = await fetch(`/api/inquiry-messages/${messageId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(embedKey ? { "x-embed-key": embedKey } : {}),
        },
        body: JSON.stringify({ inquiry_id: inquiryId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Assign failed");
      }
      const inq = inquiries.find((i) => i.id === inquiryId);
      toast.success(`Linked to ${inq?.reference ?? "inquiry"}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setAssigning(null);
    }
  }

  async function createInquiry(messageId: string, force = false) {
    setCreating(messageId);
    try {
      const res = await fetch(
        `/api/inquiry-messages/${messageId}/create-inquiry`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(embedKey ? { "x-embed-key": embedKey } : {}),
          },
          body: JSON.stringify({ force }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // If it was already linked (and we didn't force a new one), just go there.
        if (res.status === 409 && json.inquiryId) {
          router.push(`${base}/${json.inquiryId}`);
          return;
        }
        throw new Error(json.error || "Create failed");
      }
      toast.success(`Created inquiry ${json.reference}`);
      router.push(`${base}/${json.inquiryId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create failed");
      setCreating(null);
    }
  }

  const inquiryMap = new Map(inquiries.map((i) => [i.id, i]));
  const visible = unmatchedOnly
    ? messages.filter((m) => !m.inquiry_id)
    : messages;
  const unmatchedCount = messages.filter((m) => !m.inquiry_id).length;

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Link
          href={base}
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox activity</h1>
          <p className="text-sm text-muted-foreground">
            Every email to sales@hdrsiteservices.com — including messages that
            didn&apos;t auto-match an inquiry. Click a row to read the email.
          </p>
        </div>
      </div>

      <SectionTabs entityId={entityId} />

      <div className="flex items-center gap-2">
        <Button
          variant={unmatchedOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setUnmatchedOnly((v) => !v)}
        >
          {unmatchedOnly ? "Showing unmatched only" : "Show unmatched only"}
          {unmatchedCount > 0 && (
            <Badge variant="secondary" className="ml-2">
              {unmatchedCount}
            </Badge>
          )}
        </Button>
        {loading && <span className="text-sm text-muted-foreground">Loading…</span>}
      </div>

      <Card>
        <CardContent className="divide-y p-0">
          {!loading && visible.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {unmatchedOnly ? "No unmatched messages 🎉" : "No email activity yet."}
            </p>
          )}
          {visible.map((m) => {
            const outbound = messageSide(m) === "us";
            const linked = m.inquiry_id ? inquiryMap.get(m.inquiry_id) : null;
            const isOpen = open.has(m.id);
            const snip = snippet(m);

            return (
              <div key={m.id}>
                {/* ------------------------------------------- collapsed row */}
                <button
                  type="button"
                  onClick={() => toggleOpen(m.id)}
                  aria-expanded={isOpen}
                  className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 ${
                    isOpen ? "bg-muted/40" : ""
                  }`}
                >
                  <span className="shrink-0">
                    {outbound ? (
                      <ArrowUpRight className="size-4 text-blue-600" />
                    ) : (
                      <ArrowDownLeft className="size-4 text-green-600" />
                    )}
                  </span>
                  <span className="w-40 shrink-0 truncate font-medium md:w-48">
                    {senderName(m.from_addr)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{m.subject || "(no subject)"}</span>
                    {snip && (
                      <span className="text-muted-foreground"> — {snip}</span>
                    )}
                  </span>
                  {!linked && (
                    <Badge className="shrink-0 bg-amber-100 text-amber-800 hover:bg-amber-100">
                      Unmatched
                    </Badge>
                  )}
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {listDate(m.sent_at || m.received_at || m.created_at)}
                  </span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {/* ------------------------------------------- expanded mail */}
                {isOpen && (
                  <div className="border-t bg-muted/20 px-4 pb-4 pt-3 md:px-6">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1 space-y-0.5 text-xs text-muted-foreground">
                        <div className="text-sm font-semibold text-foreground">
                          {m.subject || "(no subject)"}
                        </div>
                        <div>
                          <span className="font-medium text-foreground/80">From:</span>{" "}
                          {m.from_addr || "(unknown sender)"}
                        </div>
                        {m.to_addrs && m.to_addrs.length > 0 && (
                          <div>
                            <span className="font-medium text-foreground/80">To:</span>{" "}
                            {m.to_addrs.join(", ")}
                          </div>
                        )}
                        {m.cc_addrs && m.cc_addrs.length > 0 && (
                          <div>
                            <span className="font-medium text-foreground/80">Cc:</span>{" "}
                            {m.cc_addrs.join(", ")}
                          </div>
                        )}
                        <div>{fullDate(m.sent_at || m.received_at || m.created_at)}</div>
                      </div>
                      {m.kind && (
                        <Badge variant="outline" className="text-[10px]">
                          {m.kind.replace(/_/g, " ")}
                        </Badge>
                      )}
                    </div>

                    <MessageBody
                      html={m.body_html}
                      text={m.body_text}
                      expanded={bodyExpanded.has(m.id)}
                      onToggle={() => toggleBody(m.id)}
                    />

                    <div className="mt-3">
                      {linked ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`${base}/${linked.id}`}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Link2 className="size-3" />
                            {linked.reference}
                            {linked.name ? ` · ${linked.name}` : ""}
                          </Link>
                          <span className="text-xs text-muted-foreground">·</span>
                          {/* Repeat booking on the same thread: spin a NEW reservation
                              off this email (moves just this message to the new card). */}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            disabled={creating === m.id || assigning === m.id}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Start a new reservation from this email? It will be moved off ${linked.reference} onto the new reservation — the original keeps its other emails.`
                                )
                              ) {
                                createInquiry(m.id, true);
                              }
                            }}
                          >
                            <Plus className="size-3.5" />
                            {creating === m.id ? "Creating…" : "New reservation from this"}
                          </Button>
                          <select
                            className="rounded-md border bg-background px-2 py-1 text-xs"
                            defaultValue=""
                            disabled={assigning === m.id || creating === m.id}
                            onChange={(e) => assign(m.id, e.target.value)}
                          >
                            <option value="">
                              {assigning === m.id ? "Moving…" : "Move to…"}
                            </option>
                            {inquiries
                              .filter((i) => i.id !== linked.id)
                              .map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.reference}
                                  {i.name ? ` · ${i.name}` : ""}
                                </option>
                              ))}
                          </select>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7"
                            disabled={creating === m.id}
                            onClick={() => createInquiry(m.id)}
                          >
                            <Plus className="size-3.5" />
                            {creating === m.id ? "Creating…" : "Create inquiry"}
                          </Button>
                          <span className="text-xs text-muted-foreground">or</span>
                          <select
                            className="rounded-md border bg-background px-2 py-1 text-xs"
                            defaultValue=""
                            disabled={assigning === m.id || creating === m.id}
                            onChange={(e) => assign(m.id, e.target.value)}
                          >
                            <option value="">
                              {assigning === m.id ? "Linking…" : "Assign to existing…"}
                            </option>
                            {inquiries.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.reference}
                                {i.name ? ` · ${i.name}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
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
