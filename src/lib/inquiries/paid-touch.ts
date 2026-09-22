// Paid-click attribution for a lead: which ad platforms the visitor clicked
// through from before submitting, in order. The website keeps a cookie per
// platform, so one lead can carry a Google gclid, a Meta fbclid and a ChatGPT
// oppref at once (e.g. a ChatGPT click on Sep 8, then a Google click the day
// they submit). The most recent click is the lead's source (last touch); the
// earlier ones are assists.
//
// Click times:
//   Meta     the fbc cookie is fb.1.<capture epoch ms>.<fbclid>
//   ChatGPT  oppref is a Fernet token: byte 0 = 0x80, bytes 1-8 = issue time
//            (big-endian epoch seconds)
//   Google   a gclid carries no readable time, so the website sends gclid_at
//            (when it captured the click) from Sep 22, 2026 on
// A click with no known time (a gclid from before Sep 22) is treated as the
// latest touch, since each site visit through an ad overwrites that
// platform's cookie. Ties and all-unknown fall back to Meta, Google, ChatGPT.

import type { Inquiry } from "@/lib/inquiries/shared";

export type PaidPlatform = "meta" | "google" | "chatgpt";

export const PAID_PRECEDENCE: PaidPlatform[] = ["meta", "google", "chatgpt"];

export interface PaidTouch {
  platform: PaidPlatform;
  /** When the click happened, ISO. Null when it can't be told. */
  at: string | null;
}

type TouchFields = Pick<Inquiry, "gclid" | "fbclid" | "oppref"> & {
  fbc?: string | null;
  gclid_at?: string | null;
};

// Anything outside 2020 .. 2100 is a malformed value, not a click time.
function plausible(ms: number): string | null {
  return ms > 1577836800000 && ms < 4102444800000 ? new Date(ms).toISOString() : null;
}

function fbcTime(fbc: string | null | undefined): string | null {
  const parts = (fbc || "").split(".");
  return parts.length >= 4 ? plausible(Number(parts[2])) : null;
}

function opprefTime(oppref: string | null | undefined): string | null {
  if (!oppref || oppref.length < 16) return null;
  try {
    const b64 = oppref.slice(0, 16).replace(/-/g, "+").replace(/_/g, "/");
    const bytes = atob(b64);
    if (bytes.charCodeAt(0) !== 0x80) return null;
    let secs = 0;
    for (let k = 1; k <= 8; k++) secs = secs * 256 + bytes.charCodeAt(k);
    return plausible(secs * 1000);
  } catch {
    return null;
  }
}

function isoOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? plausible(ms) : null;
}

/** Every paid click on the lead, latest first. Empty for organic leads. */
export function paidTouches(i: TouchFields): PaidTouch[] {
  const touches: PaidTouch[] = [];
  if (i.fbclid) touches.push({ platform: "meta", at: fbcTime(i.fbc) });
  if (i.gclid) touches.push({ platform: "google", at: isoOrNull(i.gclid_at) });
  if (i.oppref) touches.push({ platform: "chatgpt", at: opprefTime(i.oppref) });
  return touches.sort((a, b) => {
    if (a.at !== b.at) {
      if (a.at === null) return -1;
      if (b.at === null) return 1;
      return b.at.localeCompare(a.at);
    }
    return PAID_PRECEDENCE.indexOf(a.platform) - PAID_PRECEDENCE.indexOf(b.platform);
  });
}

/** The platform that gets the lead (last touch), or null for organic. */
export function lastTouch(i: TouchFields): PaidPlatform | null {
  return paidTouches(i)[0]?.platform ?? null;
}

/** Earlier paid clicks that helped but don't get the lead. */
export function assistTouches(i: TouchFields): PaidTouch[] {
  return paidTouches(i).slice(1);
}
