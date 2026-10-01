// Price validity uses the Los Angeles calendar, independent of browser/server
// timezone and DST. These defaults apply only to new quotes, not saved records.
export const QUOTE_TIME_ZONE = "America/Los_Angeles";

function calendarDate(value?: string | null): string | null {
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
  if (!createdAt || !/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(createdAt)) return null;
  const date = new Date(createdAt);
  return Number.isFinite(date.getTime()) ? businessDate(date) : null;
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function prepareQuoteValidity(
  startDate?: string | null,
  requestedValidUntil?: string | null,
  now: Date = new Date(),
): { created_at: string; valid_until: string | null } {
  const created_at = now.toISOString();
  const issuedOn = quoteIssueDate(created_at)!;
  const event = calendarDate(startDate);
  const defaultExpiry = event && event > issuedOn
    ? [addDays(issuedOn, 3), addDays(event, -1)].sort()[0]
    : null;
  // Explicit dates retain the existing custom-date behavior.
  return { created_at, valid_until: requestedValidUntil || defaultExpiry };
}

export function formatQuoteDate(value?: string | null): string {
  const date = calendarDate(value);
  return date ? new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`)) : "Not set";
}

export function quoteValidityText(quote: { valid_until?: string | null }): string {
  return calendarDate(quote.valid_until)
    ? `Pricing valid through ${formatQuoteDate(quote.valid_until)}.`
    : "Pricing validity date not set.";
}

export function assertQuoteNotExpired(quote: { valid_until?: string | null }, now: Date = new Date()): void {
  const expiry = calendarDate(quote.valid_until);
  if (expiry && expiry < businessDate(now)) {
    throw new Error(`This quote expired on ${formatQuoteDate(expiry)}. Issue a new quote.`);
  }
}
