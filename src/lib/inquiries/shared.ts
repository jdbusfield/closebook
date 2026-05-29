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

// Inquiry references look like "HDR-AB12C". Used to match inbound replies
// (the reference is carried in every email subject) back to an inquiry.
const REFERENCE_RE = /\bHDR-[A-Z0-9]{3,8}\b/i;

export function extractReference(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const m = subject.match(REFERENCE_RE);
  return m ? m[0].toUpperCase() : null;
}
