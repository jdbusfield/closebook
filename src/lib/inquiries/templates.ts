// Follow-up email templates for the HDR Sales CRM.
//
// The copy a rep pulls from when working an inbound Google Ads lead, tuned to
// the use case (production, construction, event, emergency) and to where the
// deal sits in the pipeline. Every template is an email. They're plain data so
// the Templates page can persist edits as overrides in rental_inquiry_templates.
//
// Nothing here sends anything — the picker renders the merge fields, copies the
// finished email to the clipboard (and offers a mailto compose), and logs the
// touch to the activity timeline. The rep still sends from their own inbox.

import {
  type Inquiry,
  type InquiryStatus,
  fmtDate,
  fmtRange,
  fmtMoney,
  inquiryKind,
} from "./shared";

// Brand identity for the {company}/{company_email} merge tokens + the rep
// fallback, chosen the same way the quote PDF picks its theme: Versatile by
// source "versatile" or a "VS-" reference, else HDR (default). This keeps a
// Versatile lead's follow-ups signed as Versatile while HDR copy is unchanged.
export function brandOf(inq: Inquiry): {
  company: string;
  email: string;
  phone: string;
  team: string;
} {
  const isVersatile =
    (inq.source || "").toLowerCase() === "versatile" || /^VS-/i.test(inq.reference || "");
  return isVersatile
    ? {
        company: "Versatile Studios",
        email: "rentals@versatilestudios.com",
        phone: "(213) 935-8124",
        team: "the Versatile team",
      }
    : {
        company: "Hollywood Depot Rentals",
        email: "sales@hdrsiteservices.com",
        phone: "(818) 845-8077",
        team: "the HDR team",
      };
}

// Kept as a union for the persisted column, but every template is an email.
export type TemplateChannel = "email" | "sms" | "call";
export type TemplateTrack =
  | "production"
  | "construction"
  | "event"
  | "emergency"
  | "general";

export interface MessageTemplate {
  id: string;
  label: string; // short name shown in the picker
  channel: TemplateChannel;
  track: TemplateTrack;
  stages: InquiryStatus[]; // pipeline stages this step belongs to
  cadence?: string; // human hint for when in the sequence this fires
  subject?: string;
  body: string; // supports the {merge} tokens in MERGE_FIELDS
}

export const CHANNEL_LABEL: Record<TemplateChannel, string> = {
  email: "Email",
  sms: "Text",
  call: "Call script",
};

export const TRACK_LABEL: Record<TemplateTrack, string> = {
  production: "Production",
  construction: "Construction",
  event: "Event / wedding",
  emergency: "Emergency",
  general: "General",
};

export const TEMPLATE_TRACKS: TemplateTrack[] = [
  "general",
  "production",
  "construction",
  "event",
  "emergency",
];

// ---------------------------------------------------------------------------
// The default templates (shipped in code; the Templates page persists edits as
// overrides in rental_inquiry_templates, keyed by the ids below).
// ---------------------------------------------------------------------------
export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  // --- General: quote + recap (the workhorse first reply) ------------------
  {
    id: "quote-email-builder",
    label: "Quote — recap + pricing",
    channel: "email",
    track: "general",
    stages: ["new", "quoted"],
    cadence: "First response — recap their request and price it",
    subject: "Your {company} quote ({reference})",
    body:
      "Hi {first},\n\nThanks for reaching out to {company}! Here's a recap of what you sent over:\n\n{details}\n\nBased on that, here's your quote:\n\n{quote}\n\nThis includes delivery, setup, and servicing. The quote is good for 14 days and I'm glad to hold your date while you decide. Want me to lock it in?\n\n— {rep}\n{company} · {company_email}",
  },
  {
    id: "gen-email-intro",
    label: "Intro + easy reply",
    channel: "email",
    track: "general",
    stages: ["new"],
    cadence: "Same day, if no live connect",
    subject: "Your restroom trailer request",
    body:
      "Hi {first},\n\nThanks for reaching out to {company}. We rent restroom and shower trailers across Southern California and deliver, set up, and service them for you.\n\nTo get you an accurate quote, just reply with: your dates, the location, and roughly how many people. I can usually turn a number around the same day — and hold a unit while you decide.\n\n— {rep}\n{company} · {company_email}",
  },

  // --- Track: Production (film / TV) ---------------------------------------
  {
    id: "prod-email-intro",
    label: "Intro + ballpark",
    channel: "email",
    track: "production",
    stages: ["new"],
    cadence: "Same day, if no live connect",
    subject: "Restroom trailers for your {location} shoot",
    body:
      "Hi {first},\n\nThanks for reaching out. We run restroom & shower trailers for productions all over LA — ADA options, attendant service, and we deliver and service on your schedule so it's one less thing on the call sheet.\n\nFor a shoot your size you're likely in the right range delivered. Want me to hold a unit for {date} while you confirm? I just need the location and your run-of-show.\n\n— {rep}\n{company} · {company_email}",
  },

  // --- Track: Construction / job site --------------------------------------
  {
    id: "con-email-compliance",
    label: "OSHA-compliant + monthly rate",
    channel: "email",
    track: "construction",
    stages: ["new", "followup"],
    cadence: "Day 2 value email",
    subject: "Keeping {location} OSHA-compliant",
    body:
      "Hi {first},\n\nQuick follow-up — we handle restroom and shower trailers for job sites across SoCal with scheduled servicing so you stay compliant without thinking about it. Longer jobs get better monthly rates.\n\nHow many units and what's the duration? I'll size it and send a firm number the same day.\n\n— {rep}\n{company}",
  },

  // --- Track: Events / weddings --------------------------------------------
  {
    id: "evt-email-intro",
    label: "Luxury intro + reserve nudge",
    channel: "email",
    track: "event",
    stages: ["new"],
    cadence: "Same day, if no live connect",
    subject: "Your {date} restroom trailer",
    body:
      "Hi {first},\n\nOur luxury restroom trailers are a guest favorite — climate control, real sinks, and nice finishes (a long way from a porta-potty). For {date} I'd recommend reserving soon, since weekend dates book out.\n\nHappy to send photos and a quote — roughly how many guests are you expecting?\n\n— {rep}\n{company}",
  },

  // --- General: stage-gated follow-ups -------------------------------------
  {
    id: "quote-email-hold",
    label: "Still want me to hold it?",
    channel: "email",
    track: "general",
    stages: ["quoted"],
    cadence: "Day +3 after the quote",
    subject: "Still want me to hold {date}?",
    body:
      "Hi {first},\n\nJust checking before I release the unit I set aside for you on {date}. If the number's the hangup, tell me your budget and I'll see what I can do. If timing changed, no problem — just let me know so I'm not chasing you.\n\n— {rep}\n{company}",
  },
  {
    id: "followup-email-checkin",
    label: "Soft check-in",
    channel: "email",
    track: "general",
    stages: ["followup", "quoted"],
    cadence: "~Day 7",
    subject: "Quick check-in on your restroom trailer",
    body:
      "Hi {first},\n\nWanted to check back in — are you still planning on the restroom trailer for {date}? If you've got questions on sizing, service, or delivery I'm glad to help, and I can still lock in your date.\n\n— {rep}\n{company}",
  },
  {
    id: "photos-email",
    label: "Photos + what to expect",
    channel: "email",
    track: "general",
    stages: ["quoted", "followup"],
    cadence: "Day 2 — value touch, no ask",
    subject: "A look inside the trailer for {date}",
    body:
      "Hi {first},\n\nWhile you're deciding, want a look inside? I can send interior photos of the exact unit I quoted for {date} — real sinks, climate control, and finishes people don't expect from a rental.\n\nReply \"photos\" and they're on the way. If it helps to see one in person, we can usually arrange that too.\n\n— {rep}\n{company}",
  },
  {
    id: "budget-email",
    label: "Budget check — right-size the quote",
    channel: "email",
    track: "general",
    stages: ["quoted", "followup"],
    cadence: "Day 5 — if price might be the holdup",
    subject: "If the number didn't fit, tell me",
    body:
      "Hi {first},\n\nIf my quote missed your budget, I'd rather fix it than lose you. There's usually room to right-size — a smaller unit, a tighter service schedule, or different dates can move the number a fair amount.\n\nWhat were you hoping to spend? I'll tell you straight what we can do at that price.\n\n— {rep}\n{company}",
  },
  {
    id: "prod-email-checkin",
    label: "Shoot check-in + COI offer",
    channel: "email",
    track: "production",
    stages: ["quoted", "followup"],
    cadence: "Day 3 — production leads",
    subject: "Still good for the {location} shoot?",
    body:
      "Hi {first},\n\nChecking in on the trailer for your shoot. If the schedule moved, no problem — we flex dates all the time and I can re-hold the unit around your new plan.\n\nIf you're waiting on locations or insurance, send over the COI requirements and I'll have the certificate back to you the same day.\n\n— {rep}\n{company}",
  },
  {
    id: "breakup-email",
    label: "Breakup / closing your file",
    channel: "email",
    track: "general",
    stages: ["new", "quoted", "followup"],
    cadence: "~Day 10, unanswered",
    subject: "Closing out your file for now",
    body:
      "Hi {first},\n\nI've reached out a few times and don't want to clutter your inbox, so I'll close out your file for now. If your plans firm up, just reply and I'll pick right back up — we're here whenever you need us.\n\n— {rep}\n{company}",
  },
  {
    id: "confirmed-email-logistics",
    label: "Pre-delivery confirmation",
    channel: "email",
    track: "general",
    stages: ["confirmed"],
    cadence: "After they book",
    subject: "You're booked — delivery details for {date}",
    body:
      "Hi {first},\n\nYou're all set for {date} — thank you! To make delivery smooth, can you confirm:\n\n• Exact delivery address / gate or access notes ({location})\n• Where we should place the trailer (level ground, ~clearance)\n• Power and water hookups on site, or do you need us to provide them?\n• An on-site contact and phone for the delivery day\n\nWe'll handle the rest. Reply here with anything and I'll get it scheduled.\n\n— {rep}\n{company}",
  },
  {
    id: "winback-email",
    label: "Win-back",
    channel: "email",
    track: "general",
    stages: ["lost"],
    cadence: "Quarterly nurture",
    subject: "Another shot at your restroom trailer needs?",
    body:
      "Hi {first},\n\nIt's {rep} at {company}. We've added units and improved our turn times since we last talked. If you've got anything coming up that needs restroom or shower trailers, I'd love another shot at it.\n\n— {rep}\n{company}",
  },
];

// ---------------------------------------------------------------------------
// Track inference + selection + rendering
// ---------------------------------------------------------------------------

// Best-guess the track from the inquiry's use case / source text so the picker
// can surface the most relevant copy first. Falls back to "general".
export function inferTrack(inq: Inquiry): TemplateTrack {
  const hay = `${inq.use_case ?? ""} ${inq.notes ?? ""} ${inq.source ?? ""}`.toLowerCase();
  if (/(film|tv|television|production|shoot|studio|set|commercial|photo)/.test(hay))
    return "production";
  if (/(construct|job ?site|contractor|build|gc|crew|osha|trade)/.test(hay))
    return "construction";
  if (/(wedding|event|party|festival|reception|gala|birthday|concert)/.test(hay))
    return "event";
  if (/(emergency|disaster|urgent|asap|flood|fire|outage|displaced)/.test(hay))
    return "emergency";
  return "general";
}

// Filter any template list down to the ones relevant to an inquiry: those whose
// stage matches the current status, in the inferred track or the general
// fallback. Inferred-track copy is ranked ahead of the generic version.
export function selectTemplates<T extends MessageTemplate>(
  list: T[],
  inq: Inquiry
): T[] {
  const raw = (inq.status || "new") as InquiryStatus;
  // Later follow-up rounds, Responded Back, and Keep Warm reuse the follow-up
  // stage's template library — including any DB overrides saved before those
  // stages existed.
  const status: InquiryStatus =
    raw === "followup2" ||
    raw === "followup3" ||
    raw === "responded" ||
    raw === "keepwarm"
      ? "followup"
      : raw;
  const track = inferTrack(inq);
  const relevant = list.filter(
    (t) =>
      t.channel === "email" &&
      t.stages.includes(status) &&
      (t.track === track || t.track === "general")
  );
  return relevant.sort((a, b) => {
    const at = a.track === track && track !== "general" ? 0 : 1;
    const bt = b.track === track && track !== "general" ? 0 : 1;
    return at - bt;
  });
}

// Convenience over the shipped defaults (used when no DB overrides are loaded).
export function templatesFor(inq: Inquiry): MessageTemplate[] {
  return selectTemplates(DEFAULT_TEMPLATES, inq);
}

function firstName(name: string | null): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0] || "there";
}

// What the {first} token renders: the inquiry's greeting override verbatim
// when set, else the first word of the name. The override exists because
// first-word splitting mangles multi-word first names ("La Trina" → "La").
export function greetingName(inq: Pick<Inquiry, "name" | "greeting_name">): string {
  return inq.greeting_name?.trim() || firstName(inq.name);
}

// A formatted recap of everything the customer submitted through the website —
// the {details} merge token. Only includes fields that are actually present.
export function buildDetailsBlock(inq: Inquiry): string {
  const lines: string[] = [];
  if (inq.use_case) lines.push(`Event / use: ${inq.use_case}`);
  const dates = fmtRange(inq.start_date, inq.end_date, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (dates) lines.push(`Dates: ${dates}`);
  if (inq.duration) lines.push(`Duration: ${inq.duration}`);
  // Stall math only applies to bathroom-trailer requests. Production-supplies
  // orders skip units entirely (legacy rows hold a meaningless piece-count sum);
  // their real contents are already in the notes' itemized ORDER block.
  if (inq.units != null) {
    const kind = inquiryKind(inq);
    if (kind === "trailer") {
      lines.push(`Units: ${inq.units} (${inq.units * 4} stalls)`);
    } else if (kind === "general") {
      lines.push(`Units: ${inq.units}`);
    }
  }
  if (inq.guests) lines.push(`Guest count: ${inq.guests}`);
  if (inq.location) lines.push(`Location: ${inq.location}`);
  if (inq.attendant) lines.push(`Attendant: ${inq.attendant}`);
  if (inq.notes) lines.push(`Notes: ${inq.notes}`);
  if (lines.length === 0) return "(no request details on file)";
  return lines.map((l) => `• ${l}`).join("\n");
}

// Fill the {merge} fields from the inquiry + rep name. `extra` supplies dynamic
// values built at send time (notably {quote} from the quote builder). Unknown
// tokens are left visible (e.g. "{foo}") so a typo is obvious, not silent.
export function renderTemplate(
  tpl: MessageTemplate,
  inq: Inquiry,
  rep: string,
  extra?: { quote?: string; quote_number?: string }
): { subject?: string; body: string } {
  const brand = brandOf(inq);
  const map: Record<string, string> = {
    first: greetingName(inq),
    company: brand.company,
    company_email: brand.email,
    company_phone: brand.phone,
    name: inq.name?.trim() || "there",
    use_case: inq.use_case || "your rental",
    date: inq.start_date
      ? fmtDate(inq.start_date, { weekday: "long", month: "long", day: "numeric" })
      : "your dates",
    end_date: inq.end_date
      ? fmtDate(inq.end_date, { month: "long", day: "numeric" })
      : "—",
    duration: inq.duration || "—",
    units: inq.units != null ? String(inq.units) : "the",
    guests: inq.guests || "—",
    attendant: inq.attendant || "—",
    location: inq.location || "your site",
    phone: inq.phone || "—",
    email: inq.email || "—",
    value: inq.estimated_value != null ? fmtMoney(inq.estimated_value) : "your quote",
    reference: inq.reference || "",
    rep: rep && rep !== "You" ? rep : brand.team,
    details: buildDetailsBlock(inq),
    quote: extra?.quote ?? "— your itemized quote will appear here —",
    quote_number: extra?.quote_number ?? "",
  };
  const fill = (s?: string) =>
    s?.replace(/\{(\w+)\}/g, (_, k: string) => (k in map ? map[k] : `{${k}}`));
  return { subject: fill(tpl.subject), body: fill(tpl.body) ?? "" };
}

// The merge fields a template may use, with a short description — surfaced as
// insertable chips in the editor.
export const MERGE_FIELDS: { token: string; label: string }[] = [
  { token: "first", label: "Customer first name" },
  { token: "name", label: "Customer full name" },
  { token: "details", label: "All submitted request details" },
  { token: "quote", label: "Itemized quote (built when sending)" },
  { token: "quote_number", label: "Latest saved quote number" },
  { token: "use_case", label: "Event / use case" },
  { token: "date", label: "Rental start date" },
  { token: "end_date", label: "Rental end date" },
  { token: "duration", label: "Rental duration" },
  { token: "units", label: "Number of units" },
  { token: "guests", label: "Guest count" },
  { token: "attendant", label: "Attendant" },
  { token: "location", label: "Location" },
  { token: "phone", label: "Customer phone" },
  { token: "email", label: "Customer email" },
  { token: "value", label: "Estimated value" },
  { token: "reference", label: "Inquiry reference" },
  { token: "rep", label: "Your name" },
  { token: "company", label: "Brand name (auto by entity)" },
  { token: "company_email", label: "Brand email (auto by entity)" },
  { token: "company_phone", label: "Brand phone (auto by entity)" },
];

// ---------------------------------------------------------------------------
// Effective templates = code defaults overlaid with the entity's saved edits.
// ---------------------------------------------------------------------------

// A persisted edit/override row from rental_inquiry_templates.
export interface TemplateRow {
  id: string;
  template_key: string;
  label: string;
  channel: TemplateChannel;
  track: TemplateTrack;
  stages: string[];
  cadence: string | null;
  subject: string | null;
  body: string;
  sort_order: number;
  archived: boolean;
}

export interface EffectiveTemplate extends MessageTemplate {
  source: "default" | "custom"; // shipped in code vs. created in-app
  overridden: boolean; // a default whose copy has been edited
  archived: boolean; // a default the team chose to hide
  rowId?: string; // rental_inquiry_templates.id, when persisted
  sortOrder: number;
}

function rowToTemplate(row: TemplateRow): MessageTemplate {
  return {
    id: row.template_key,
    label: row.label,
    channel: row.channel,
    track: row.track,
    stages: row.stages as InquiryStatus[],
    cadence: row.cadence ?? undefined,
    subject: row.subject ?? undefined,
    body: row.body,
  };
}

// Merge the shipped defaults with the saved rows. A row sharing a default's key
// overrides it (or hides it when archived); rows with new keys are custom
// templates. Returns archived entries too so the editor can show/restore them —
// filter on `.archived` for runtime use.
export function mergeTemplates(rows: TemplateRow[]): EffectiveTemplate[] {
  const byKey = new Map(rows.map((r) => [r.template_key, r]));
  const out: EffectiveTemplate[] = [];
  const defaultKeys = new Set(DEFAULT_TEMPLATES.map((d) => d.id));

  DEFAULT_TEMPLATES.forEach((def, i) => {
    const row = byKey.get(def.id);
    if (row) {
      out.push({
        ...rowToTemplate(row),
        source: "default",
        overridden: true,
        archived: row.archived,
        rowId: row.id,
        sortOrder: row.sort_order || i,
      });
    } else {
      out.push({
        ...def,
        source: "default",
        overridden: false,
        archived: false,
        sortOrder: i,
      });
    }
  });

  rows
    .filter((r) => !defaultKeys.has(r.template_key))
    .forEach((row, i) =>
      out.push({
        ...rowToTemplate(row),
        source: "custom",
        overridden: false,
        archived: row.archived,
        rowId: row.id,
        sortOrder: row.sort_order || 1000 + i,
      })
    );

  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}
