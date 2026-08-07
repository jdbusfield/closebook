// Shared constants + helpers for the HDR Sales CRM (rental-inquiry pipeline).
// Mirrors the "Bathroom Trailer Rental CRM" design: a 6-stage pipeline, a fixed
// fleet roster, follow-up tasks, and an activity timeline.

// HDR (Hollywood Depot Rentals) entity id. Mirrors ENTITY_IDS.HDR in
// src/lib/paylocity/cost-center-config.ts. Overridable via env for safety.
export const HDR_ENTITY_ID =
  process.env.HDR_ENTITY_ID || "7529580d-3b44-4a9b-91f4-bc2db25f5211";

// Versatile Studios entity id. Mirrors ENTITY_IDS.VS in cost-center-config.ts.
export const VERSATILE_ENTITY_ID =
  process.env.VERSATILE_ENTITY_ID || "2fdafa28-8ba2-4caa-aa9f-5d8f39f57081";

// Silverco Enterprises entity id (operates as Avon Rents, entity code AVON).
// Mirrors ENTITY_IDS.SILVERCO in cost-center-config.ts.
export const SILVERCO_ENTITY_ID =
  process.env.SILVERCO_ENTITY_ID || "b664a9c1-3817-4df4-9261-f51b3403a5de";

// Multi-tenant routing for the inquiry ingest webhook. Each marketing site POSTs
// a `brand`; we map it to the entity its inquiries belong to and the `source`
// tag stored on the row. Absent/unknown brands fall back to HDR so existing
// HDR submissions (which send no brand) keep their current behavior exactly.
export const BRAND_ENTITY: Record<string, { entityId: string; source: string }> = {
  hdr: { entityId: HDR_ENTITY_ID, source: "website" },
  versatile: { entityId: VERSATILE_ENTITY_ID, source: "versatile" },
  // hollywooddepot.com (production equipment rentals) shares the HDR entity but
  // keeps its own source tag so the board can badge + filter its leads.
  hollywooddepot: { entityId: HDR_ENTITY_ID, source: "hollywooddepot" },
  // avon-trucks marketing site (truck rentals). Avon Rents operates under the
  // Silverco entity, so its leads get their own board at that entity.
  avonrents: { entityId: SILVERCO_ENTITY_ID, source: "avonrents" },
};

// Friendly display names for lead sources (board badge + drawer).
export const SOURCE_LABELS: Record<string, string> = {
  website: "Site Services site",
  hollywooddepot: "Hollywood Depot site",
  versatile: "Versatile site",
  avonrents: "Avon Trucks site",
};

export function resolveBrand(brand?: string | null): { entityId: string; source: string } {
  const key = (brand ?? "hdr").toLowerCase();
  return BRAND_ENTITY[key] ?? BRAND_ENTITY.hdr;
}

// Which brand's CRM a watched Gmail mailbox feeds, and how to treat mail that
// matches no inquiry. Matching tries entityId first, then fallbackEntityId, so
// one mailbox can serve both brands (e.g. jd@avonrents.com receives Versatile's
// rentals@ group mail alongside unrelated Avon business mail).
export interface MailboxRouting {
  /** Brand tried first when matching this mailbox's mail to an inquiry. */
  entityId: string;
  /** Brand tried second; a message matching neither stays with entityId. */
  fallbackEntityId: string | null;
  /**
   * Record mail that matches no inquiry in either brand? Brand-owned mailboxes
   * keep it (it feeds the Inbox triage view). Personal mailboxes watched only
   * to catch brand mail drop it so unrelated correspondence never enters the CRM.
   */
  recordUnmatched: boolean;
}

export function mailboxRouting(addr: string | null | undefined): MailboxRouting {
  const at = (addr ?? "").lastIndexOf("@");
  const domain = at >= 0 ? (addr ?? "").slice(at + 1).trim().toLowerCase() : "";
  if (domain === "versatilestudios.com") {
    return { entityId: VERSATILE_ENTITY_ID, fallbackEntityId: HDR_ENTITY_ID, recordUnmatched: true };
  }
  // jd@avonrents.com is watched as the delivery point for the rentals@
  // versatilestudios.com distribution group — Versatile-first, and unmatched
  // personal/Avon mail is skipped.
  if (domain === "avonrents.com") {
    return { entityId: VERSATILE_ENTITY_ID, fallbackEntityId: HDR_ENTITY_ID, recordUnmatched: false };
  }
  return { entityId: HDR_ENTITY_ID, fallbackEntityId: VERSATILE_ENTITY_ID, recordUnmatched: true };
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------
// Stored in rental_inquiries.status (text, constrained by a CHECK — keep in
// sync with the 20260806 migration). First five stages are open inquiries that
// need follow-up (the three followup stages track how many outreach rounds
// we've done); the next three are booked rentals; `lost` is terminal and
// lives off the board (visible in Customers).
export const INQUIRY_STATUSES = [
  "new",
  "quoted",
  "followup",
  "followup2",
  "followup3",
  "responded",
  "keepwarm",
  "confirmed",
  "out",
  "returned",
  "completed",
  "lost",
] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export type StageKind = "open" | "booked" | "lost" | "completed";

export interface Stage {
  key: InquiryStatus;
  label: string;
  kind: StageKind;
  color: string; // hex — used consistently for dots, pills, stage bar
}

// The board stages, in board / progress order. `lost` is intentionally not
// here (it's a terminal archive state shown only as a pill). The three
// follow-up stages count outreach rounds — a deal moves right each time we
// chase it again, with heat escalating amber → orange → red.
export const STAGES: Stage[] = [
  { key: "new", label: "New Inquiry", kind: "open", color: "#2845F0" },
  { key: "quoted", label: "Quote Sent", kind: "open", color: "#7c3aed" },
  { key: "followup", label: "Followed Up 1", kind: "open", color: "#d97706" },
  { key: "followup2", label: "Followed Up 2", kind: "open", color: "#c2410c" },
  { key: "followup3", label: "Followed Up 3+", kind: "open", color: "#b91c1c" },
  // The customer wrote back — an active two-way conversation. Still gets the
  // full follow-up nagging (dropping the ball mid-conversation is the worst
  // time to), and the who-had-the-last-word badge shows whose court it's in.
  { key: "responded", label: "Responded Back", kind: "open", color: "#0891b2" },
  // "Not right now, but we're interested in the future" — parked, not dead.
  // Open for email matching (a reply months later still lands on the card),
  // but excluded from every follow-up nag: see needsOutreachStatus.
  { key: "keepwarm", label: "Keep Warm", kind: "open", color: "#db2777" },
  { key: "confirmed", label: "Confirmed", kind: "booked", color: "#0f7b6c" },
  { key: "out", label: "Out", kind: "booked", color: "#0369a1" },
  { key: "returned", label: "Returned", kind: "booked", color: "#64748b" },
];

export const LOST_STAGE: Stage = {
  key: "lost",
  label: "Lost",
  kind: "lost",
  color: "#94a3b8",
};

// Terminal "done" archive — a booked order that's been fully closed out. Like
// lost it lives off the board and is reviewed in its own view, but it's a
// positive outcome (revenue realized), so it's kept separate from lost.
export const COMPLETED_STAGE: Stage = {
  key: "completed",
  label: "Completed",
  kind: "completed",
  color: "#16a34a",
};

// Lookup including the off-board terminal states, so a StagePill can render any status.
export const STAGE_BY_KEY: Record<InquiryStatus, Stage> = Object.fromEntries(
  [...STAGES, LOST_STAGE, COMPLETED_STAGE].map((s) => [s.key, s])
) as Record<InquiryStatus, Stage>;

export const STATUS_LABELS: Record<InquiryStatus, string> = Object.fromEntries(
  [...STAGES, LOST_STAGE, COMPLETED_STAGE].map((s) => [s.key, s.label])
) as Record<InquiryStatus, string>;

// Preset reasons offered when marking a quote lost. "Other" is handled in the UI
// as a free-text entry, so it's not in this list. Stored verbatim in
// rental_inquiries.lost_reason for the Lost view + win/loss reporting.
export const LOST_REASONS = [
  "Too expensive",
  "Did not respond",
  "Went with a different vendor",
  "Not available for the dates requested",
] as const;

// Open stages where inbound correspondence should still attach to the inquiry
// (used by the inbound-email webhook's fallback matcher) and that count as
// "open" on the dashboard.
export const OPEN_INQUIRY_STATUSES: InquiryStatus[] = [
  "new",
  "quoted",
  "followup",
  "followup2",
  "followup3",
  "responded",
  "keepwarm",
];

// Booked stages — a committed rental. A deal is calendar-eligible when it has a
// unit AND its stage is one of these.
export const BOOKED_STATUSES: InquiryStatus[] = ["confirmed", "out", "returned"];

export function isOpenStatus(s: string): boolean {
  return OPEN_INQUIRY_STATUSES.includes(s as InquiryStatus);
}
// Open AND actively being chased. Keep Warm deals are open (mail still
// attaches, they count in the pipeline) but the customer asked us to circle
// back later — so the red contact badges, going-cold flames, overdue-first
// sorting, and automated funnel sends all leave them alone.
export function needsOutreachStatus(s: string): boolean {
  return isOpenStatus(s) && s !== "keepwarm";
}
export function isBookedStatus(s: string): boolean {
  return BOOKED_STATUSES.includes(s as InquiryStatus);
}
export function normalizeStatus(status: string | null | undefined): InquiryStatus {
  return (status && status in STAGE_BY_KEY ? status : "new") as InquiryStatus;
}

// ---------------------------------------------------------------------------
// Fleet roster (fixed inventory)
// ---------------------------------------------------------------------------
// Stable string ids stored in rental_inquiries.unit_id. Each unit owns a color
// used consistently across the calendar, unit tags, and fleet cards. Rename /
// extend here as the real HDR fleet changes — no schema migration needed.
export interface FleetUnit {
  id: string;
  name: string;
  config: string;
  stalls: number;
  color: string;
  note: string;
}

export const FLEET: FleetUnit[] = [
  { id: "u484", name: "Unit 484", config: "4-Stall Luxury", stalls: 4, color: "#2845F0", note: "Flagship · production-grade" },
  { id: "u207", name: "Unit 207", config: "4-Stall Luxury", stalls: 4, color: "#0f7b6c", note: "Generator-equipped" },
  { id: "u661", name: "Unit 661", config: "4-Stall Luxury", stalls: 4, color: "#c2410c", note: "Newest · wrap-ready" },
  { id: "u318", name: "Unit 318", config: "2-Stall ADA", stalls: 2, color: "#7c3aed", note: "ADA + wheelchair lift" },
  { id: "u552", name: "Unit 552", config: "3-Stall Combo", stalls: 3, color: "#b45309", note: "Compact tow" },
];

export const FLEET_BY_ID: Record<string, FleetUnit> = Object.fromEntries(
  FLEET.map((u) => [u.id, u])
);

// ---------------------------------------------------------------------------
// Date + money helpers
// ---------------------------------------------------------------------------
// Tolerant date parsing: accepts ISO timestamps, 'yyyy-mm-dd', or returns null
// for free-text the customer typed into the website form.
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const trimmed = s.trim();
  // Pure yyyy-mm-dd → pin to local midnight (avoids TZ drift).
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

function atMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

export function today(): Date {
  return atMidnight(new Date());
}

// Whole days from a → b (b - a). Both coerced to local midnight.
export function daysBetween(a: Date, b: Date): number {
  return Math.round((atMidnight(b).getTime() - atMidnight(a).getTime()) / 86_400_000);
}

// Relative day label vs today ("today", "tomorrow", "3d ago", "in 5d").
export function relDays(s: string | Date | null | undefined): string {
  const d = s instanceof Date ? s : parseDate(s ?? null);
  if (!d) return "";
  const n = daysBetween(today(), d);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n < 0) return `${Math.abs(n)}d ago`;
  return `in ${n}d`;
}

export function fmtMoney(n: number | null | undefined): string {
  return "$" + (n || 0).toLocaleString("en-US");
}

export function fmtDate(
  s: string | Date | null | undefined,
  opts?: Intl.DateTimeFormatOptions
): string {
  const d = s instanceof Date ? s : parseDate(s ?? null);
  if (!d) return typeof s === "string" ? s : "";
  return d.toLocaleDateString("en-US", opts || { month: "short", day: "numeric" });
}

// A date range like "Jun 28–29" / "Jun 28 → Jul 1", tolerant of free text.
export function fmtRange(
  start: string | null | undefined,
  end: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions
): string {
  const s = parseDate(start ?? null);
  if (!s) return start ?? "";
  const startStr = fmtDate(s, opts);
  const e = parseDate(end ?? null);
  if (!e || toISODate(e) === toISODate(s)) return startStr;
  return `${startStr}–${fmtDate(e, opts)}`;
}

// ---------------------------------------------------------------------------
// Avatar color hashing (deterministic from name)
// ---------------------------------------------------------------------------
const AVATAR_COLORS = [
  "#2845F0", "#0f7b6c", "#c2410c", "#7c3aed", "#b45309", "#0369a1", "#be185d",
];
export function avatarColor(name: string | null | undefined): string {
  const n = name || "?";
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Domain types (shared between the data hook and views)
// ---------------------------------------------------------------------------
export interface InquiryTask {
  id: string;
  inquiry_id: string;
  title: string;
  due_date: string | null;
  done: boolean;
  kind: "call" | "quote" | "email" | "logistics";
  created_at: string;
}

export interface InquiryActivity {
  id: string;
  inquiry_id: string;
  type: "inquiry" | "call" | "email" | "note" | "quote" | "payment" | "logistics";
  body: string;
  actor: string | null;
  occurred_at: string;
}

// A single line on a saved quote. Mirrors QuoteLine in the quote-builder, minus
// the client-only row id (rebuilt on load).
export interface QuoteLineItem {
  description: string;
  qty: number;
  rate: number;
}

// A saved, numbered quote attached to an inquiry. The PDF is regenerated on
// demand from these fields (src/lib/inquiries/quote-pdf.ts) — we persist the
// data, not a binary — so any rep can re-download an identical quote.
export interface InquiryQuote {
  id: string;
  inquiry_id: string;
  quote_number: string;
  status: "draft" | "sent" | "accepted" | "declined" | "expired";
  lines: QuoteLineItem[];
  subtotal: number;
  tax_rate: number;
  tax: number;
  total: number;
  valid_until: string | null;
  terms: string | null;
  /** Stamped when a rep confirms the customer accepted this quote. */
  accepted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Renders a SAVED quote as the plain-text block the {quote} merge token drops
// into an email body — same shape the template picker's live builder produces
// (bulleted lines, then totals). Used by both the funnel send engine and the
// enroll dialog's preview, so what the rep previews is exactly what sends.
export function quoteEmailBlock(
  q: Pick<InquiryQuote, "lines" | "subtotal" | "tax" | "total">
): string {
  const rows = (q.lines ?? [])
    .filter((l) => (l.description ?? "").trim() !== "" || Number(l.rate) > 0)
    .map((l) => {
      const qty = Number(l.qty) || 1;
      const rate = Number(l.rate) || 0;
      const qtyNote = qty !== 1 ? ` (${qty} × ${fmtMoney(rate)})` : "";
      return `• ${(l.description ?? "").trim() || "Item"}${qtyNote} — ${fmtMoney(qty * rate)}`;
    });
  const totals =
    Number(q.tax) > 0
      ? [`Subtotal: ${fmtMoney(q.subtotal)}`, `Tax: ${fmtMoney(q.tax)}`, `Total: ${fmtMoney(q.total)}`]
      : [`Total: ${fmtMoney(q.total)}`];
  return [...rows, ...totals].join("\n");
}

export interface InquiryMessage {
  id: string;
  inquiry_id: string | null;
  direction: string;
  kind: string | null;
  from_addr: string | null;
  to_addrs: string[] | null;
  cc_addrs: string[] | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  /** RFC Message-Id, when the message was captured with one (Gmail/inbound). */
  provider_message_id?: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
}

// Plain-text summary of an email body — strips tags from HTML-only mail and
// collapses whitespace. Used for the activity-timeline email summaries.
export function messageSnippet(
  m: { body_text: string | null; body_html: string | null },
  max = 180
): string {
  const raw = m.body_text || (m.body_html ? m.body_html.replace(/<[^>]+>/g, " ") : "");
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() + "…" : clean;
}

// Effective timestamp of a message for chronological sorting.
export function messageDate(m: InquiryMessage): string {
  return m.sent_at || m.received_at || m.created_at;
}

// Convert simple HTML email markup to readable plain text (block tags → newlines).
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|tr|li|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/[ \t]+\n/g, "\n");
}

// Full email body for the chat view: strips the quoted reply history and
// forwarded headers so each bubble shows only its own new content (keeps the
// sender's own text + signature). Prefers plain text, falls back to HTML.
export function emailBodyText(m: {
  body_text: string | null;
  body_html: string | null;
}): string {
  let raw =
    m.body_text && m.body_text.trim()
      ? m.body_text
      : m.body_html
        ? htmlToText(m.body_html)
        : "";
  raw = raw.replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^on\b.*\bwrote:?\s*$/i.test(t)) break; // Gmail/Apple quote header
    if (/^-{2,}\s*original message\s*-{2,}/i.test(t)) break; // Outlook
    if (/^_{5,}$/.test(t)) break; // Outlook divider
    if (/^from:\s/i.test(t) && out.some((l) => l.trim() !== "")) break; // forwarded block
    if (t.startsWith(">")) break; // quoted history begins
    out.push(lines[i]);
  }
  let text = out.join("\n");
  text = text.replace(/\n-- \n[\s\S]*$/, ""); // drop standard signature delimiter block
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

// Display name from an email address (capitalized local part), e.g.
// daniel@hollywooddepot.com → "Daniel".
export function addressName(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const local = addr.split("@")[0];
  if (!local) return null;
  const cleaned = local.replace(/[._-]+/g, " ").replace(/\d+/g, "").trim();
  return cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
}

// Our staff email domains. The inbound-email worker can only stamp `direction`
// from whatever single domain it knows, so staff who reply from a *different*
// brand domain (e.g. daniel@hollywooddepot.com vs sales@hdrsiteservices.com) get
// mislabeled inbound. We re-derive the side at read time from the sender domain
// so the stored rows are corrected without re-ingesting. Keep in sync with the
// worker's STAFF_EMAIL_DOMAINS.
export const STAFF_EMAIL_DOMAINS = new Set([
  "hdrsiteservices.com",
  "hollywooddepot.com",
  "hollywooddepotrentals.com",
  "avonrents.com",
  "versatilestudios.com",
]);

function emailDomain(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1).trim().toLowerCase() : null;
}

export function isStaffAddress(addr: string | null | undefined): boolean {
  const d = emailDomain(addr);
  return !!d && STAFF_EMAIL_DOMAINS.has(d);
}

// Which side a message is on — 'us' (sent by staff) or 'customer'. Trusts the
// sender domain first (robust to the worker's mislabeling), then the known
// customer address, then the stored direction as a last resort.
export function messageSide(
  m: { from_addr: string | null; direction: string },
  customerEmail?: string | null
): "us" | "customer" {
  if (isStaffAddress(m.from_addr)) return "us";
  if (
    customerEmail &&
    m.from_addr &&
    m.from_addr.toLowerCase() === customerEmail.toLowerCase()
  ) {
    return "customer";
  }
  if (m.direction === "outbound") return "us";
  return "customer";
}

export interface Inquiry {
  id: string;
  reference: string;
  status: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  use_case: string | null;
  start_date: string | null;
  end_date: string | null;
  duration: string | null;
  units: number | null;
  attendant: string | null;
  guests: string | null;
  location: string | null;
  notes: string | null;
  // 'inquiry' (plain quote request) or 'reservation' (priced self-serve
  // /reserve lead — a warmer, higher-converting request).
  request_type: string | null;
  // Estimated booking deposit (USD) — set only on reservation requests.
  deposit: number | null;
  // Bill-to override for the quote/invoice doc — when set, the generated PDF is
  // issued in this name/address instead of `name`. Both null → fall back to the
  // working contact name and omit the address.
  billing_name: string | null;
  billing_address: string | null;
  internal_notes: string | null;
  // Why a quote was marked lost — one of LOST_REASONS or a free-text "Other"
  // note. Null until the inquiry is marked lost (or for legacy lost rows).
  lost_reason: string | null;
  // Free-form note printed on the customer-facing quote / invoice PDF, shown on
  // each document per the two toggles. Distinct from `internal_notes` (private)
  // and a quote's per-draft `terms`. Null/empty → nothing prints.
  document_note: string | null;
  note_on_quote: boolean;
  note_on_invoice: boolean;
  rw_quote_number: string | null;
  rw_order_number: string | null;
  source: string | null;
  unit_id: string | null;
  estimated_value: number | null;
  gclid: string | null;
  last_activity_at: string | null;
  created_at: string;
  tasks?: InquiryTask[];
  activity?: InquiryActivity[];
  messages?: InquiryMessage[];
  quotes?: InquiryQuote[];
}

// Most recent activity timestamp (for staleness). Takes the NEWEST of the
// activity timeline, genuine correspondence, and the last_activity_at stamp —
// not just the first source that has a value. Emails captured from Gmail land
// only in `messages` (no activity row is logged for them), so ignoring
// messages here made freshly-emailed deals read as "going cold".
export function lastActivityDate(inq: Inquiry): Date | null {
  const candidates: Date[] = [];
  for (const a of inq.activity || []) {
    const d = parseDate(a.occurred_at);
    if (d) candidates.push(d);
  }
  for (const m of genuineMessages(inq.messages || [])) {
    const d = parseTimestamp(messageDate(m));
    if (d) candidates.push(d);
  }
  const stamp = parseDate(inq.last_activity_at) || parseDate(inq.created_at);
  if (stamp) candidates.push(stamp);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.getTime() - a.getTime())[0];
}

// Days since last activity — powers the "going cold" surface.
export function daysStale(inq: Inquiry): number {
  const last = lastActivityDate(inq);
  if (!last) return 0;
  return Math.max(0, daysBetween(last, today()));
}

// A booked rental with dates — drives the dashboard's delivery/pickup schedule.
// (Unit assignment was removed, so it's no longer part of the predicate.)
export function isReservation(inq: Inquiry): boolean {
  return isBookedStatus(inq.status) && !!parseDate(inq.start_date);
}

// A priced self-serve reservation request that came in through the website's
// /reserve calculator (vs. a plain "request a quote" inquiry). These leads
// already picked dates, sized the order, and saw a deposit, so they convert at
// a much higher rate — the board tints them green to flag the warmer lead.
export function isReservationRequest(inq: Inquiry): boolean {
  return inq.request_type === "reservation";
}

// Full timestamp parse that PRESERVES the time of day (unlike parseDate, which
// floors yyyy-mm-dd to local midnight). Use for message/activity timestamps.
function parseTimestamp(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Date + time, e.g. "Jun 2, 5:42 PM".
export function fmtDateTime(
  s: string | null | undefined,
  opts?: Intl.DateTimeFormatOptions
): string {
  const d = parseTimestamp(s);
  if (!d) return s ?? "";
  return d.toLocaleString("en-US", opts || {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Fine-grained relative label ("just now", "12m ago", "5h ago", then days).
export function relTime(s: string | Date | null | undefined): string {
  const d = s instanceof Date ? s : parseTimestamp(s ?? null);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return relDays(d);
}

// The automated intake mails — the lead notification and the customer "thank
// you" autoreply — are never genuine correspondence. They're recorded by kind
// at ingest, but the sales mailbox also forwards them back into the system,
// where the inbound-email worker re-records them as outbound "reply" rows (it
// tags everything it captures as "reply"). Those echoes carry the same subject,
// so we recognise them and exclude them too — otherwise the bounced-back lead
// notification reads as us replying.
function automatedIntakeSubjects<
  T extends { kind: string | null; subject: string | null }
>(messages: T[]): Set<string> {
  const subs = new Set<string>();
  for (const m of messages) {
    if (m.kind === "internal_notification" || m.kind === "customer_autoreply") {
      subs.add(normalizeSubject(m.subject));
    }
  }
  return subs;
}

export function isAutomatedIntakeMail<
  T extends {
    kind: string | null;
    direction?: string;
    subject: string | null;
    from_addr?: string | null;
  }
>(m: T, automatedSubjects: Set<string>): boolean {
  if (m.kind === "internal_notification" || m.kind === "customer_autoreply") return true;
  // The forwarded echo of those mails reappears as an outbound message with the
  // same subject — not something a human on our side actually wrote. But a rep
  // replying to the lead notification ALSO inherits that subject, just with a
  // "Re:" prefix — that IS genuine correspondence. So an outbound subject-match
  // only counts as an echo when it lacks a reply prefix or was sent by the
  // automated inquiries@ sender.
  if (m.direction === "outbound" && automatedSubjects.has(normalizeSubject(m.subject))) {
    const isHumanReply =
      /^\s*(re|fwd|fw)\s*:/i.test(m.subject ?? "") &&
      !/(inquiries|leads)@/i.test(m.from_addr ?? "");
    return !isHumanReply;
  }
  return false;
}

// Genuine, human correspondence only: real inbound customer mail and the
// outbound replies we actually wrote — with every flavour of automated intake
// mail (and its forwarded echo) removed.
export function genuineMessages<
  T extends { kind: string | null; direction?: string; subject: string | null }
>(messages: T[]): T[] {
  const auto = automatedIntakeSubjects(messages);
  return messages.filter((m) => !isAutomatedIntakeMail(m, auto));
}

// Activity types that count as an actual outreach touch for the card's "most
// recent activity" time — a call placed or an email sent. Deliberately excludes
// stage moves (logged as "note"/"payment"), quotes, payments, notes, and the
// original "inquiry" event, so reorganizing the board never makes a deal look
// freshly worked.
const TOUCH_ACTIVITY_TYPES: ReadonlySet<InquiryActivity["type"]> = new Set([
  "call",
  "email",
]);

// Most recent moment WE reached out to the customer — an outbound email (sent
// from the CRM or captured from Gmail) or a logged call/email. Customer inbound
// mail, stage moves, and record edits do NOT count. Null when we've never
// contacted them, so callers can surface "no contact yet" honestly.
export function lastContactedAt(inq: Inquiry): Date | null {
  const auto = automatedIntakeSubjects(inq.messages || []);
  const candidates: Date[] = [];
  for (const m of inq.messages || []) {
    if (isAutomatedIntakeMail(m, auto)) continue;
    if (messageSide(m, inq.email) !== "us") continue;
    const d = parseTimestamp(messageDate(m));
    if (d) candidates.push(d);
  }
  for (const a of inq.activity || []) {
    if (!TOUCH_ACTIVITY_TYPES.has(a.type)) continue;
    const d = parseTimestamp(a.occurred_at);
    if (d) candidates.push(d);
  }
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.getTime() - a.getTime())[0];
}

// How many emails we've actually sent this customer — captured outbound
// messages only (Gmail capture + funnel sends), automated intake mail
// excluded. Logged [email] activity rows are deliberately NOT counted: an
// in-app template "send" logs one at compose time and the Gmail pipeline then
// captures the real sent mail, so counting both would double-count.
export function sentEmailCount(inq: Inquiry): number {
  const auto = automatedIntakeSubjects(inq.messages || []);
  let n = 0;
  for (const m of inq.messages || []) {
    if (isAutomatedIntakeMail(m, auto)) continue;
    if (messageSide(m, inq.email) === "us") n++;
  }
  return n;
}

// A lead is overdue for outreach when we've never contacted them or the last
// outreach is more than three days old. Drives the red state of the card's
// last-contacted badge.
const CONTACT_OVERDUE_AFTER_MS = 3 * 86_400_000;

export function contactOverdue(inq: Inquiry): boolean {
  const t = lastContactedAt(inq);
  return !t || Date.now() - t.getTime() > CONTACT_OVERDUE_AFTER_MS;
}

// Who had the last word — 'us' (we sent the most recent thing) or 'customer'
// (they did, so the ball is in our court). Ranks genuine correspondence by
// timestamp: real inbound replies (customer), our outbound replies (us, by
// sender domain), and our logged activity — calls/emails/quotes/stage moves —
// (us). The automated lead notification and the "thank you" autoreply are
// excluded by kind; everything else is judged purely on who sent the most recent
// thing, regardless of when the inquiry record itself was created (so inquiries
// created from older inbox mail are read correctly). When there's no genuine
// correspondence at all, falls back to the stage: a new lead awaits our first
// reply; once quoted/booked we had the last word. Null for lost.
export function lastCorrespondence(
  inq: Inquiry
): { by: "us" | "customer"; at: string } | null {
  let latestAt: number | null = null;
  let latestBy: "us" | "customer" | null = null;
  let latestIso = "";
  const offer = (by: "us" | "customer", at: Date | null, iso: string) => {
    if (!at) return;
    if (latestAt === null || at.getTime() > latestAt) {
      latestAt = at.getTime();
      latestBy = by;
      latestIso = iso;
    }
  };

  const auto = automatedIntakeSubjects(inq.messages || []);
  for (const m of inq.messages || []) {
    // Automated intake mail (and its forwarded echo) is never "correspondence".
    if (isAutomatedIntakeMail(m, auto)) continue;
    const iso = messageDate(m);
    offer(messageSide(m, inq.email), parseTimestamp(iso), iso);
  }
  for (const a of inq.activity || []) {
    // A logged "inquiry" represents the customer reaching out; everything else we
    // log is our own action.
    offer(a.type === "inquiry" ? "customer" : "us", parseTimestamp(a.occurred_at), a.occurred_at);
  }

  if (latestBy) return { by: latestBy, at: latestIso };

  // No genuine correspondence at all — infer from the stage whose court the ball
  // is in.
  if (inq.status === "lost") return null;
  const hasIntake = (inq.messages || []).length > 0 || (inq.activity || []).length > 0;
  if (inq.status === "new") {
    return hasIntake ? { by: "customer", at: inq.created_at } : null;
  }
  return { by: "us", at: inq.last_activity_at || inq.created_at };
}

// ---------------------------------------------------------------------------
// Communication-thread filtering (unchanged behaviour)
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
  from_addr?: string | null;
}

// Strip one leading Re:/Fwd: and surrounding whitespace so a forwarded echo and
// its original collapse to the same subject.
function normalizeSubject(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/^\s*(re|fwd|fw)\s*:\s*/i, "").trim();
}

/** True when the raw subject carries a human reply/forward prefix (Re:/Fwd:). */
function hasReplyPrefix(s: string | null | undefined): boolean {
  return /^\s*(re|fwd|fw)\s*:/i.test(s ?? "");
}

/** The automation senders for site-generated inquiry mail (HDR uses inquiries@,
 * the Versatile site alerts send from leads@). */
const AUTOMATION_FROM_RE = /(inquiries|leads)@hdrsiteservices\.com/i;

// ---------------------------------------------------------------------------
// Funnel reply-threading. A funnel email should land in the conversation the
// customer already has — replying to the last email they saw (the site's
// "thanks for your request" confirmation, a rep's hand-written note, or the
// customer's own last message) — rather than opening a new chain. The anchor
// decides the subject ("Re: <original>") always; In-Reply-To/References ride
// along only when the thread was captured with real RFC Message-Ids (Gmail
// pipeline / inbound webhook). Resend-sent mail has no stored Message-Id, so
// those threads rely on the shared subject, which Gmail and Outlook both
// group on. Used by funnel-send (server) and the start-funnel preview
// (client) so what the dialog shows is what actually sends.
// ---------------------------------------------------------------------------

/** Strip every stacked Re:/Fwd: prefix but keep the subject's own casing. */
function baseSubject(s: string | null | undefined): string {
  let out = (s ?? "").trim();
  while (/^(re|fwd|fw)\s*:\s*/i.test(out)) {
    out = out.replace(/^(re|fwd|fw)\s*:\s*/i, "");
  }
  return out.trim();
}

/** Ensure an RFC Message-Id is angle-bracketed the way headers expect. */
function rfcMessageId(id: string): string {
  const t = id.trim();
  return t.startsWith("<") ? t : `<${t}>`;
}

export interface FunnelThreadAnchor {
  /** Subject the funnel email sends under: "Re: <the thread's subject>". */
  subject: string;
  /** Message-Id for the In-Reply-To header, when the anchor has one. */
  inReplyTo: string | null;
  /** Same-thread Message-Ids for the References header, oldest first. */
  references: string[];
}

export function funnelThreadAnchor(
  messages: Pick<
    InquiryMessage,
    | "direction"
    | "kind"
    | "subject"
    | "from_addr"
    | "provider_message_id"
    | "sent_at"
    | "received_at"
    | "created_at"
  >[]
): FunnelThreadAnchor | null {
  // Customer-visible email only: the internal lead notification (and its
  // forwarded echo through the sales mailbox) never reached the customer's
  // inbox, and a subjectless row can't carry a thread. A rep hitting Reply on
  // the lead alert DOES email the customer, so a Re:-prefixed human send on
  // that subject stays in (mirrors isAutomatedIntakeMail).
  const internalSubjects = new Set(
    messages
      .filter((m) => m.kind === "internal_notification")
      .map((m) => baseSubject(m.subject).toLowerCase())
  );
  const visible = messages.filter((m) => {
    if (m.kind === "internal_notification") return false;
    const base = baseSubject(m.subject);
    if (base === "") return false;
    if (internalSubjects.has(base.toLowerCase())) {
      const humanReply =
        hasReplyPrefix(m.subject) && !AUTOMATION_FROM_RE.test(m.from_addr ?? "");
      if (!humanReply) return false;
    }
    return true;
  });
  if (visible.length === 0) return null;
  const ts = (m: (typeof visible)[number]) =>
    new Date(m.sent_at || m.received_at || m.created_at).getTime() || 0;
  const sorted = [...visible].sort((a, b) => ts(a) - ts(b));
  const anchor = sorted[sorted.length - 1];
  // References only from messages in the SAME thread (matching base subject) —
  // ids from an unrelated thread would splice the reply into the wrong place.
  const anchorBase = baseSubject(anchor.subject).toLowerCase();
  const ids = sorted
    .filter((m) => baseSubject(m.subject).toLowerCase() === anchorBase)
    .map((m) => m.provider_message_id)
    .filter((id): id is string => !!id)
    .map(rfcMessageId);
  return {
    subject: `Re: ${baseSubject(anchor.subject)}`,
    inReplyTo: ids.length > 0 ? ids[ids.length - 1] : null,
    references: ids,
  };
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
  const outboundReplySubjects = new Set(
    messages
      .filter((m) => m.kind === "reply" && m.direction === "outbound")
      .map((m) => normalizeSubject(m.subject))
  );

  return messages.filter((m) => {
    const subj = normalizeSubject(m.subject);
    if (m.kind === "customer_autoreply") return false;
    if (m.kind === "reply" && m.direction === "outbound" && autoreplySubjects.has(subj)) {
      // Hide only the automation's own echo of the autoreply (same subject with
      // no Re:/Fwd: prefix, or sent by the automation address). A rep's GENUINE
      // reply in the autoreply thread ("Re: Thanks for your HDR inquiry ...")
      // shares the normalized subject but must stay visible.
      const isAutomationEcho =
        AUTOMATION_FROM_RE.test(m.from_addr ?? "") || !hasReplyPrefix(m.subject);
      if (isAutomationEcho) return false;
    }
    if (m.kind === "internal_notification" && outboundReplySubjects.has(subj)) {
      return false;
    }
    return true;
  });
}

// Inquiry references look like "HDR-AB12C" (HDR) or "VS-AB12C" (Versatile).
// Used to match inbound replies (the reference is carried in every email
// subject) back to an inquiry.
const REFERENCE_RE = /\b(?:HDR|VS)-[A-Z0-9]{3,8}\b/i;

export function extractReference(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const m = subject.match(REFERENCE_RE);
  return m ? m[0].toUpperCase() : null;
}

// ─── Inquiry shape detection ─────────────────────────────────────────────────
//
// The pipeline started as a bathroom-trailer CRM, so its detail views assumed
// every inquiry had trailer fields (units → stalls, guests, attendant). The
// Versatile site feeds three different shapes through the same board, so the
// views branch on the detected kind:
//   order   — Versatile production-supplies order form (itemized ORDER block)
//   trailer — bathroom/restroom trailer request (HDR's native shape)
//   general — everything else from the Versatile site (vehicles, equipment,
//             studios, open-account) where trailer fields are meaningless
export type InquiryKind = "order" | "trailer" | "general";

const ORDER_BLOCK_RE = /ORDER \(\d+ items?\):/;

type KindFields = Pick<Inquiry, "use_case" | "notes" | "source">;

export function inquiryKind(inq: KindFields): InquiryKind {
  const useCase = (inq.use_case || "").toLowerCase();
  if (useCase.includes("production supplies order") || ORDER_BLOCK_RE.test(inq.notes || "")) {
    return "order";
  }
  // Non-Versatile sources (HDR site services, manual entries, email captures)
  // keep the trailer shape exactly as before.
  if ((inq.source || "") !== "versatile") return "trailer";
  return /bathroom|restroom|stall|trailer/.test(useCase) ? "trailer" : "general";
}

// How the lead physically arrived, shown next to the source badge. Only the
// Versatile site runs multiple intake forms; other sources are self-describing.
export function intakeMethodLabel(inq: KindFields): string | null {
  if ((inq.source || "") !== "versatile") return null;
  if (inquiryKind(inq) === "order") return "Order form";
  if ((inq.use_case || "").toLowerCase().includes("open an account")) return "Open-account form";
  return "Inquiry form";
}

// ─── Production-supplies order parsing ──────────────────────────────────────
//
// The Versatile /orders form serializes the whole submission into `notes`:
//   Job Name: …\nProduction Company: …\n…
//   \nSPECIAL REQUESTS:\n…
//   \nORDER (14 items):\nCATEGORY\n  4 × 6' Table\n  1 × Trashliners (resale)
// This parses it back into structure for type-aware display.

export interface OrderLine {
  qty: number;
  name: string;
  resale: boolean;
}

export interface OrderCategory {
  name: string;
  lines: OrderLine[];
}

export interface ParsedOrder {
  /** "Label: value" pairs from the production/contact header. */
  header: { label: string; value: string }[];
  specialRequests: string | null;
  categories: OrderCategory[];
  /** Distinct order lines. */
  lineCount: number;
  /** Total pieces (sum of quantities). */
  pieceCount: number;
}

export function parseOrderNotes(notes: string | null | undefined): ParsedOrder | null {
  if (!notes) return null;
  const marker = notes.match(ORDER_BLOCK_RE);
  if (!marker || marker.index == null) return null;

  let before = notes.slice(0, marker.index);
  const after = notes.slice(marker.index + marker[0].length);

  let specialRequests: string | null = null;
  const sr = before.match(/SPECIAL REQUESTS:\s*\n?([\s\S]*)$/);
  if (sr && sr.index != null) {
    specialRequests = sr[1].trim() || null;
    before = before.slice(0, sr.index);
  }

  const header: { label: string; value: string }[] = [];
  for (const line of before.split(/\r?\n/)) {
    const m = line.match(/^([^:\n]+):\s*(.+)$/);
    if (m) header.push({ label: m[1].trim(), value: m[2].trim() });
  }

  const categories: OrderCategory[] = [];
  let current: OrderCategory | null = null;
  let lineCount = 0;
  let pieceCount = 0;
  for (const raw of after.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    // Item lines are indented: "  4 × 6' Table" ("×" from the form; accept "x" too)
    const item = raw.match(/^\s+(\d+)\s*[×x]\s*(.+)$/);
    if (item) {
      const resale = /\(resale\)\s*$/i.test(item[2]);
      const name = item[2].replace(/\s*\(resale\)\s*$/i, "").trim();
      if (!current) {
        current = { name: "Items", lines: [] };
        categories.push(current);
      }
      current.lines.push({ qty: Number(item[1]), name, resale });
      lineCount += 1;
      pieceCount += Number(item[1]);
    } else {
      current = { name: raw.trim(), lines: [] };
      categories.push(current);
    }
  }
  if (lineCount === 0) return null;

  return { header, specialRequests, categories, lineCount, pieceCount };
}

/** Case-insensitive lookup into a parsed order's header block. */
export function orderHeaderValue(order: ParsedOrder | null, label: string): string | null {
  if (!order) return null;
  const hit = order.header.find((h) => h.label.toLowerCase() === label.toLowerCase());
  return hit?.value ?? null;
}
