import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/types/database.types";

export const runtime = "nodejs";

// Receives Resend delivery/open/bounce webhooks and records them against the
// outbound message they belong to (joined by resend email id). Verifies the
// Svix signature Resend sends (secret starts with `whsec_`); falls back to a
// plain bearer secret for local testing if the secret isn't a Svix key.

const EVENT_MAP: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

function verifySvix(secret: string, headers: Headers, payload: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const sigHeader = headers.get("svix-signature");
  if (!id || !timestamp || !sigHeader) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${payload}`;
  const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");

  // svix-signature is a space-separated list of "v1,<base64sig>".
  for (const part of sigHeader.split(" ")) {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    } catch {
      /* length mismatch — not a match */
    }
  }
  return false;
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const raw = await request.text();

  let authorized: boolean;
  if (secret.startsWith("whsec_")) {
    authorized = verifySvix(secret, request.headers, raw);
  } else {
    authorized = request.headers.get("authorization") === `Bearer ${secret}`;
  }
  if (!authorized) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { type?: string; created_at?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = event.type ? EVENT_MAP[event.type] : undefined;
  const resendEmailId = event.data?.email_id ?? null;
  if (!eventType || !resendEmailId) {
    // Unknown event type or missing id — acknowledge so Resend doesn't retry.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const supabase = createAdminClient();

  // Find the message this event belongs to (may be null if we never recorded it).
  const { data: message } = await supabase
    .from("rental_inquiry_messages")
    .select("id, inquiry_id")
    .eq("resend_email_id", resendEmailId)
    .maybeSingle();

  const occurredAt = event.created_at ? new Date(event.created_at).toISOString() : new Date().toISOString();

  const { error: insErr } = await supabase.from("rental_inquiry_email_events").insert({
    message_id: message?.id ?? null,
    resend_email_id: resendEmailId,
    event_type: eventType,
    payload: event as unknown as Json,
    occurred_at: occurredAt,
  });

  if (insErr) {
    console.error("[webhooks/resend] insert failed", insErr);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }

  // Surface latest activity on the inquiry timeline.
  if (message?.inquiry_id) {
    await supabase
      .from("rental_inquiries")
      .update({ last_activity_at: occurredAt })
      .eq("id", message.inquiry_id);
  }

  return NextResponse.json({ ok: true, eventType });
}
