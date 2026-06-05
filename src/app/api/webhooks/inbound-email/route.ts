import { NextResponse } from "next/server";
import { ingestEmailMessage } from "@/lib/inquiries/ingest-message";

export const runtime = "nodejs";

// Receives parsed inbound email from the capture address (the group address that
// is CC'd on all correspondence, or fed by a sales@ mailbox forwarding rule).
// Provider-agnostic: works with Resend Inbound, Cloudflare Email Worker,
// Postmark/SendGrid inbound parse, etc. Authenticated by a shared secret.
//
// The actual match/dedupe/classify/record logic lives in the shared
// ingestEmailMessage() core (src/lib/inquiries/ingest-message.ts), which the
// Gmail Pub/Sub pipeline (/api/webhooks/gmail) also uses. This route only
// authenticates and normalizes the provider's payload shape.

type AnyRecord = Record<string, unknown>;

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "address" in (v as AnyRecord)) {
    const a = (v as AnyRecord).address;
    return typeof a === "string" ? a : null;
  }
  return null;
}

function asAddressList(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(v)) {
    return v.map((x) => asString(x)).filter((x): x is string => !!x);
  }
  const single = asString(v);
  return single ? [single] : [];
}

function pick(body: AnyRecord, ...keys: string[]): unknown {
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null) return body[k];
  }
  return undefined;
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-inbound-secret");
  const authHeader = request.headers.get("authorization");
  const expected = process.env.INBOUND_EMAIL_SECRET;
  const ok =
    !!expected && (secret === expected || authHeader === `Bearer ${expected}`);
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: AnyRecord;
  try {
    body = (await request.json()) as AnyRecord;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Some providers nest the message under `data` / `email`.
  const msg =
    (body.data as AnyRecord) ||
    (body.email as AnyRecord) ||
    (body.message as AnyRecord) ||
    body;

  const result = await ingestEmailMessage({
    fromAddr: asString(pick(msg, "from", "From", "sender")),
    toAddrs: asAddressList(pick(msg, "to", "To")),
    ccAddrs: asAddressList(pick(msg, "cc", "Cc")),
    subject: asString(pick(msg, "subject", "Subject")),
    bodyText: asString(pick(msg, "text", "text_body", "TextBody", "plain")),
    bodyHtml: asString(pick(msg, "html", "html_body", "HtmlBody")),
    providerMessageId: asString(
      pick(msg, "message_id", "messageId", "MessageID", "Message-Id")
    ),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  if (result.deduped) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  return NextResponse.json({
    ok: true,
    matched: result.matched,
    inquiryId: result.inquiryId,
    direction: result.direction,
    skipped: result.skipped,
  });
}
