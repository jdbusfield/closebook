// Meta Qualified Leads (CRM integration) — lead stage events.
//
// Events Manager's "Send a CRM event" guide for the HDR dataset asks for one
// Conversions API event every time a lead moves to a stage that matters,
// including the initial raw lead, uploaded at least daily. With those, Meta can
// see which ad clicks turn into quotes and bookings, not just form fills.
//
// Stages we report (Closebook status -> Meta event_name):
//   Lead    every inbound inquiry, at created_at
//   Quoted  first move to "Quote Sent" (or any later open stage)
//   Booked  confirmed / out / returned / completed
//
// Required by the guide: action_source "system_generated",
// custom_data.event_source "crm", custom_data.lead_event_source = CRM name.
// HDR leads come from the website form, not Instant Forms, so there is no
// Meta lead_id; matching is by click id (fbc), hashed email/phone and name.

import crypto from "crypto";
import { hashEmail } from "@/lib/google-ads/conversions";
import type { MetaCapiConfig, MetaUploadResult } from "@/lib/meta/capi";

const GRAPH_VERSION = "v21.0";

export const META_CRM_STAGES = ["Lead", "Quoted", "Booked"] as const;
export type MetaCrmStage = (typeof META_CRM_STAGES)[number];

// Closebook statuses that mean the lead has at least been quoted. A lead in a
// follow-up or responded stage was quoted first (the board runs left to right).
const QUOTED_OR_LATER = new Set([
  "quoted",
  "followup",
  "followup2",
  "followup3",
  "responded",
  "keepwarm",
]);
const BOOKED = new Set(["confirmed", "out", "returned", "completed"]);

/** Every Meta stage a lead in this Closebook status has reached, in order. */
export function stagesReached(status: string): MetaCrmStage[] {
  if (BOOKED.has(status)) return ["Lead", "Quoted", "Booked"];
  if (QUOTED_OR_LATER.has(status)) return ["Lead", "Quoted"];
  return ["Lead"];
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Meta wants phone digits only, country code included, no "+" (unlike Google,
 * which wants E.164 with the plus). US numbers without a country code get 1.
 */
export function hashMetaPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const hadPlus = phone.trim().startsWith("+");
  let digits = phone.replace(/\D/g, "");
  if (!hadPlus && digits.length === 10) digits = "1" + digits;
  if (digits.length < 11 || digits.length > 15) return null;
  return sha256Hex(digits);
}

/** First and last name, lowercased, hashed. Letters only per Meta's spec. */
function hashNameParts(name: string | null | undefined): { fn?: string; ln?: string } {
  if (!name) return {};
  const parts = name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  if (parts.length === 0) return {};
  const out: { fn?: string; ln?: string } = { fn: sha256Hex(parts[0]) };
  if (parts.length > 1) out.ln = sha256Hex(parts[parts.length - 1]);
  return out;
}

export interface MetaCrmEventInput {
  stage: MetaCrmStage;
  eventTime: Date;
  /** Stable per lead + stage, so a resend is deduped by Meta. */
  eventId: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  /** Booking value, sent on Booked only. */
  value?: number | null;
  currency?: string | null;
}

export function buildMetaCrmEvent(input: MetaCrmEventInput): Record<string, unknown> | null {
  const userData: Record<string, unknown> = {};
  const he = hashEmail(input.email);
  if (he) userData.em = [he];
  const hp = hashMetaPhone(input.phone);
  if (hp) userData.ph = [hp];
  const { fn, ln } = hashNameParts(input.name);
  if (fn) userData.fn = [fn];
  if (ln) userData.ln = [ln];
  if (input.fbc) userData.fbc = input.fbc;
  if (input.fbp) userData.fbp = input.fbp;
  if (!he && !hp && !input.fbc) return null;
  userData.country = [sha256Hex("us")];

  const customData: Record<string, unknown> = {
    event_source: "crm",
    lead_event_source: "Closebook",
  };
  if (input.stage === "Booked" && input.value != null && input.value > 0) {
    customData.value = input.value;
    customData.currency = (input.currency || "USD").toUpperCase();
  }

  return {
    event_name: input.stage,
    event_time: Math.floor(input.eventTime.getTime() / 1000),
    event_id: input.eventId,
    action_source: "system_generated",
    user_data: userData,
    custom_data: customData,
  };
}

/** Send a batch of CRM stage events (Meta accepts up to 1,000 per call). */
export async function uploadMetaCrmEvents(
  cfg: MetaCapiConfig,
  events: Record<string, unknown>[]
): Promise<MetaUploadResult> {
  if (events.length === 0) return { ok: true, eventsReceived: 0 };
  const body: Record<string, unknown> = { data: events };
  if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;

  let resp: Response;
  try {
    resp = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${cfg.pixelId}/events?access_token=${encodeURIComponent(cfg.accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const json = (await resp.json().catch(() => ({}))) as {
    events_received?: number;
    error?: { message?: string; error_user_msg?: string };
  };
  if (!resp.ok) {
    return {
      ok: false,
      error: `HTTP ${resp.status}: ${json.error?.error_user_msg || json.error?.message || "events send failed"}`,
    };
  }
  return { ok: true, eventsReceived: json.events_received };
}
