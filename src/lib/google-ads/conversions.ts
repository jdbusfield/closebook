// Google Ads conversion uploader — via the Data Manager API.
//
// As of Google's 2026-06-15 migration, offline conversions / enhanced
// conversions for leads for Google Ads are sent through the Data Manager API
// (events:ingest), NOT the legacy Google Ads API ConversionUploadService
// (which is now closed to new accounts). We report a won rental as an event
// matched to the originating ad click by the customer's hashed email/phone.
//
// Docs: https://developers.google.com/data-manager/api/devguides/events/google-ads/offline
//
// All credentials come from env. If any are missing the module reports
// "not configured" and the caller no-ops — nothing is sent and nothing fails.

import crypto from "node:crypto";

const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";

interface GoogleAdsConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  // Operating account = the Google Ads account that owns the conversion action
  // (digits only, no dashes).
  customerId: string;
  // Login account = the manager (MCC) the call is made through. Optional.
  loginCustomerId?: string;
  // The Google Ads conversion action ID → Data Manager `productDestinationId`.
  conversionActionId: string;
}

/** Reads + validates the Google Ads env. Returns null when not fully configured. */
export function getGoogleAdsConfig(): GoogleAdsConfig | null {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.trim().replace(/-/g, "");
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim().replace(/-/g, "");
  const conversionActionId = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID?.trim();

  if (!clientId || !clientSecret || !refreshToken || !customerId || !conversionActionId) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
    customerId,
    loginCustomerId: loginCustomerId || undefined,
    conversionActionId,
  };
}

// ---------------------------------------------------------------------------
// Hashing — Data Manager requires SHA-256 of the NORMALIZED value. We emit
// lowercase hex and send `encoding: "HEX"` to match.
// ---------------------------------------------------------------------------
function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** Normalize then hash an email (trim + lowercase). Returns null for non-emails. */
export function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const norm = email.trim().toLowerCase();
  if (!norm.includes("@")) return null;
  return sha256Hex(norm);
}

/** Normalize a US phone to E.164 (+1XXXXXXXXXX) then hash. Null if not formable. */
export function hashPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    // already has a country code
  } else if (digits.length === 10) {
    digits = "+1" + digits;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    digits = "+" + digits;
  } else {
    return null; // ambiguous — don't send a bad identifier
  }
  return sha256Hex(digits);
}

// ---------------------------------------------------------------------------
// OAuth — exchange the long-lived refresh token for a short-lived access token.
// The refresh token must be minted with the scope
// https://www.googleapis.com/auth/datamanager.
// ---------------------------------------------------------------------------
async function getAccessToken(cfg: GoogleAdsConfig): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await resp.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!resp.ok || !json.access_token) {
    throw new Error(
      `Google OAuth token exchange failed (${resp.status}): ${json.error_description || json.error || "unknown"}`
    );
  }
  return json.access_token;
}

export interface LeadConversionInput {
  email?: string | null;
  phone?: string | null;
  gclid?: string | null;
  /** Booking value in the account currency. Omit/null → no value sent. */
  value?: number | null;
  currency?: string | null;
  /** Stable id for de-duplication across re-uploads (we use the HDR-XXXXX ref). */
  orderId: string;
  /** When the conversion happened. Defaults to now. */
  occurredAt?: Date;
  /** Validate the request without recording the conversion (for testing). */
  validateOnly?: boolean;
}

export interface UploadResult {
  ok: boolean;
  error?: string;
  requestId?: string;
}

/**
 * Send a single lead conversion to the Data Manager API. The event is matched
 * to the originating ad click by hashed email/phone (and gclid if present).
 * Returns {ok:false, error} on any problem rather than throwing.
 */
export async function uploadLeadConversion(
  cfg: GoogleAdsConfig,
  input: LeadConversionInput
): Promise<UploadResult> {
  const userIdentifiers: Array<Record<string, string>> = [];
  const he = hashEmail(input.email);
  if (he) userIdentifiers.push({ emailAddress: he });
  const hp = hashPhone(input.phone);
  if (hp) userIdentifiers.push({ phoneNumber: hp });

  if (!input.gclid && userIdentifiers.length === 0) {
    return { ok: false, error: "No gclid and no hashable email/phone — cannot match this conversion" };
  }

  const event: Record<string, unknown> = {
    transactionId: input.orderId,
    eventTimestamp: (input.occurredAt ?? new Date()).toISOString(), // RFC 3339
    eventSource: "WEB",
  };
  if (userIdentifiers.length) event.userData = { userIdentifiers };
  if (input.gclid) event.adIdentifiers = { gclid: input.gclid };
  if (typeof input.value === "number" && input.value > 0) {
    event.conversionValue = input.value;
    event.currency = (input.currency || "USD").toUpperCase();
  }

  const operatingAccount = { accountType: "GOOGLE_ADS", accountId: cfg.customerId };
  const destination: Record<string, unknown> = {
    operatingAccount,
    productDestinationId: cfg.conversionActionId,
  };
  if (cfg.loginCustomerId) {
    destination.loginAccount = { accountType: "GOOGLE_ADS", accountId: cfg.loginCustomerId };
  }

  const body = {
    destinations: [destination],
    encoding: "HEX",
    events: [event],
    validateOnly: input.validateOnly ?? false,
  };

  let accessToken: string;
  try {
    accessToken = await getAccessToken(cfg);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  let resp: Response;
  try {
    resp = await fetch(INGEST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const json = (await resp.json().catch(() => ({}))) as {
    error?: { message?: string };
    requestId?: string;
  };

  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}: ${json.error?.message || "ingest failed"}` };
  }
  return { ok: true, requestId: json.requestId };
}
