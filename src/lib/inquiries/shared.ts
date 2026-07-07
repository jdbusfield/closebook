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
};

// Friendly display names for lead sources (board badge + drawer).
export const SOURCE_LABELS: Record<string, string> = {
  website: "Site Services site",
  hollywooddepot: "Hollywood Depot site",
  versatile: "Versatile site",
};

export function resolveBrand(brand?: string | null): { entityId: string; source: string } {
  const key = (brand ?? "hdr").toLowerCase();
  return BRAND_ENTITY[key] ?? BRAND_ENTITY.hdr;
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------
// Stored in rental_inquiries.status (text, constrained by a CHECK — keep in
// sync with the 20260602 migration). First three stages are open inquiries that
// need follow-up; the next three are booked rentals; `lost` is terminal and
// lives off the board (visible in Customers).
export const INQUIRY_STATUSES = [
  "new",
  "quoted",
  "followup",
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

// The six board stages, in board / progress order. `lost` is intentionally not
// here (it's a terminal archive state shown only as a pill).
export const STAGES: Stage[] = [
  { key: "new", label: "New Inquiry", kind: "open", color: "#2845F0" },
  { key: "quoted", label: "Quote Sent", kind: "open", color: "#7c3aed" },
  { key: "followup", label: "Follow-Up", kind: "open", color: "#d97706" },
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
export const OPEN_INQUIRY_STATUSES: InquiryStatus[] = ["new", "quoted", "followup"];

// Booked stages — a committed rental. A deal is calendar-eligible when it has a
// unit AND its stage is one of these.
export const BOOKED_STATUSES: InquiryStatus[] = ["confirmed", "out", "returned"];

export function isOpenStatus(s: string): boolean {
  return OPEN_INQUIRY_STATUSES.includes(s as InquiryStatus);
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

// Most recent activity timestamp (for staleness). Falls back to last_activity_at
// then created_at.
export function lastActivityDate(inq: Inquiry): Date | null {
  const fromActivity = (inq.activity || [])
    .map((a) => parseDate(a.occurred_at))
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  return (
    fromActivity ||
    parseDate(inq.last_activity_at) ||
    parseDate(inq.created_at) ||
    null
  );
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
  T extends { kind: string | null; direction?: string; subject: string | null }
>(m: T, automatedSubjects: Set<string>): boolean {
  if (m.kind === "internal_notification" || m.kind === "customer_autoreply") return true;
  // The forwarded echo of those mails reappears as an outbound message with the
  // same subject — not something a human on our side actually wrote.
  if (m.direction === "outbound" && automatedSubjects.has(normalizeSubject(m.subject))) {
    return true;
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

// Most recent moment a customer was actually contacted — an email exchanged or a
// call/email logged. Stage moves and other bookkeeping activity do NOT count, so
// shuffling a deal across the board never resets its "most recent activity"
// clock. Also ignores the inquiry's `last_activity_at` stamp (bumped by record
// edits), so the card time reflects the genuine last call or email. Falls back to
// created_at only when there's no correspondence or qualifying activity at all.
export function lastTouchedAt(inq: Inquiry): Date | null {
  const auto = automatedIntakeSubjects(inq.messages || []);
  const candidates: Date[] = [];
  for (const m of inq.messages || []) {
    if (isAutomatedIntakeMail(m, auto)) continue;
    const d = parseTimestamp(messageDate(m));
    if (d) candidates.push(d);
  }
  for (const a of inq.activity || []) {
    if (!TOUCH_ACTIVITY_TYPES.has(a.type)) continue;
    const d = parseTimestamp(a.occurred_at);
    if (d) candidates.push(d);
  }
  if (!candidates.length) {
    return parseTimestamp(inq.created_at);
  }
  return candidates.sort((a, b) => b.getTime() - a.getTime())[0];
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

/** The automation sender for site-generated inquiry mail. */
const AUTOMATION_FROM_RE = /inquiries@hdrsiteservices\.com/i;

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

// Inquiry references look like "HDR-AB12C". Used to match inbound replies
// (the reference is carried in every email subject) back to an inquiry.
const REFERENCE_RE = /\bHDR-[A-Z0-9]{3,8}\b/i;

export function extractReference(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const m = subject.match(REFERENCE_RE);
  return m ? m[0].toUpperCase() : null;
}
