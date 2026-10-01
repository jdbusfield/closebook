import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  formatCallMessage,
  queueRetry,
  toJson,
  verifyWebhookSignature,
  type AiCallRow,
  type TranscriptTurn,
} from "@/lib/inquiries/ai-call";

export const runtime = "nodejs";

// ElevenLabs post-call webhook for the HDR AI callback agent.
// - post_call_transcription: store outcome, collected details, checks and the
//   transcript on the call row, and add an "ai_call" message to the inquiry
//   timeline so the team sees it on the card.
// - call_initiation_failure: busy / no-answer; queue one retry.
// Authenticated by the HMAC signature header, not a user session.

interface DataCollectionResult {
  value?: unknown;
}
interface EvaluationResult {
  result?: string;
}
interface WebhookBody {
  type?: string;
  data?: {
    agent_id?: string;
    conversation_id?: string;
    failure_reason?: string;
    transcript?: TranscriptTurn[];
    metadata?: { call_duration_secs?: number; termination_reason?: string };
    analysis?: {
      transcript_summary?: string;
      data_collection_results?: Record<string, DataCollectionResult>;
      evaluation_criteria_results?: Record<string, EvaluationResult>;
    };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  };
}

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET ?? "";
  if (!verifyWebhookSignature(raw, request.headers.get("elevenlabs-signature"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const data = body.data ?? {};
  // The webhook is workspace-wide; ignore other agents' calls.
  if (process.env.ELEVENLABS_AGENT_ID && data.agent_id !== process.env.ELEVENLABS_AGENT_ID) {
    return NextResponse.json({ ok: true, ignored: "other agent" });
  }

  const admin = createAdminClient();
  const call = await findCall(admin, data);
  if (!call) {
    // Browser test calls from the ElevenLabs editor have no call row.
    return NextResponse.json({ ok: true, ignored: "no matching call" });
  }
  const nowIso = new Date().toISOString();

  if (body.type === "call_initiation_failure") {
    // A redelivered webhook finds the row already settled; do nothing twice.
    if (call.status !== "dialing") return NextResponse.json({ ok: true, ignored: "already recorded" });
    const reason = data.failure_reason ?? "unknown";
    await admin
      .from("rental_inquiry_ai_calls")
      .update({
        status: reason === "busy" || reason === "no-answer" ? "no_answer" : "failed",
        failure_reason: reason,
        conversation_id: call.conversation_id ?? data.conversation_id ?? null,
        ended_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", call.id);
    if (reason === "busy" || reason === "no-answer") await queueRetry(admin, call);
    return NextResponse.json({ ok: true });
  }

  if (body.type !== "post_call_transcription") {
    return NextResponse.json({ ok: true, ignored: body.type ?? "unknown type" });
  }

  const analysis = data.analysis ?? {};
  const collected: Record<string, unknown> = {};
  for (const [key, res] of Object.entries(analysis.data_collection_results ?? {})) {
    collected[key] = res?.value ?? null;
  }
  const evaluation: Record<string, string> = {};
  for (const [key, res] of Object.entries(analysis.evaluation_criteria_results ?? {})) {
    evaluation[key] = res?.result ?? "unknown";
  }
  const transcript = (data.transcript ?? []).map((t) => ({
    role: t.role,
    message: t.message,
    time_in_call_secs: t.time_in_call_secs,
  }));
  const outcome = typeof collected.call_outcome === "string" ? collected.call_outcome : null;
  const hotLead = collected.hot_lead === true;
  const doNotCall = collected.do_not_call === true || outcome === "do_not_call";
  const duration = data.metadata?.call_duration_secs ?? null;
  const conversationId = data.conversation_id ?? call.conversation_id ?? "";

  await admin
    .from("rental_inquiry_ai_calls")
    .update({
      status: outcome === "voicemail" ? "voicemail" : "completed",
      conversation_id: conversationId || null,
      ended_at: nowIso,
      call_outcome: outcome,
      hot_lead: hotLead,
      do_not_call: doNotCall,
      duration_secs: duration,
      summary: analysis.transcript_summary ?? null,
      collected: toJson(collected),
      evaluation: toJson(evaluation),
      transcript: toJson(transcript),
      updated_at: nowIso,
    })
    .eq("id", call.id);

  // Timeline message; provider_message_id dedupes webhook retries.
  const { data: existing } = await admin
    .from("rental_inquiry_messages")
    .select("id")
    .eq("provider_message_id", conversationId)
    .maybeSingle();
  if (!existing) {
    const { subject, body: text } = formatCallMessage({
      outcome,
      durationSecs: duration,
      hotLead,
      summary: analysis.transcript_summary ?? null,
      collected,
      evaluation,
      transcript,
      conversationId,
    });
    const { error: msgErr } = await admin.from("rental_inquiry_messages").insert({
      inquiry_id: call.inquiry_id,
      entity_id: call.entity_id,
      direction: "outbound",
      channel: "phone",
      kind: "ai_call",
      to_addrs: [call.to_number],
      subject,
      body_text: text,
      provider_message_id: conversationId || null,
      sent_at: nowIso,
    });
    if (msgErr) console.error("[ai-call-webhook] timeline insert failed", msgErr);
  }
  await admin.from("rental_inquiries").update({ last_activity_at: nowIso }).eq("id", call.inquiry_id);

  return NextResponse.json({ ok: true });
}

async function findCall(
  admin: ReturnType<typeof createAdminClient>,
  data: NonNullable<WebhookBody["data"]>
): Promise<AiCallRow | null> {
  if (data.conversation_id) {
    const { data: byConversation } = await admin
      .from("rental_inquiry_ai_calls")
      .select("*")
      .eq("conversation_id", data.conversation_id)
      .maybeSingle();
    if (byConversation) return byConversation as AiCallRow;
  }
  // Fallback when the dial response did not include a conversation id.
  const callId = data.conversation_initiation_client_data?.dynamic_variables?.closebook_call_id;
  if (typeof callId === "string" && /^[0-9a-f-]{36}$/i.test(callId)) {
    const { data: byId } = await admin.from("rental_inquiry_ai_calls").select("*").eq("id", callId).maybeSingle();
    if (byId) return byId as AiCallRow;
  }
  return null;
}
