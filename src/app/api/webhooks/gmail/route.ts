import { NextResponse } from "next/server";
import { verifyPushToken } from "@/lib/google/gmail";
import { isWatchedMailbox, reconcileMailbox } from "@/lib/google/gmail-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// Gmail -> Cloud Pub/Sub push receiver.
//
// Google publishes a tiny notification ({ emailAddress, historyId }) to a
// Pub/Sub topic whenever a watched mailbox changes; Pub/Sub then PUSHes it here
// as an OIDC-signed POST. We verify the push is genuinely from Google, then
// pull the actual new messages via the Gmail API and record them in the CRM.
//
// Auth: the Pub/Sub subscription is configured with an OIDC token, verified
// against GMAIL_PUSH_SERVICE_ACCOUNT. A `?token=<INBOUND_EMAIL_SECRET>` query
// param is accepted as a fallback for manual/local testing only.
//
// Always ACK with 200 once authenticated (even on dedupe/skip) so Pub/Sub does
// not redeliver forever. Return 5xx only on a genuine transient failure that a
// retry could fix.
// ============================================================================

interface PubSubEnvelope {
  message?: { data?: string; messageId?: string };
  subscription?: string;
}

export async function POST(request: Request) {
  const url = new URL(request.url);

  // --- Authenticate the push ------------------------------------------------
  const fallbackSecret = process.env.INBOUND_EMAIL_SECRET;
  const fallbackOk =
    !!fallbackSecret && url.searchParams.get("token") === fallbackSecret;

  if (!fallbackOk) {
    const audience = process.env.GMAIL_PUSH_AUDIENCE || undefined;
    const ok = await verifyPushToken(request.headers.get("authorization"), audience);
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // --- Decode the Pub/Sub envelope ------------------------------------------
  let envelope: PubSubEnvelope;
  try {
    envelope = (await request.json()) as PubSubEnvelope;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dataB64 = envelope.message?.data;
  if (!dataB64) {
    // Pub/Sub subscription verification / empty message — ack so it settles.
    return NextResponse.json({ ok: true, ignored: "no-data" });
  }

  let notification: { emailAddress?: string; historyId?: string | number };
  try {
    notification = JSON.parse(Buffer.from(dataB64, "base64").toString("utf8"));
  } catch {
    return NextResponse.json({ ok: true, ignored: "bad-data" });
  }

  const mailbox = notification.emailAddress;
  const historyId =
    notification.historyId != null ? String(notification.historyId) : "";
  if (!mailbox || !historyId) {
    return NextResponse.json({ ok: true, ignored: "incomplete" });
  }

  // --- Allowlist guard ------------------------------------------------------
  if (!isWatchedMailbox(mailbox)) {
    return NextResponse.json({ ok: true, ignored: "not-watched" });
  }

  // --- Pull + record the new messages ---------------------------------------
  try {
    const counts = await reconcileMailbox(mailbox, historyId);
    return NextResponse.json({ ok: true, mailbox, ...counts });
  } catch (err) {
    // Transient (token mint, Gmail 5xx) — let Pub/Sub retry.
    console.error("[webhooks/gmail] reconcile failed", mailbox, err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
