// Shared constants + helpers for the lightweight rental-inquiry CRM.

// HDR (Hollywood Depot Rentals) entity id. Mirrors ENTITY_IDS.HDR in
// src/lib/paylocity/cost-center-config.ts. Overridable via env for safety.
export const HDR_ENTITY_ID =
  process.env.HDR_ENTITY_ID || "7529580d-3b44-4a9b-91f4-bc2db25f5211";

export const INQUIRY_STATUSES = [
  "new",
  "contacted",
  "quoted",
  "won",
  "lost",
] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

// Inquiry references look like "HDR-AB12C". Used to match inbound replies
// (the reference is carried in every email subject) back to an inquiry.
const REFERENCE_RE = /\bHDR-[A-Z0-9]{3,8}\b/i;

export function extractReference(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const m = subject.match(REFERENCE_RE);
  return m ? m[0].toUpperCase() : null;
}
