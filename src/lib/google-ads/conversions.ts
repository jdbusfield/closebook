// Google Ads — Enhanced Conversions for Leads uploader.
//
// We send "offline" conversions for HDR rental bookings: when a lead becomes a
// won rental in the CRM, we tell Google Ads the booking happened and what it's
// worth. Because we don't capture the gclid on the website form (yet), the
// click is matched back to the conversion by the customer's HASHED email/phone
// — this is Google's "Enhanced Conversions for Leads" flow. If a gclid is ever
// stored on the inquiry, we send it too for stronger, click-level matching.
//
// All credentials come from env. If any are missing the module reports
// "not configured" and the caller no-ops — nothing is sent and nothing fails.

import crypto from "node:crypto";

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v18";

interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string; // the account that owns the conversion action (digits only)
  loginCustomerId?: string; // manager (MCC) id, if access is via a manager
  conversionActionId: string; // numeric id of the "rental booked" conversion action
}

/** Reads + validates the Google Ads env. Returns null when not fully configured. */
export function getGoogleAdsConfig(): GoogleAdsConfig | null {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID?.trim().replace(/-/g, "");
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim().replace(/-/g, "");
  const conversionActionId = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID?.trim();

  if (
    !developerToken ||
    !clientId ||
    !clientSecret ||
    !refreshToken ||
    !customerId ||
    !conversionActionId
  ) {
    return null;
  }
  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    customerId,
    loginCustomerId: loginCustomerId || undefined,
    conversionActionId,
  };
}

// ---------------------------------------------------------------------------
// Hashing — Google requires SHA-256 of the NORMALIZED value, lowercase hex.
// ---------------------------------------------------------------------------
function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** Normalize then hash an email (trim + lowercase). Gmail dot/plus handling is
 *  left to Google. Returns null for anything that isn't a plausible email. */
export function hashEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const norm = email.trim().toLowerCase();
  if (!norm.includes("@")) return null;
  return sha256Hex(norm);
}

/** Normalize a US phone to E.164 (+1XXXXXXXXXX) then hash. Returns null if we
 *  can't confidently form an E.164 number. */
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

// Google Ads wants "yyyy-mm-dd hh:mm:ss+|-hh:mm". We report in UTC (+00:00).
function formatConversionDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+00:00`
  );
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
}

export interface UploadResult {
  ok: boolean;
  error?: string;
}

/**
 * Upload a single lead conversion. Builds one ClickConversion with hashed
 * user identifiers (and gclid if present) and posts it to the Google Ads API
 * with partialFailure enabled, so a per-row problem comes back as an error
 * string rather than throwing.
 */
export async function uploadLeadConversion(
  cfg: GoogleAdsConfig,
  input: LeadConversionInput
): Promise<UploadResult> {
  const userIdentifiers: Array<Record<string, string>> = [];
  const he = hashEmail(input.email);
  if (he) userIdentifiers.push({ hashedEmail: he });
  const hp = hashPhone(input.phone);
  if (hp) userIdentifiers.push({ hashedPhoneNumber: hp });

  if (!input.gclid && userIdentifiers.length === 0) {
    return { ok: false, error: "No gclid and no hashable email/phone — cannot match this conversion" };
  }

  const conversion: Record<string, unknown> = {
    conversionAction: `customers/${cfg.customerId}/conversionActions/${cfg.conversionActionId}`,
    conversionDateTime: formatConversionDateTime(input.occurredAt ?? new Date()),
    orderId: input.orderId,
  };
  if (input.gclid) conversion.gclid = input.gclid;
  if (userIdentifiers.length) conversion.userIdentifiers = userIdentifiers;
  if (typeof input.value === "number" && input.value > 0) {
    conversion.conversionValue = input.value;
    conversion.currencyCode = (input.currency || "USD").toUpperCase();
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(cfg);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const url = `https://googleads.googleapis.com/${API_VERSION}/customers/${cfg.customerId}:uploadClickConversions`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": cfg.developerToken,
    "Content-Type": "application/json",
  };
  if (cfg.loginCustomerId) headers["login-customer-id"] = cfg.loginCustomerId;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ conversions: [conversion], partialFailure: true }),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const json = (await resp.json().catch(() => ({}))) as {
    error?: { message?: string };
    partialFailureError?: { message?: string };
    results?: unknown[];
  };

  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}: ${json.error?.message || "upload failed"}` };
  }
  // Per-conversion validation problems surface here even on a 200.
  if (json.partialFailureError?.message) {
    return { ok: false, error: json.partialFailureError.message };
  }
  if (!json.results || json.results.length === 0) {
    return { ok: false, error: "Google Ads accepted the request but returned no result" };
  }
  return { ok: true };
}
