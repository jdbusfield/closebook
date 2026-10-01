// AI callback for HDR restroom-trailer inquiries.
//
// Flow: the ingest route queues one call per eligible website inquiry
// (queueAiCall). The ai-call-tick cron dials due calls through the ElevenLabs
// agent (dialAiCall). ElevenLabs posts the result to the ai-call-webhook route,
// which stores the outcome on the call row and writes an "ai_call" message onto
// the inquiry timeline. Everything is off unless AI_CALLS_ENABLED=true.
//
// Env:
//   AI_CALLS_ENABLED                  "true" to queue and dial
//   ELEVENLABS_API_KEY                ElevenAgents API key
//   ELEVENLABS_AGENT_ID               the HDR callback agent
//   ELEVENLABS_AGENT_PHONE_NUMBER_ID  the Twilio number imported into ElevenLabs
//   ELEVENLABS_WEBHOOK_SECRET         post-call webhook HMAC secret
//   AI_CALL_ALLOWLIST                 optional comma list of E.164 numbers; when
//                                     set, only these numbers are ever called (pilot)
//   AI_CALL_HOURS                     calling window in LA time, default "9-18"
//                                     (6pm PT = 9pm ET, the latest legal hour on the East Coast)
//   AI_CALL_DELAY_MINUTES             wait after the form submit, default 2

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database.types";
import { HDR_ENTITY_ID, needsOutreachStatus } from "./shared";

type Admin = SupabaseClient<Database>;
export type AiCallRow = Database["public"]["Tables"]["rental_inquiry_ai_calls"]["Row"];

const TZ = "America/Los_Angeles";
export const MAX_ATTEMPTS = 2;
export const RETRY_AFTER_MINUTES = 120;
/** A queued call this far past its slot is dropped, not dialed late. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
// Area codes where a 9am-6pm PT call can land outside 8am-9pm local time:
// Hawaii, Alaska, American Samoa (behind LA); Puerto Rico and USVI (+3-4h);
// Guam and CNMI (+17-18h).
const OUTSIDE_WINDOW_AREA_CODES = new Set(["808", "907", "684", "787", "939", "340", "671", "670"]);

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

/** US numbers only: 10 digits, or 11 starting with 1. Anything else is null. */
export function toE164(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10 && !/^[01]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1") && !/^[01]/.test(digits.slice(1))) return `+${digits}`;
  return null;
}

export function parseHours(raw: string | undefined): { start: number; end: number } {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec((raw ?? "").trim());
  if (m) {
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (start >= 0 && end <= 24 && start < end) return { start, end };
  }
  return { start: 9, end: 18 };
}

function laParts(d: Date): { y: number; m: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Minutes LA is offset from UTC at instant d (e.g. -420 in PDT). */
function laOffsetMinutes(d: Date): number {
  const p = laParts(d);
  const asUtc = Date.UTC(p.y, p.m - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

/** The UTC instant of hour:00 LA time on the LA calendar day (y, m, day). */
function laWallClock(y: number, m: number, day: number, hour: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, day, hour));
  const first = new Date(guess.getTime() - laOffsetMinutes(guess) * 60000);
  // Re-check the offset at the result in case the guess straddled a DST change.
  return new Date(guess.getTime() - laOffsetMinutes(first) * 60000);
}

export function inCallingHours(at: Date, hours: { start: number; end: number }): boolean {
  const h = laParts(at).hour;
  return h >= hours.start && h < hours.end;
}

/**
 * Earliest time to dial: `from` plus the delay, pushed to the next window
 * opening when that lands outside calling hours (LA time).
 */
export function nextCallTime(from: Date, delayMinutes: number, hours: { start: number; end: number }): Date {
  const candidate = new Date(from.getTime() + delayMinutes * 60000);
  const p = laParts(candidate);
  if (p.hour >= hours.start && p.hour < hours.end) return candidate;
  if (p.hour < hours.start) return laWallClock(p.y, p.m, p.day, hours.start);
  // After hours: next LA calendar day. Step from local noon to dodge DST edges.
  const noonTomorrow = new Date(laWallClock(p.y, p.m, p.day, 12).getTime() + 24 * 3600000);
  const t = laParts(noonTomorrow);
  return laWallClock(t.y, t.m, t.day, hours.start);
}

export interface InquiryForCall {
  entity_id: string;
  source: string | null;
  request_type: string | null;
  phone: string | null;
}

/** Why an inquiry should not get an AI call, or null when it should. */
export function ineligibleReason(
  inq: InquiryForCall,
  opts: { enabled: boolean; allowlist: string[] }
): string | null {
  if (!opts.enabled) return "disabled";
  if (inq.entity_id !== HDR_ENTITY_ID || (inq.source ?? "website") !== "website") return "not an HDR site inquiry";
  if ((inq.request_type ?? "inquiry") !== "inquiry") return "not a quote inquiry";
  const number = toE164(inq.phone);
  if (!number) return "no valid US phone";
  if (OUTSIDE_WINDOW_AREA_CODES.has(number.slice(2, 5))) return "area code outside calling hours";
  if (opts.allowlist.length && !opts.allowlist.includes(number)) return "not on pilot allowlist";
  return null;
}

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => toE164(s.trim())).filter((s): s is string => !!s);
}

export interface InquiryDetails {
  name: string | null;
  use_case: string | null;
  start_date: string | null;
  end_date: string | null;
  guests: string | null;
  location: string | null;
  notes: string | null;
}

/** Every variable the agent prompt references. A missing one fails the call. */
export function dynamicVariables(inq: InquiryDetails, callId: string): Record<string, string> {
  const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : "unknown");
  const firstName = (inq.name ?? "").trim().split(/\s+/)[0] || "there";
  return {
    customer_name: firstName,
    event_type: v(inq.use_case),
    start_date: v(inq.start_date),
    end_date: v(inq.end_date || inq.start_date),
    guests: v(inq.guests),
    event_location: v(inq.location),
    notes: v(inq.notes).slice(0, 500),
    closebook_call_id: callId,
  };
}

/**
 * ElevenLabs signs webhooks with `elevenlabs-signature: t=<unix>,v0=<hex>`,
 * where hex = HMAC-SHA256(secret, "<t>.<raw body>").
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs = Date.now(),
  toleranceSecs = 30 * 60
): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  );
  const t = Number(parts.t);
  const sig = parts.v0;
  if (!Number.isFinite(t) || !sig) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSecs) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface TranscriptTurn {
  role: string;
  message: string | null;
  time_in_call_secs?: number;
}

function fmtDuration(secs: number | null | undefined): string {
  if (!secs || secs < 0) return "0s";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m ? `${m}m ${s}s` : `${s}s`;
}

const FIELD_LABELS: Array<[string, string]> = [
  ["event_date", "Date"],
  ["event_times", "Times"],
  ["guest_count", "Guests"],
  ["location", "Location"],
  ["callback_time", "Call back"],
  ["notes", "Notes"],
];

const OUTCOME_LABELS: Record<string, string> = {
  completed: "Completed",
  callback_requested: "Wants a callback",
  not_interested: "Not interested",
  do_not_call: "Asked us not to call",
  wrong_number: "Wrong number",
  voicemail: "Voicemail",
  hung_up_early: "Hung up early",
};

export function outcomeLabel(outcome: string | null | undefined): string {
  return (outcome && OUTCOME_LABELS[outcome]) || (outcome ? outcome.replace(/_/g, " ") : "Call ended");
}

/** Subject + plain-text body for the timeline message. */
export function formatCallMessage(input: {
  outcome: string | null;
  durationSecs: number | null;
  hotLead: boolean | null;
  summary: string | null;
  collected: Record<string, unknown>;
  evaluation: Record<string, string>;
  transcript: TranscriptTurn[];
  conversationId: string;
}): { subject: string; body: string } {
  const subject = `AI call · ${outcomeLabel(input.outcome)} · ${fmtDuration(input.durationSecs)}${input.hotLead ? " · HOT LEAD" : ""}`;
  const lines: string[] = [];
  if (input.summary) lines.push(input.summary.trim(), "");
  const fields = FIELD_LABELS
    .map(([k, label]) => {
      const val = input.collected[k];
      return val === null || val === undefined || val === "" ? null : `${label}: ${String(val)}`;
    })
    .filter(Boolean) as string[];
  if (fields.length) lines.push(...fields, "");
  const checks = Object.entries(input.evaluation);
  if (checks.length) {
    lines.push(`Checks: ${checks.map(([k, r]) => `${k.replace(/_/g, " ")} ${r}`).join(" · ")}`, "");
  }
  if (input.transcript.length) {
    lines.push("Transcript");
    for (const turn of input.transcript) {
      if (!turn.message) continue;
      lines.push(`${turn.role === "agent" ? "HDR AI" : "Customer"}: ${turn.message.trim()}`);
    }
    lines.push("");
  }
  lines.push(`Recording: https://elevenlabs.io/app/agents/history/${input.conversationId}`);
  return { subject, body: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Side effects
// ---------------------------------------------------------------------------

export function aiCallConfig() {
  return {
    enabled: process.env.AI_CALLS_ENABLED === "true",
    allowlist: parseAllowlist(process.env.AI_CALL_ALLOWLIST),
    hours: parseHours(process.env.AI_CALL_HOURS),
    delayMinutes: Math.max(0, Number(process.env.AI_CALL_DELAY_MINUTES ?? 2) || 0),
  };
}

/**
 * Queue the first call for a freshly ingested inquiry. Idempotent: an inquiry
 * that already has any call row is left alone, and a number that asked us to
 * stop calling is never queued again. Never throws.
 */
export async function queueAiCall(admin: Admin, inquiryId: string): Promise<string> {
  try {
    const cfg = aiCallConfig();
    const { data: inq } = await admin
      .from("rental_inquiries")
      .select("id, entity_id, source, request_type, phone")
      .eq("id", inquiryId)
      .maybeSingle();
    if (!inq) return "inquiry not found";
    const reason = ineligibleReason(inq, cfg);
    if (reason) return reason;
    const toNumber = toE164(inq.phone)!;

    const { data: existing } = await admin
      .from("rental_inquiry_ai_calls")
      .select("id")
      .eq("inquiry_id", inquiryId)
      .limit(1);
    if (existing?.length) return "already queued";

    const { data: dnc } = await admin
      .from("rental_inquiry_ai_calls")
      .select("id")
      .eq("to_number", toNumber)
      .eq("do_not_call", true)
      .limit(1);
    if (dnc?.length) return "number asked not to be called";

    const { error } = await admin.from("rental_inquiry_ai_calls").insert({
      inquiry_id: inquiryId,
      entity_id: inq.entity_id,
      to_number: toNumber,
      scheduled_for: nextCallTime(new Date(), cfg.delayMinutes, cfg.hours).toISOString(),
    });
    if (error) return `queue failed: ${error.message}`;
    return "queued";
  } catch (err) {
    return `queue failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Dial one queued call. Claims the row (queued -> dialing) first so two
 * overlapping cron runs can never dial the same call twice.
 */
export async function dialAiCall(admin: Admin, call: AiCallRow): Promise<{ outcome: string; error?: string }> {
  // A backlog (flag off for a day, cron outage) is dropped rather than
  // phoning customers about a day-old request out of the blue.
  if (Date.now() - new Date(call.scheduled_for).getTime() > STALE_AFTER_MS) {
    await admin
      .from("rental_inquiry_ai_calls")
      .update({ status: "canceled", failure_reason: "stale: missed its calling slot", updated_at: new Date().toISOString() })
      .eq("id", call.id)
      .eq("status", "queued");
    return { outcome: "canceled" };
  }
  const { data: claimed } = await admin
    .from("rental_inquiry_ai_calls")
    .update({ status: "dialing", dialed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", call.id)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (!claimed) return { outcome: "skipped", error: "already claimed" };

  const fail = async (reason: string) => {
    await admin
      .from("rental_inquiry_ai_calls")
      .update({ status: "failed", failure_reason: reason.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", call.id);
    return { outcome: "error", error: reason };
  };

  const { data: inq } = await admin
    .from("rental_inquiries")
    .select("name, use_case, start_date, end_date, guests, location, notes, status")
    .eq("id", call.inquiry_id)
    .maybeSingle();
  if (!inq) return fail("inquiry deleted");
  // Someone booked, lost or parked it (keep warm) while the call waited.
  if (!needsOutreachStatus(inq.status ?? "")) {
    await admin
      .from("rental_inquiry_ai_calls")
      .update({ status: "canceled", failure_reason: `inquiry is ${inq.status}`, updated_at: new Date().toISOString() })
      .eq("id", call.id);
    return { outcome: "canceled" };
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const phoneNumberId = process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID;
  if (!apiKey || !agentId || !phoneNumberId) return fail("ElevenLabs env vars missing");

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId,
        agent_phone_number_id: phoneNumberId,
        to_number: call.to_number,
        conversation_initiation_client_data: { dynamic_variables: dynamicVariables(inq, call.id) },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean; message?: string; conversation_id?: string; callSid?: string; detail?: unknown;
    };
    if (!res.ok || json.success === false) {
      return fail(`ElevenLabs ${res.status}: ${json.message ?? JSON.stringify(json.detail ?? json)}`);
    }
    await admin
      .from("rental_inquiry_ai_calls")
      .update({
        conversation_id: json.conversation_id ?? null,
        call_sid: json.callSid ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", call.id);
    return { outcome: "dialed" };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Queue one retry after a no-answer/busy attempt, inside calling hours. The
 * unique (inquiry_id, attempt) index rejects a second retry row, so a
 * redelivered webhook can never phone the customer twice.
 */
export async function queueRetry(admin: Admin, call: AiCallRow): Promise<void> {
  if (call.attempt >= MAX_ATTEMPTS) return;
  const cfg = aiCallConfig();
  const { error } = await admin.from("rental_inquiry_ai_calls").insert({
    inquiry_id: call.inquiry_id,
    entity_id: call.entity_id,
    to_number: call.to_number,
    attempt: call.attempt + 1,
    scheduled_for: nextCallTime(new Date(), RETRY_AFTER_MINUTES, cfg.hours).toISOString(),
  });
  if (error && error.code !== "23505") console.error("[ai-call] retry not queued", error.message);
}

export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}
