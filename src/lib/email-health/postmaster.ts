// Google Postmaster Tools: the only source of Gmail's own verdict on a
// sending domain (user-reported spam rate, domain reputation, how much mail
// passed SPF / DKIM / DMARC). Read with a refresh token obtained through
// /api/ads/postmaster-oauth (scope postmaster.readonly) and stored in
// ad_platform_credentials under platform "google", key
// "postmaster_refresh_token". The Google account that consents must be one
// that owns the domain in postmaster.google.com.

import { getStoredCredential } from "@/lib/ads/credentials";

export const POSTMASTER_CREDENTIAL_KEY = "postmaster_refresh_token";
export const POSTMASTER_SCOPE = "https://www.googleapis.com/auth/postmaster.readonly";

const API = "https://gmailpostmastertools.googleapis.com/v1";

export type Reputation = "HIGH" | "MEDIUM" | "LOW" | "BAD" | "REPUTATION_CATEGORY_UNSPECIFIED";

export interface PostmasterDay {
  date: string; // YYYY-MM-DD
  spamRatio: number | null;
  domainReputation: Reputation | null;
  spfSuccessRatio: number | null;
  dkimSuccessRatio: number | null;
  dmarcSuccessRatio: number | null;
  outboundEncryptionRatio: number | null;
  ipReputations: { reputation: Reputation; sampleSize: number }[];
  deliveryErrors: { errorClass: string; errorType: string; errorRatio: number }[];
}

export interface PostmasterHealth {
  connected: boolean;
  /** Set when connected but the read failed, with the reason to show. */
  error: string | null;
  domainVerified: boolean | null;
  days: PostmasterDay[];
  /** The most recent day Google reported anything for. */
  latest: PostmasterDay | null;
}

interface RawStat {
  name?: string;
  userReportedSpamRatio?: number;
  ipReputations?: { ipReputation?: Reputation; sampleSize?: number }[];
  domainReputation?: Reputation;
  spfSuccessRatio?: number;
  dkimSuccessRatio?: number;
  dmarcSuccessRatio?: number;
  outboundEncryptionRatio?: number;
  deliveryErrors?: { errorClass?: string; errorType?: string; errorRatio?: number }[];
}

async function accessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("GOOGLE_ADS_CLIENT_ID / SECRET are not set");
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await resp.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!resp.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `token refresh HTTP ${resp.status}`);
  }
  return json.access_token;
}

function dayFromName(name: string | undefined): string {
  // domains/example.com/trafficStats/20260908
  const m = name?.match(/(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function toDay(s: RawStat): PostmasterDay {
  return {
    date: dayFromName(s.name),
    spamRatio: typeof s.userReportedSpamRatio === "number" ? s.userReportedSpamRatio : null,
    domainReputation: s.domainReputation ?? null,
    spfSuccessRatio: typeof s.spfSuccessRatio === "number" ? s.spfSuccessRatio : null,
    dkimSuccessRatio: typeof s.dkimSuccessRatio === "number" ? s.dkimSuccessRatio : null,
    dmarcSuccessRatio: typeof s.dmarcSuccessRatio === "number" ? s.dmarcSuccessRatio : null,
    outboundEncryptionRatio: typeof s.outboundEncryptionRatio === "number" ? s.outboundEncryptionRatio : null,
    ipReputations: (s.ipReputations ?? []).map((r) => ({
      reputation: r.ipReputation ?? "REPUTATION_CATEGORY_UNSPECIFIED",
      sampleSize: r.sampleSize ?? 0,
    })),
    deliveryErrors: (s.deliveryErrors ?? []).map((e) => ({
      errorClass: e.errorClass ?? "",
      errorType: e.errorType ?? "",
      errorRatio: e.errorRatio ?? 0,
    })),
  };
}

export async function readPostmaster(domain: string, days = 30): Promise<PostmasterHealth> {
  const empty: PostmasterHealth = { connected: false, error: null, domainVerified: null, days: [], latest: null };
  const refresh = await getStoredCredential("google", POSTMASTER_CREDENTIAL_KEY);
  if (!refresh) return empty;

  try {
    const token = await accessToken(refresh);
    const headers = { Authorization: `Bearer ${token}` };

    const dom = await fetch(`${API}/domains/${encodeURIComponent(domain)}`, { headers });
    const domJson = (await dom.json()) as { permission?: string; error?: { message?: string; status?: string } };
    if (!dom.ok) {
      const msg = domJson.error?.message || `HTTP ${dom.status}`;
      const hint = /not been used|is disabled|accessNotConfigured/i.test(msg)
        ? " Enable the Gmail Postmaster Tools API in the Google Cloud project that owns the OAuth client."
        : /permission|forbidden|not found/i.test(msg)
          ? ` The Google account that connected does not own ${domain} in Postmaster Tools.`
          : "";
      return { ...empty, connected: true, error: msg + hint };
    }
    const verified = domJson.permission === "OWNER" || domJson.permission === "READER";

    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - days);
    const q = new URLSearchParams({
      "startDate.year": String(start.getFullYear()),
      "startDate.month": String(start.getMonth() + 1),
      "startDate.day": String(start.getDate()),
      "endDate.year": String(end.getFullYear()),
      "endDate.month": String(end.getMonth() + 1),
      "endDate.day": String(end.getDate()),
      pageSize: "100",
    });
    const stats = await fetch(`${API}/domains/${encodeURIComponent(domain)}/trafficStats?${q}`, { headers });
    const statsJson = (await stats.json()) as { trafficStats?: RawStat[]; error?: { message?: string } };
    if (!stats.ok) {
      return { ...empty, connected: true, domainVerified: verified, error: statsJson.error?.message || `HTTP ${stats.status}` };
    }
    const rows = (statsJson.trafficStats ?? []).map(toDay).sort((a, b) => a.date.localeCompare(b.date));
    const latest =
      [...rows].reverse().find((d) => d.domainReputation || d.spamRatio != null || d.dmarcSuccessRatio != null) ?? null;
    return { connected: true, error: null, domainVerified: verified, days: rows, latest };
  } catch (e) {
    return { ...empty, connected: true, error: e instanceof Error ? e.message : String(e) };
  }
}
