// Quote price validity uses one business calendar, independent of the browser,
// server timezone or DST. Issuance is the persisted created_at (first save).
// Inventory reservations/holds are deliberately outside this policy.
export const QUOTE_TIME_ZONE = "America/Los_Angeles";

type QuoteDates = {
  created_at?: string | null;
  valid_until?: string | null;
  status?: string;
  terms?: string | null;
};

export function calendarDate(value?: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function businessDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: QUOTE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function quoteIssueDate(createdAt?: string | null): string | null {
  // Timestamps must identify an instant, never depend on the viewer's timezone.
  if (!createdAt || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(createdAt)) return null;
  const date = new Date(createdAt);
  return Number.isFinite(date.getTime()) ? businessDate(date) : null;
}

export function addCalendarDays(date: string, days: number): string {
  if (!calendarDate(date)) throw new Error("Invalid calendar date");
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function quoteValidityLimit(issuedOn: string, startDate?: string | null): string | null {
  const event = calendarDate(startDate);
  if (!calendarDate(issuedOn) || !event || event <= issuedOn) return null;
  return [addCalendarDays(issuedOn, 3), addCalendarDays(event, -1)].sort()[0];
}

export function prepareQuoteValidity(
  startDate?: string | null,
  requestedValidUntil?: string | null,
  now: Date = new Date(),
): { created_at: string; valid_until: string | null } {
  const issuedOn = businessDate(now);
  const limit = quoteValidityLimit(issuedOn, startDate);
  if (requestedValidUntil && (!calendarDate(requestedValidUntil) || !limit || requestedValidUntil < issuedOn || requestedValidUntil > limit)) {
    throw new Error(limit
      ? `Choose a validity date from ${issuedOn} through ${limit} (${QUOTE_TIME_ZONE}).`
      : "This event date requires review. Save a draft without a validity date.");
  }
  return { created_at: now.toISOString(), valid_until: requestedValidUntil || limit };
}

export function formatQuoteDate(value?: string | null): string {
  const date = calendarDate(value);
  return date ? new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`)) : "Review required";
}

export function quoteValidityText(quote: QuoteDates): string {
  return calendarDate(quote.valid_until)
    ? `Pricing valid through ${formatQuoteDate(quote.valid_until)} (${QUOTE_TIME_ZONE}).`
    : "Price validity requires review before sending or accepting this quote.";
}

// Legacy/custom terms are preserved. Reject fixed-duration pricing claims at
// action time instead of rewriting them or mistaking an inventory hold for price validity.
export function assertQuoteTermsCompatible(text: string): void {
  const flat = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const duration = "(?:\\d+|one|two|three|four|five|seven|fourteen|thirty)(?:\\s*\\([^)]+\\))?\\s*[- ]?\\s*(?:calendar\\s+|business\\s+)?days?";
  const pricing = "(?:quot(?:e|es|ed)|pric(?:e|es|ing)|rates?)";
  const promise = "(?:valid|good|held|hold|honou?red|guaranteed|expires?|locked|stands?)";
  if (new RegExp(`\\b${pricing}[^.!?;]{0,90}\\b${promise}[^.!?;]{0,50}\\b${duration}\\b`, "i").test(flat)
    || new RegExp(`\\b${promise}[^.!?;]{0,30}\\b${pricing}[^.!?;]{0,30}\\b${duration}\\b`, "i").test(flat)) {
    throw new Error("Review legacy quote terms: replace fixed-day price validity with the saved quote's exact expiry date. Inventory hold terms are separate.");
  }
}

export function quoteActionProblem(
  quote: QuoteDates,
  inquiry: { start_date?: string | null },
  now: Date = new Date(),
): string | null {
  if (quote.status && !["draft", "sent"].includes(quote.status)) {
    return `This quote is ${quote.status}; review it before sending or accepting.`;
  }
  const issuedOn = quoteIssueDate(quote.created_at);
  if (!issuedOn) return "Quote issuance is missing or invalid; review and issue a new quote.";
  const event = calendarDate(inquiry.start_date);
  if (!event) return "Confirm an exact event date (YYYY-MM-DD) before sending or accepting the quote.";
  const today = businessDate(now);
  if (event <= today || event <= issuedOn) return "Same-day or past event: review required before sending or accepting the quote.";
  const expiry = calendarDate(quote.valid_until);
  if (!expiry) return "Quote validity is missing or invalid; review and issue a new quote.";
  if (expiry < today) return `Quote expired on ${formatQuoteDate(expiry)} (${QUOTE_TIME_ZONE}); issue a new quote.`;
  const limit = quoteValidityLimit(issuedOn, event);
  if (issuedOn > today || expiry < issuedOn || !limit || expiry > limit) {
    return "Saved quote dates conflict with the three-calendar-day/event-date policy; review and issue a new quote.";
  }
  try { assertQuoteTermsCompatible(quote.terms || ""); } catch (error) {
    return (error as Error).message;
  }
  return null;
}

export function assertQuoteActionable(quote: QuoteDates, inquiry: { start_date?: string | null }, now: Date = new Date()): void {
  const problem = quoteActionProblem(quote, inquiry, now);
  if (problem) throw new Error(problem);
}
