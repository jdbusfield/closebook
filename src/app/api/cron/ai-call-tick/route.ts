import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiCallConfig, dialAiCall, type AiCallRow } from "@/lib/inquiries/ai-call";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// Every-minute AI call tick: dial each queued HDR inquiry call that is due.
//
// Calls are queued by the inquiry ingest route with scheduled_for already
// pushed into calling hours, so this only dials what is due. dialAiCall claims
// each row before dialing, so overlapping runs never double-dial. Calls stuck
// in "dialing" for two hours (no webhook ever arrived) are marked failed.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
// ============================================================================

const BATCH_LIMIT = 10;
const STALE_DIALING_MS = 2 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!aiCallConfig().enabled) {
    return NextResponse.json({ ok: true, disabled: true });
  }

  const admin = createAdminClient();
  const now = new Date();

  await admin
    .from("rental_inquiry_ai_calls")
    .update({ status: "failed", failure_reason: "no result from ElevenLabs", updated_at: now.toISOString() })
    .eq("status", "dialing")
    .lt("dialed_at", new Date(now.getTime() - STALE_DIALING_MS).toISOString());

  const { data: due, error } = await admin
    .from("rental_inquiry_ai_calls")
    .select("*")
    .eq("status", "queued")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const call of (due ?? []) as AiCallRow[]) {
    const result = await dialAiCall(admin, call);
    results.push({ call: call.id, inquiry: call.inquiry_id, ...result });
    if (result.outcome === "error") {
      console.error("[cron/ai-call-tick] dial failed", call.id, result.error);
    }
  }

  return NextResponse.json({ ok: true, due: due?.length ?? 0, results });
}
