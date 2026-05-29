import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  HDR_ENTITY_ID,
  extractReference,
  OPEN_INQUIRY_STATUSES,
} from "@/lib/inquiries/shared";

export const runtime = "nodejs";

// Receives parsed inbound email from the capture address (the group address that
// is CC'd on all correspondence, or fed by a sales@ mailbox forwarding rule).
// Provider-agnostic: works with Resend Inbound, Cloudflare Email Worker,
// Postmark/SendGrid inbound parse, etc. Authenticated by a shared secret.

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

function emailDomain(addr: string | null): string | null {
  if (!addr) return null;
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : null;
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

  const fromAddr = asString(pick(msg, "from", "From", "sender"));
  const toAddrs = asAddressList(pick(msg, "to", "To"));
  const ccAddrs = asAddressList(pick(msg, "cc", "Cc"));
  const subject = (asString(pick(msg, "subject", "Subject")) ?? "") || null;
  const text = asString(pick(msg, "text", "text_body", "TextBody", "plain")) ?? null;
  const html = asString(pick(msg, "html", "html_body", "HtmlBody")) ?? null;
  const providerMessageId =
    asString(pick(msg, "message_id", "messageId", "MessageID", "Message-Id")) ?? null;

  const reference = extractReference(subject);

  const supabase = createAdminClient();

  // Match to an inquiry: prefer the HDR-XXXXX reference in the subject; fall back
  // to the most recent non-closed inquiry whose customer email is a participant.
  let inquiry: { id: string; email: string | null; status: string } | null = null;

  if (reference) {
    const { data } = await supabase
      .from("rental_inquiries")
      .select("id, email, status")
      .eq("entity_id", HDR_ENTITY_ID)
      .eq("reference", reference)
      .maybeSingle();
    inquiry = data ?? null;
  }

  if (!inquiry) {
    const participants = [fromAddr, ...toAddrs, ...ccAddrs]
      .filter((x): x is string => !!x)
      .map((x) => x.toLowerCase());
    if (participants.length > 0) {
      const { data } = await supabase
        .from("rental_inquiries")
        .select("id, email, status")
        .eq("entity_id", HDR_ENTITY_ID)
        .in("status", OPEN_INQUIRY_STATUSES)
        .order("last_activity_at", { ascending: false })
        .limit(50);
      inquiry =
        (data ?? []).find(
          (i) => i.email && participants.includes(i.email.toLowerCase())
        ) ?? null;
    }
  }

  // Dedupe on the RFC Message-Id (across matched + unmatched mail).
  if (providerMessageId) {
    const { data: existing } = await supabase
      .from("rental_inquiry_messages")
      .select("id")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, deduped: true });
    }
  }

  // Direction: a message FROM the customer is inbound; staff replying from our
  // domain is outbound. Unmatched mail defaults to inbound unless it's clearly
  // from our own domain.
  const customerEmail = inquiry?.email?.toLowerCase() ?? null;
  const fromIsCustomer = !!customerEmail && fromAddr?.toLowerCase() === customerEmail;
  const ourDomain = (process.env.LEAD_FROM_DOMAIN || "hdrsiteservices.com").toLowerCase();
  const fromIsStaff = emailDomain(fromAddr) === ourDomain;
  const direction = fromIsCustomer ? "inbound" : fromIsStaff ? "outbound" : "inbound";

  const nowIso = new Date().toISOString();
  // Always record the message — even when it matches no inquiry — so it appears
  // in the inbox activity feed and can be assigned to an inquiry later.
  const { error: insErr } = await supabase.from("rental_inquiry_messages").insert({
    inquiry_id: inquiry?.id ?? null,
    entity_id: HDR_ENTITY_ID,
    direction,
    channel: "email",
    kind: "reply",
    from_addr: fromAddr,
    to_addrs: toAddrs,
    cc_addrs: ccAddrs,
    subject,
    body_text: text,
    body_html: html,
    provider_message_id: providerMessageId,
    received_at: nowIso,
    sent_at: direction === "outbound" ? nowIso : null,
  });

  if (insErr) {
    console.error("[webhooks/inbound-email] insert failed", insErr);
    return NextResponse.json({ error: "Failed to record message" }, { status: 500 });
  }

  // Bump activity on the matched inquiry (stage stays manual on the board).
  if (inquiry) {
    await supabase
      .from("rental_inquiries")
      .update({ last_activity_at: nowIso })
      .eq("id", inquiry.id);
  }

  return NextResponse.json({
    ok: true,
    matched: !!inquiry,
    inquiryId: inquiry?.id ?? null,
    direction,
  });
}
