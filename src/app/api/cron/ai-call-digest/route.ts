import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { laDayStart } from "@/lib/inquiries/ai-call";
import {
  DIGEST_FROM,
  DIGEST_TO_DEFAULT,
  buildDigest,
  type DigestConversation,
  type DigestInquiry,
  type DigestTurn,
} from "@/lib/inquiries/ai-call-digest";
import { resendClient } from "@/lib/inquiries/funnel-send";

export const runtime = "nodejs";
export const maxDuration = 120;

// ============================================================================
// Weekday-evening digest of the day's HDR AI calls (vercel.json cron).
// Pulls every conversation the ElevenLabs agent had today (Pacific) with the
// ElevenLabs key Closebook already holds, adds the inquiry reference for calls
// that came from a form, and emails one plain-text digest to JD
// (AI_CALL_DIGEST_TO overrides). A Claude routine reads it from Gmail and
// sends the daily quality review, so the key never leaves Vercel.
// Sends a digest even with no calls, so the review knows the job ran.
// ?date=YYYY-MM-DD digests an earlier Pacific day.
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
// ============================================================================

const API = "https://api.elevenlabs.io/v1/convai";

interface ListItem {
  conversation_id: string;
  start_time_unix_secs: number;
  direction?: string | null;
}
interface Detail {
  status?: string;
  transcript?: DigestTurn[];
  metadata?: {
    call_duration_secs?: number;
    phone_call?: { external_number?: string; direction?: string } | null;
  };
  analysis?: {
    transcript_summary?: string | null;
    data_collection_results?: Record<string, { value?: unknown }>;
    evaluation_criteria_results?: Record<string, { result?: string; rationale?: string }>;
  };
  conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) return NextResponse.json({ error: "ElevenLabs env vars missing" }, { status: 500 });
  const resend = resendClient();
  if (!resend) return NextResponse.json({ error: "RESEND_API_KEY missing" }, { status: 500 });
  const to = (process.env.AI_CALL_DIGEST_TO || DIGEST_TO_DEFAULT).split(",").map((s) => s.trim()).filter(Boolean);

  // The Pacific day to digest: today, or ?date=YYYY-MM-DD (noon Pacific avoids DST edges).
  const dateParam = new URL(request.url).searchParams.get("date");
  const anchor = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? new Date(`${dateParam}T19:00:00Z`) : new Date();
  const start = laDayStart(anchor);
  const end = laDayStart(new Date(start.getTime() + 36 * 3600000));
  const dayLabel = start.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const get = async <T,>(path: string): Promise<T> => {
    const res = await fetch(`${API}${path}`, { headers: { "xi-api-key": apiKey } });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status} on ${path.split("?")[0]}`);
    return (await res.json()) as T;
  };

  try {
    // Every conversation that started in the window.
    const items: ListItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({
        agent_id: agentId,
        call_start_after_unix: String(Math.floor(start.getTime() / 1000)),
        call_start_before_unix: String(Math.floor(end.getTime() / 1000)),
        page_size: "100",
      });
      if (cursor) qs.set("cursor", cursor);
      const res = await get<{ conversations?: ListItem[]; next_cursor?: string | null; has_more?: boolean }>(
        `/conversations?${qs}`
      );
      items.push(...(res.conversations ?? []));
      if (!res.has_more || !res.next_cursor) break;
      cursor = res.next_cursor;
    }
    const inWindow = items.filter(
      (c) => c.start_time_unix_secs * 1000 >= start.getTime() && c.start_time_unix_secs * 1000 < end.getTime()
    );

    // Details, five at a time.
    const conversations: DigestConversation[] = [];
    for (let i = 0; i < inWindow.length; i += 5) {
      const batch = await Promise.all(
        inWindow.slice(i, i + 5).map(async (item): Promise<DigestConversation> => {
          const d = await get<Detail>(`/conversations/${item.conversation_id}`);
          const collected: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(d.analysis?.data_collection_results ?? {})) collected[k] = v?.value ?? null;
          return {
            conversation_id: item.conversation_id,
            start_time_unix_secs: item.start_time_unix_secs,
            status: d.status,
            direction: item.direction ?? d.metadata?.phone_call?.direction ?? null,
            call_duration_secs: d.metadata?.call_duration_secs ?? null,
            transcript: d.transcript ?? [],
            dynamic_variables: d.conversation_initiation_client_data?.dynamic_variables ?? {},
            collected,
            evaluation: d.analysis?.evaluation_criteria_results ?? {},
            summary: d.analysis?.transcript_summary ?? null,
            phone_number: d.metadata?.phone_call?.external_number ?? null,
          };
        })
      );
      conversations.push(...batch);
    }

    // Inquiry references for calls that came from a form.
    const inquiries = new Map<string, DigestInquiry>();
    const ids = conversations.map((c) => c.conversation_id);
    if (ids.length) {
      const admin = createAdminClient();
      const { data: calls } = await admin
        .from("rental_inquiry_ai_calls")
        .select("conversation_id, inquiry_id")
        .in("conversation_id", ids);
      const inquiryIds = [...new Set((calls ?? []).map((c) => c.inquiry_id))];
      if (inquiryIds.length) {
        const { data: rows } = await admin.from("rental_inquiries").select("id, reference, name").in("id", inquiryIds);
        const byId = new Map((rows ?? []).map((r) => [r.id, r]));
        for (const c of calls ?? []) {
          const inq = byId.get(c.inquiry_id);
          if (inq && c.conversation_id) inquiries.set(c.conversation_id, { reference: inq.reference, name: inq.name });
        }
      }
    }

    const { subject, text } = buildDigest(dayLabel, conversations, inquiries);
    const { error } = await resend.emails.send({ from: DIGEST_FROM, to, subject, text });
    if (error) throw new Error(`Resend: ${error.message}`);
    return NextResponse.json({ ok: true, day: dayLabel, conversations: conversations.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ai-call-digest]", message);
    // Tell JD the digest failed, so the review isn't silently missing a day.
    await resend.emails
      .send({
        from: DIGEST_FROM,
        to,
        subject: `[AI CALL DIGEST] ${dayLabel} · FAILED`,
        text: `The AI call digest could not be built: ${message}`,
      })
      .catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
