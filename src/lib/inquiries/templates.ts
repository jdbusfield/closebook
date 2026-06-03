// Follow-up message templates for the HDR Sales CRM.
//
// These are the copy "tracks" a rep pulls from when working an inbound Google
// Ads lead: a cadence of call / text / email touches whose wording is tuned to
// the use case (production, construction, event, emergency) and to where the
// deal sits in the pipeline. Templates are intentionally plain data so they can
// be edited here without a migration; a future iteration can move them into a
// table for in-app editing.
//
// Nothing here sends anything — the picker renders the merge fields, copies the
// finished message to the clipboard (and offers a mailto compose), and logs the
// touch to the activity timeline. The rep still sends from their own phone/inbox.

import { type Inquiry, type InquiryStatus, fmtDate, fmtMoney } from "./shared";

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
  subject?: string; // email only
  body: string; // supports {first} {name} {use_case} {date} {location} {units} {value} {reference} {rep}
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

export const TEMPLATE_CHANNELS: TemplateChannel[] = ["sms", "call", "email"];
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
  // --- Track: Production (film / TV) ---------------------------------------
  {
    id: "prod-sms-intro",
    label: "Speed-to-lead text",
    channel: "sms",
    track: "production",
    stages: ["new"],
    cadence: "Within 5 min of the inquiry",
    body:
      "Hi {first}, it's {rep} at Hollywood Depot Rentals — got your request for restroom trailers for your {location} shoot. Are the dates locked? I can hold a luxury unit before it's spoken for. Call/text me here anytime.",
  },
  {
    id: "prod-email-intro",
    label: "Intro + ballpark",
    channel: "email",
    track: "production",
    stages: ["new"],
    cadence: "Same day, if no live connect",
    subject: "Restroom trailers for your {location} shoot",
    body:
      "Hi {first},\n\nThanks for reaching out. We run restroom & shower trailers for productions all over LA — ADA options, attendant service, and we deliver and service on your schedule so it's one less thing on the call sheet.\n\nFor a shoot your size you're likely in the right range delivered. Want me to hold a unit for {date} while you confirm? I just need the location and your run-of-show.\n\n— {rep}\nHollywood Depot Rentals · sales@hdrsiteservices.com",
  },

  // --- Track: Construction / job site --------------------------------------
  {
    id: "con-sms-intro",
    label: "Speed-to-lead text",
    channel: "sms",
    track: "construction",
    stages: ["new"],
    cadence: "Within 5 min of the inquiry",
    body:
      "{first}, this is {rep} with Hollywood Depot Rentals re: your restroom trailer request for {location}. How many crew on site and how long's the job? I'll get you a compliant setup and a monthly rate today.",
  },
  {
    id: "con-email-compliance",
    label: "OSHA-compliant + monthly rate",
    channel: "email",
    track: "construction",
    stages: ["new", "followup"],
    cadence: "Day 2 value email",
    subject: "Keeping {location} OSHA-compliant",
    body:
      "Hi {first},\n\nQuick follow-up — we handle restroom and shower trailers for job sites across SoCal with scheduled servicing so you stay compliant without thinking about it. Longer jobs get better monthly rates.\n\nHow many units and what's the duration? I'll size it and send a firm number the same day.\n\n— {rep}\nHollywood Depot Rentals",
  },

  // --- Track: Events / weddings --------------------------------------------
  {
    id: "evt-sms-intro",
    label: "Speed-to-lead text",
    channel: "sms",
    track: "event",
    stages: ["new"],
    cadence: "Within 5 min of the inquiry",
    body:
      "Hi {first}! It's {rep} at Hollywood Depot Rentals — saw your request for a restroom trailer for {date}. That's a popular weekend and units go fast. Want me to hold one for you?",
  },
  {
    id: "evt-email-intro",
    label: "Luxury intro + reserve nudge",
    channel: "email",
    track: "event",
    stages: ["new"],
    cadence: "Same day, if no live connect",
    subject: "Your {date} restroom trailer",
    body:
      "Hi {first},\n\nOur luxury restroom trailers are a guest favorite — climate control, real sinks, and nice finishes (a long way from a porta-potty). For {date} I'd recommend reserving soon, since weekend dates book out.\n\nHappy to send photos and a quote — roughly how many guests are you expecting?\n\n— {rep}\nHollywood Depot Rentals",
  },

  // --- Track: Emergency / disaster / overflow ------------------------------
  {
    id: "emg-sms-intro",
    label: "We have units now",
    channel: "sms",
    track: "emergency",
    stages: ["new"],
    cadence: "Within minutes",
    body:
      "{first}, {rep} at Hollywood Depot Rentals — we have restroom trailers available now and can deliver fast to {location}. Call me and I'll get you scheduled today.",
  },

  // --- General: works on any track, gated by stage -------------------------
  {
    id: "gen-sms-intro",
    label: "Speed-to-lead text",
    channel: "sms",
    track: "general",
    stages: ["new"],
    cadence: "Within 5 min of the inquiry",
    body:
      "Hi {first}, it's {rep} at Hollywood Depot Rentals — got your request about a restroom trailer for {location}. Quick question to get you the right quote: how many people and what dates? Call or text me right here.",
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
      "Hi {first},\n\nThanks for reaching out to Hollywood Depot Rentals. We rent restroom and shower trailers across Southern California and deliver, set up, and service them for you.\n\nTo get you an accurate quote, just reply with: your dates, the location, and roughly how many people. I can usually turn a number around the same day — and hold a unit while you decide.\n\n— {rep}\nHollywood Depot Rentals · sales@hdrsiteservices.com",
  },
  {
    id: "gen-call-script",
    label: "First-call talk track",
    channel: "call",
    track: "general",
    stages: ["new", "quoted", "followup"],
    cadence: "Live call attempts",
    body:
      "Hi {first}, this is {rep} calling from Hollywood Depot Rentals — you reached out about a restroom trailer. Did I catch you at an OK time?\n\n• What's the event/use and the dates? ({use_case} / {date})\n• Where are we delivering? ({location})\n• How many people, and is power/water on site?\n• Any ADA or shower needs?\n\nGreat — I can get you a firm quote today and hold a unit while you decide. What's the best email for it?",
  },
  {
    id: "quote-sms-followup",
    label: "Did the quote land?",
    channel: "sms",
    track: "general",
    stages: ["quoted"],
    cadence: "Day +1 after the quote",
    body:
      "Hi {first}, {rep} here — did the quote for {date} come through OK? Happy to walk through it. I can hold your unit through tomorrow before I release it — want me to?",
  },
  {
    id: "quote-email-hold",
    label: "Still want me to hold it?",
    channel: "email",
    track: "general",
    stages: ["quoted"],
    cadence: "Day +3 after the quote",
    subject: "Still want me to hold {date}?",
    body:
      "Hi {first},\n\nJust checking before I release the unit I set aside for you on {date}. If the number's the hangup, tell me your budget and I'll see what I can do. If timing changed, no problem — just let me know so I'm not chasing you.\n\n— {rep}\nHollywood Depot Rentals",
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
      "Hi {first},\n\nWanted to check back in — are you still planning on the restroom trailer for {date}? If you've got questions on sizing, service, or delivery I'm glad to help, and I can still lock in your date.\n\n— {rep}\nHollywood Depot Rentals",
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
      "Hi {first},\n\nI've reached out a few times and don't want to clutter your inbox, so I'll close out your file for now. If your plans firm up, just reply and I'll pick right back up — we're here whenever you need us.\n\n— {rep}\nHollywood Depot Rentals",
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
      "Hi {first},\n\nYou're all set for {date} — thank you! To make delivery smooth, can you confirm:\n\n• Exact delivery address / gate or access notes ({location})\n• Where we should place the trailer (level ground, ~clearance)\n• Power and water hookups on site, or do you need us to provide them?\n• An on-site contact and phone for the delivery day\n\nWe'll handle the rest. Reply here with anything and I'll get it scheduled.\n\n— {rep}\nHollywood Depot Rentals",
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
      "Hi {first},\n\nIt's {rep} at Hollywood Depot Rentals. We've added units and improved our turn times since we last talked. If you've got anything coming up that needs restroom or shower trailers, I'd love another shot at it.\n\n— {rep}\nHollywood Depot Rentals",
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
  const status = (inq.status || "new") as InquiryStatus;
  const track = inferTrack(inq);
  const relevant = list.filter(
    (t) => t.stages.includes(status) && (t.track === track || t.track === "general")
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

// Fill the {merge} fields from the inquiry + rep name. Unknown tokens are left
// visible (e.g. "{foo}") so a typo in a template is obvious rather than silent.
export function renderTemplate(
  tpl: MessageTemplate,
  inq: Inquiry,
  rep: string
): { subject?: string; body: string } {
  const map: Record<string, string> = {
    first: firstName(inq.name),
    name: inq.name?.trim() || "there",
    use_case: inq.use_case || "your rental",
    date: inq.start_date
      ? fmtDate(inq.start_date, { weekday: "long", month: "long", day: "numeric" })
      : "your dates",
    location: inq.location || "your site",
    units: inq.units != null ? String(inq.units) : "the",
    value: inq.estimated_value != null ? fmtMoney(inq.estimated_value) : "your quote",
    reference: inq.reference || "",
    rep: rep && rep !== "You" ? rep : "the HDR team",
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
  { token: "use_case", label: "Event / use case" },
  { token: "date", label: "Rental start date" },
  { token: "location", label: "Location" },
  { token: "units", label: "Number of units" },
  { token: "value", label: "Estimated value" },
  { token: "reference", label: "Inquiry reference" },
  { token: "rep", label: "Your name" },
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
