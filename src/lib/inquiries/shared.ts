// Shared constants + helpers for the lightweight rental-inquiry CRM.

// HDR (Hollywood Depot Rentals) entity id. Mirrors ENTITY_IDS.HDR in
// src/lib/paylocity/cost-center-config.ts. Overridable via env for safety.
export const HDR_ENTITY_ID =
  process.env.HDR_ENTITY_ID || "7529580d-3b44-4a9b-91f4-bc2db25f5211";

// Pipeline stages, in board order. Stored in rental_inquiries.status (text,
// constrained by a CHECK — keep in sync with the 20260529 migration).
export const INQUIRY_STATUSES = [
  "new",
  "quote_sent",
  "rental_confirmed",
  "completed",
  "lost",
] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "New",
  quote_sent: "Quote Sent",
  rental_confirmed: "Rental Confirmed",
  completed: "Completed",
  lost: "Lost",
};

// Open stages where inbound correspondence should still attach to the inquiry
// (used by the inbound-email webhook's fallback matcher).
export const OPEN_INQUIRY_STATUSES: InquiryStatus[] = [
  "new",
  "quote_sent",
  "rental_confirmed",
];

// ---------------------------------------------------------------------------
// Communication-thread filtering
// ---------------------------------------------------------------------------
// The website ingest records two automated outbound emails per inquiry:
//   - internal_notification — the inquiry/quote that lands in the sales inbox
//   - customer_autoreply     — the "thank you for your inquiry" reply
// The sales mailbox forwards to the inbound-email worker, so those same emails
// are re-captured as `reply` rows and show up twice. For the customer-facing
// communication thread we want genuine correspondence only.

export interface ThreadMessage {
  direction: string;
  kind: string | null;
  subject: string | null;
}

// Strip one leading Re:/Fwd: and surrounding whitespace so a forwarded echo and
// its original collapse to the same subject.
function normalizeSubject(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/^\s*(re|fwd|fw)\s*:\s*/i, "").trim();
}

// Returns the messages that belong in the communication thread, dropping the
// automated "thank you" autoreply and collapsing the duplicate inquiry
// notification down to a single entry (preferring the forwarded copy, which
// carries the email body over the bodiless ingest record). Genuine inbound
// customer mail is never dropped, even if a subject line happens to match.
export function visibleThreadMessages<T extends ThreadMessage>(messages: T[]): T[] {
  const autoreplySubjects = new Set(
    messages
      .filter((m) => m.kind === "customer_autoreply")
      .map((m) => normalizeSubject(m.subject))
  );
  // Subjects for which a forwarded (outbound) reply echo already exists.
  const outboundReplySubjects = new Set(
    messages
      .filter((m) => m.kind === "reply" && m.direction === "outbound")
      .map((m) => normalizeSubject(m.subject))
  );

  return messages.filter((m) => {
    const subj = normalizeSubject(m.subject);
    // Never show the autoreply.
    if (m.kind === "customer_autoreply") return false;
    // Drop the forwarded echo of the autoreply (from our domain → outbound),
    // but keep a genuine customer reply (inbound) on the same subject line.
    if (m.kind === "reply" && m.direction === "outbound" && autoreplySubjects.has(subj)) {
      return false;
    }
    // Drop the ingest notification record when its forwarded echo is present.
    if (m.kind === "internal_notification" && outboundReplySubjects.has(subj)) {
      return false;
    }
    return true;
  });
}

// Inquiry references look like "HDR-AB12C". Used to match inbound replies
// (the reference is carried in every email subject) back to an inquiry.
const REFERENCE_RE = /\bHDR-[A-Z0-9]{3,8}\b/i;

export function extractReference(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const m = subject.match(REFERENCE_RE);
  return m ? m[0].toUpperCase() : null;
}
