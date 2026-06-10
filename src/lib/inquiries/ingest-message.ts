import { createAdminClient } from "@/lib/supabase/admin";
import {
  BOOKED_STATUSES,
  HDR_ENTITY_ID,
  OPEN_INQUIRY_STATUSES,
  STAFF_EMAIL_DOMAINS,
  extractReference,
} from "@/lib/inquiries/shared";

// ============================================================================
// Shared email -> rental-inquiry ingestion core.
//
// This is the single place that turns a normalized inbound/outbound email into
// a rental_inquiry_messages row: match it to an inquiry, dedupe it, classify
// its direction, and record it. It is reused by:
//   * /api/webhooks/inbound-email  — provider-agnostic webhook (Resend Inbound,
//     Cloudflare/Postmark inbound parse, manual test posts)
//   * /api/webhooks/gmail          — the Gmail API + Pub/Sub real-time pipeline
//
// Everything here is HDR-scoped and runs through the service-role admin client
// (the website ingest + email webhooks bypass RLS by design).
// ============================================================================

export type Direction = "inbound" | "outbound";

/** A provider-normalized email, ready to be recorded against an inquiry. */
export interface NormalizedEmail {
  fromAddr: string | null;
  toAddrs: string[];
  ccAddrs: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  /** RFC Message-Id — the cross-provider dedupe key. */
  providerMessageId: string | null;
  /** Gmail thread id, when sourced from the Gmail pipeline (thread stickiness). */
  gmailThreadId?: string | null;
  /** ISO timestamp the message was received; defaults to now. */
  receivedAt?: string | null;
  /** ISO timestamp the message was sent (outbound); defaults to receivedAt/now. */
  sentAt?: string | null;
  /**
   * Optional direction hint from the source (e.g. Gmail SENT label). Only used
   * to break the tie when the sender domain doesn't decide it — the sender
   * domain is otherwise authoritative (mirrors shared.ts read-time correction).
   */
  directionHint?: Direction | null;
}

export interface IngestResult {
  ok: boolean;
  matched: boolean;
  inquiryId: string | null;
  direction: Direction | null;
  deduped: boolean;
  /** Set when the message was intentionally not recorded. */
  skipped?: "internal" | "empty";
  error?: string;
}

function emailDomain(addr: string | null): string | null {
  if (!addr) return null;
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).trim().toLowerCase() : null;
}

function isStaff(addr: string | null): boolean {
  const d = emailDomain(addr);
  return !!d && STAFF_EMAIL_DOMAINS.has(d);
}

type InquiryRow = { id: string; email: string | null; status: string };

/**
 * Record one normalized email against the HDR rental-inquiry pipeline.
 * Idempotent: a message whose provider_message_id already exists is a no-op.
 */
export async function ingestEmailMessage(
  input: NormalizedEmail
): Promise<IngestResult> {
  const supabase = createAdminClient();

  const fromAddr = input.fromAddr;
  const toAddrs = input.toAddrs ?? [];
  const ccAddrs = input.ccAddrs ?? [];
  const subject = input.subject || null;
  const participants = [fromAddr, ...toAddrs, ...ccAddrs].filter(
    (x): x is string => !!x
  );

  // CRM hygiene: never record internal staff<->staff mail. A real customer
  // thread always has at least one external (non-staff) participant.
  const hasExternal = participants.some((p) => !isStaff(p));
  if (participants.length > 0 && !hasExternal) {
    return {
      ok: true,
      matched: false,
      inquiryId: null,
      direction: null,
      deduped: false,
      skipped: "internal",
    };
  }

  // Nothing worth recording.
  if (!fromAddr && !subject && !input.bodyText && !input.bodyHtml) {
    return {
      ok: true,
      matched: false,
      inquiryId: null,
      direction: null,
      deduped: false,
      skipped: "empty",
    };
  }

  // --- Dedupe on the RFC Message-Id (across matched + unmatched mail) --------
  if (input.providerMessageId) {
    const { data: existing } = await supabase
      .from("rental_inquiry_messages")
      .select("id")
      .eq("provider_message_id", input.providerMessageId)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        matched: false,
        inquiryId: null,
        direction: null,
        deduped: true,
      };
    }
  }

  // --- Match to an inquiry --------------------------------------------------
  // Priority: explicit HDR-XXXXX reference in the subject (canonical) ->
  // Gmail thread stickiness (a reply that lost the tag still lands right) ->
  // most-recent open inquiry whose customer email is a participant.
  let inquiry: InquiryRow | null = null;

  const reference = extractReference(subject);
  if (reference) {
    const { data } = await supabase
      .from("rental_inquiries")
      .select("id, email, status")
      .eq("entity_id", HDR_ENTITY_ID)
      .eq("reference", reference)
      .maybeSingle();
    inquiry = data ?? null;
  }

  if (!inquiry && input.gmailThreadId) {
    const { data: sibling } = await supabase
      .from("rental_inquiry_messages")
      .select("inquiry_id")
      .eq("gmail_thread_id", input.gmailThreadId)
      .not("inquiry_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (sibling?.inquiry_id) {
      const { data } = await supabase
        .from("rental_inquiries")
        .select("id, email, status")
        .eq("entity_id", HDR_ENTITY_ID)
        .eq("id", sibling.inquiry_id)
        .maybeSingle();
      inquiry = data ?? null;
    }
  }

  if (!inquiry && participants.length > 0) {
    // Direct, case-insensitive lookup per external participant — open deals
    // first, then booked ones (a customer emailing about a confirmed rental
    // still belongs on that deal). No recency cap: an old-but-open inquiry
    // must still match.
    const externals = [...new Set(participants.filter((p) => !isStaff(p)))];
    outer: for (const statuses of [OPEN_INQUIRY_STATUSES, BOOKED_STATUSES]) {
      for (const addr of externals) {
        // ilike = case-insensitive equality here, so escape its wildcards
        // (emails legitimately contain "_").
        const pattern = addr.replace(/[\\%_]/g, "\\$&");
        const { data } = await supabase
          .from("rental_inquiries")
          .select("id, email, status")
          .eq("entity_id", HDR_ENTITY_ID)
          .in("status", statuses)
          .ilike("email", pattern)
          .order("last_activity_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) {
          inquiry = data;
          break outer;
        }
      }
    }
  }

  // --- Classify direction ---------------------------------------------------
  // Sender domain is authoritative (robust to mislabeled forwards). The Gmail
  // SENT-label hint only resolves the otherwise-ambiguous bucket.
  const customerEmail = inquiry?.email?.toLowerCase() ?? null;
  const fromLower = fromAddr?.toLowerCase() ?? null;
  const fromIsCustomer = !!customerEmail && fromLower === customerEmail;
  const fromIsStaff = isStaff(fromAddr);
  const derived: Direction | null = fromIsCustomer
    ? "inbound"
    : fromIsStaff
      ? "outbound"
      : null;
  const direction: Direction = derived ?? input.directionHint ?? "inbound";

  // --- Record ---------------------------------------------------------------
  const nowIso = new Date().toISOString();
  const receivedAt = input.receivedAt ?? nowIso;
  const sentAt =
    direction === "outbound" ? input.sentAt ?? input.receivedAt ?? nowIso : null;

  const { error: insErr } = await supabase
    .from("rental_inquiry_messages")
    .insert({
      inquiry_id: inquiry?.id ?? null,
      entity_id: HDR_ENTITY_ID,
      direction,
      channel: "email",
      kind: "reply",
      from_addr: fromAddr,
      to_addrs: toAddrs,
      cc_addrs: ccAddrs,
      subject,
      body_text: input.bodyText,
      body_html: input.bodyHtml,
      provider_message_id: input.providerMessageId,
      gmail_thread_id: input.gmailThreadId ?? null,
      received_at: receivedAt,
      sent_at: sentAt,
    });

  if (insErr) {
    // A unique-violation here means a concurrent push already inserted this
    // exact Message-Id — treat as a successful dedupe, not an error.
    if (insErr.code === "23505") {
      return {
        ok: true,
        matched: !!inquiry,
        inquiryId: inquiry?.id ?? null,
        direction,
        deduped: true,
      };
    }
    console.error("[ingest-message] insert failed", insErr);
    return {
      ok: false,
      matched: !!inquiry,
      inquiryId: inquiry?.id ?? null,
      direction,
      deduped: false,
      error: "Failed to record message",
    };
  }

  if (inquiry) {
    await supabase
      .from("rental_inquiries")
      .update({ last_activity_at: nowIso })
      .eq("id", inquiry.id);
  }

  return {
    ok: true,
    matched: !!inquiry,
    inquiryId: inquiry?.id ?? null,
    direction,
    deduped: false,
  };
}
