"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useEmbed } from "@/lib/inquiries/embed-context";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Link2, Plus } from "lucide-react";
import { toast } from "sonner";
import { SectionTabs } from "@/components/inquiries/section-tabs";
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

// Cheap plain-text snippet from a message body (strip tags from HTML-only mail).
function snippet(m: FeedMessage): string {
  const raw =
    m.body_text ||
    (m.body_html ? m.body_html.replace(/<[^>]+>/g, " ") : "");
  return raw.replace(/\s+/g, " ").trim().slice(0, 220);
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

  async function createInquiry(messageId: string) {
    setCreating(messageId);
    try {
      const res = await fetch(
        `/api/inquiry-messages/${messageId}/create-inquiry`,
        { method: "POST", headers: embedKey ? { "x-embed-key": embedKey } : undefined }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // If it was already linked, just go to that inquiry.
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
    <div className="space-y-4 p-4 md:p-6 max-w-4xl">
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
            didn&apos;t auto-match an inquiry.
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
            return (
              <div key={m.id} className="flex gap-3 p-3.5 text-sm">
                <div className="pt-0.5">
                  {outbound ? (
                    <ArrowUpRight className="size-4 text-blue-600" />
                  ) : (
                    <ArrowDownLeft className="size-4 text-green-600" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {m.from_addr || "(unknown sender)"}
                    </span>
                    {m.kind && (
                      <Badge variant="outline" className="text-[10px]">
                        {m.kind.replace(/_/g, " ")}
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {fmt(m.sent_at || m.received_at || m.created_at)}
                    </span>
                  </div>
                  {m.to_addrs && m.to_addrs.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      To {m.to_addrs.join(", ")}
                    </div>
                  )}
                  {m.subject && <div className="mt-0.5 font-medium">{m.subject}</div>}
                  {snippet(m) && (
                    <div className="mt-0.5 line-clamp-2 text-muted-foreground">
                      {snippet(m)}
                    </div>
                  )}

                  <div className="mt-2">
                    {linked ? (
                      <Link
                        href={`${base}/${linked.id}`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Link2 className="size-3" />
                        {linked.reference}
                        {linked.name ? ` · ${linked.name}` : ""}
                      </Link>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                          Unmatched
                        </Badge>
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
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
