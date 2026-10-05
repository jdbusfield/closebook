// HDR AI price table: the one place restroom-trailer phone quotes are worked
// out. JD edits the rates in Inquiries → AI Price Table
// (rental_inquiry_ai_pricing). The ElevenLabs callback agent never does the
// math itself; it calls /api/inquiries/ai-price, which runs quoteTrailers()
// on the same row, so the page's shortcut grid and the agent always agree.
//
// Rules (JD, Oct 1 2026):
// - Only 4-stall trailers are offered on these calls.
// - trailers = ceil(guests / guests_per_trailer) (200 = 50 guests per stall).
// - Backyard and private parties use the private rate; weddings and every
//   other event use the event rate.
// - Price per trailer = first day + extra-day rate x (days - 1), where days
//   counts every calendar day from the first date to the last, both ends.
// - 2 trailers take discount_2_pct off each, 3 take discount_3_pct, 4 or
//   more take discount_4_plus_pct.
// - Optional attendant: hourly rate with a minimum, once per event.

export type EventCategory = "private" | "event";

export interface AiPricing {
  private_first_day: number;
  private_extra_day: number;
  event_first_day: number;
  event_extra_day: number;
  guests_per_trailer: number;
  discount_2_pct: number;
  discount_3_pct: number;
  discount_4_plus_pct: number;
  attendant_hourly: number;
  attendant_min_hours: number;
}

/** Same values as the migration's column defaults (Oct 1 2026 prices). */
export const DEFAULT_AI_PRICING: AiPricing = {
  private_first_day: 849,
  private_extra_day: 150,
  event_first_day: 1249,
  event_extra_day: 150,
  guests_per_trailer: 200,
  discount_2_pct: 10,
  discount_3_pct: 20,
  discount_4_plus_pct: 25,
  attendant_hourly: 50,
  attendant_min_hours: 6,
};

export const PRICING_FIELDS = Object.keys(DEFAULT_AI_PRICING) as (keyof AiPricing)[];

export const MAX_DAYS = 60;

export interface QuoteInput {
  category: EventCategory;
  guests: number;
  days: number;
  attendantHours?: number | null;
}

export interface Quote {
  category: EventCategory;
  guests: number;
  days: number;
  trailers: number;
  per_trailer_list: number;
  discount_pct: number;
  per_trailer: number;
  trailers_total: number;
  attendant_hours: number;
  attendant_total: number;
  total: number;
  /** What the agent should say: exact when undiscounted, else nearest $10. */
  say_total: number;
}

/** Turn any numeric-ish DB value (numeric columns arrive as strings) into the pricing shape. */
export function normalizePricing(row: Partial<Record<keyof AiPricing, unknown>> | null | undefined): AiPricing {
  const out = { ...DEFAULT_AI_PRICING };
  if (!row) return out;
  for (const k of PRICING_FIELDS) {
    const n = Number(row[k]);
    if (row[k] !== null && row[k] !== undefined && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export function trailersFor(guests: number, guestsPerTrailer: number): number {
  return Math.max(1, Math.ceil(guests / Math.max(1, guestsPerTrailer)));
}

export function discountPctFor(trailers: number, p: AiPricing): number {
  if (trailers >= 4) return p.discount_4_plus_pct;
  if (trailers === 3) return p.discount_3_pct;
  if (trailers === 2) return p.discount_2_pct;
  return 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function quoteTrailers(input: QuoteInput, p: AiPricing): Quote {
  const guests = Math.max(1, Math.round(input.guests));
  const days = Math.min(MAX_DAYS, Math.max(1, Math.round(input.days)));
  const trailers = trailersFor(guests, p.guests_per_trailer);
  const first = input.category === "private" ? p.private_first_day : p.event_first_day;
  const extra = input.category === "private" ? p.private_extra_day : p.event_extra_day;
  const perTrailerList = first + extra * (days - 1);
  const discountPct = discountPctFor(trailers, p);
  const perTrailer = round2(perTrailerList * (1 - discountPct / 100));
  const trailersTotal = round2(perTrailer * trailers);
  const requested = input.attendantHours && input.attendantHours > 0 ? input.attendantHours : 0;
  const attendantHours = requested ? Math.max(requested, p.attendant_min_hours) : 0;
  const attendantTotal = round2(attendantHours * p.attendant_hourly);
  const total = round2(trailersTotal + attendantTotal);
  const sayTotal = discountPct > 0 ? Math.round(total / 10) * 10 : Math.round(total);
  return {
    category: input.category,
    guests,
    days,
    trailers,
    per_trailer_list: perTrailerList,
    discount_pct: discountPct,
    per_trailer: perTrailer,
    trailers_total: trailersTotal,
    attendant_hours: attendantHours,
    attendant_total: attendantTotal,
    total,
    say_total: sayTotal,
  };
}

/** Calendar days from start to end, counting both ends. Null when unparseable or reversed. */
export function rentalDays(start: string, end?: string | null): number | null {
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };
  const a = parse(start);
  const b = end && end.trim() ? parse(end) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}

/**
 * Map whatever the agent passes ("wedding", "backyard party", "private") to a
 * rate category. Only backyard / private / birthday / house parties get the
 * private rate; weddings and anything unrecognized get the event rate.
 */
export function categoryFor(raw: string | null | undefined): EventCategory {
  const s = (raw ?? "").toLowerCase();
  if (/wedding/.test(s)) return "event";
  if (/private|backyard|back yard|birthday|house party|home|family/.test(s)) return "private";
  return "event";
}

/** Guest bands for the shortcut grid: 1-200, 201-400, ... up to `bands` trailers. */
export function guestBands(p: AiPricing, bands = 5): { label: string; guests: number; trailers: number }[] {
  const g = Math.max(1, p.guests_per_trailer);
  return Array.from({ length: bands }, (_, i) => ({
    label: `${i * g + 1}–${(i + 1) * g}`,
    guests: (i + 1) * g,
    trailers: i + 1,
  }));
}
