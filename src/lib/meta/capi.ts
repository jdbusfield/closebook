// Meta Conversions API uploader — offline (CRM) Purchase events.
//
// When a rental inquiry books, we report it to Meta so ad delivery optimizes
// toward people who actually book, not just people who fill the form. Matching
// is by hashed email/phone plus the fbc click id when the lead originated from
// a Facebook/Instagram ad. Deduped by event_id = the HDR-XXXXX reference.
//
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api
//
// All credentials come from env. If any are missing the module reports
// "not configured" and the caller no-ops — nothing is sent and nothing fails.

import { hashEmail, hashPhone } from "@/lib/google-ads/conversions";

const GRAPH_VERSION = "v21.0";

// The CAPI rejects events whose event_time is older than 7 days. Bookings that
// predate Meta tracking can never be sent — the cron marks them skipped.
export const META_MAX_EVENT_AGE_DAYS = 7;

export interface MetaCapiConfig {
  pixelId: string;
  accessToken: string;
  /** Events Manager "Test events" code — set only while validating the wiring. */
  testEventCode?: string;
}

/** Reads + validates the Meta env. Returns null when not fully configured. */
export function getMetaCapiConfig(): MetaCapiConfig | null {
  const pixelId = process.env.META_PIXEL_ID?.trim();
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim();
  const testEventCode = process.env.META_TEST_EVENT_CODE?.trim();
  if (!pixelId || !accessToken) return null;
  return { pixelId, accessToken, testEventCode: testEventCode || undefined };
}

export interface MetaPurchaseInput {
  email?: string | null;
  phone?: string | null;
  /** Meta click id cookie value (fb.1.<ts>.<fbclid>) captured on the website. */
  fbc?: string | null;
  /** Meta browser id cookie (_fbp) captured on the website. */
  fbp?: string | null;
  value: number;
  currency?: string | null;
  /** Stable id for de-duplication across re-uploads (the HDR-XXXXX ref). */
  eventId: string;
  occurredAt: Date;
}

export interface MetaUploadResult {
  ok: boolean;
  error?: string;
  eventsReceived?: number;
}

/**
 * Send a single offline Purchase event. Returns {ok:false, error} on any
 * problem rather than throwing.
 */
export async function uploadMetaPurchase(
  cfg: MetaCapiConfig,
  input: MetaPurchaseInput
): Promise<MetaUploadResult> {
  const userData: Record<string, unknown> = {};
  const he = hashEmail(input.email);
  if (he) userData.em = [he];
  const hp = hashPhone(input.phone);
  if (hp) userData.ph = [hp];
  if (input.fbc) userData.fbc = input.fbc;
  if (input.fbp) userData.fbp = input.fbp;

  if (!he && !hp && !input.fbc) {
    return { ok: false, error: "No hashable email/phone and no fbc — cannot match this conversion" };
  }

  const body: Record<string, unknown> = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(input.occurredAt.getTime() / 1000),
        event_id: input.eventId,
        // CRM-sourced conversion (a rep marked the deal booked) — not a website event.
        action_source: "system_generated",
        user_data: userData,
        custom_data: {
          value: input.value,
          currency: (input.currency || "USD").toUpperCase(),
          order_id: input.eventId,
        },
      },
    ],
  };
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
    error?: { message?: string };
  };

  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}: ${json.error?.message || "events send failed"}` };
  }
  return { ok: true, eventsReceived: json.events_received };
}
