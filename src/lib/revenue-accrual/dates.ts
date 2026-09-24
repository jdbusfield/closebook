import type { IsoDate, MonthRef } from "./types";

const DAY = 86_400_000;

export function toUtc(d: IsoDate): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

export function fromUtc(t: number): IsoDate {
  return new Date(t).toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromUtc(toUtc(d) + n * DAY);
}

export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY);
}

export function monthStart(p: MonthRef): IsoDate {
  return `${p.year}-${String(p.month).padStart(2, "0")}-01`;
}

export function monthEnd(p: MonthRef): IsoDate {
  return fromUtc(Date.UTC(p.year, p.month, 0));
}

export function shiftMonth(p: MonthRef, n: number): MonthRef {
  const idx = p.year * 12 + (p.month - 1) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Inclusive day count of a rental. */
export function rentalDays(start: IsoDate, end: IsoDate): number {
  return Math.max(1, daysBetween(start, end) + 1);
}

/** Share of a rental's days that fall on or before `cutoff` (inclusive). */
export function shareThrough(start: IsoDate, end: IsoDate, cutoff: IsoDate): number {
  if (toUtc(cutoff) < toUtc(start)) return 0;
  if (toUtc(cutoff) >= toUtc(end)) return 1;
  return rentalDays(start, cutoff) / rentalDays(start, end);
}

/** "YY.MM", the prefix used on HDR journal entry numbers. */
export function jePrefix(p: MonthRef): string {
  return `${String(p.year).slice(2)}.${String(p.month).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthShort(p: MonthRef): string {
  return MONTHS[p.month - 1];
}

/**
 * Service dates written in invoice line memos: "Service 8-27-26 @ 1pm",
 * "Service- at 4pm on Sat(8/29)", "on 08/24 @ 10am". A missing year takes
 * the year that puts the date closest to the document date.
 */
export function memoDates(memo: string, docDate: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  // Skip time ranges like "12-1pm" and "5-6 pm"
  const re = /(?<![\dx$.:])(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?(?![\dx%:])(?!\s*[ap]\.?m\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(memo)) !== null) {
    const mo = Number(m[1]);
    const da = Number(m[2]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
    let year: number;
    if (m[3]) {
      year = Number(m[3]);
      if (year < 100) year += 2000;
      if (year < 2020 || year > 2100) continue;
    } else {
      const dy = Number(docDate.slice(0, 4));
      const cands = [dy - 1, dy, dy + 1].map((y) => fromUtc(Date.UTC(y, mo - 1, da)));
      cands.sort((a, b) => Math.abs(daysBetween(a, docDate)) - Math.abs(daysBetween(b, docDate)));
      out.push(cands[0]);
      continue;
    }
    const iso = fromUtc(Date.UTC(year, mo - 1, da));
    // Guard against typos like "8-27-27" on an invoice dated 9/2026
    if (Math.abs(daysBetween(iso, docDate)) > 200) {
      const fixed = fromUtc(Date.UTC(Number(docDate.slice(0, 4)), mo - 1, da));
      if (Math.abs(daysBetween(fixed, docDate)) <= 200) out.push(fixed);
      continue;
    }
    out.push(iso);
  }
  return out;
}

/**
 * "Rental Period" custom field. People type it many ways: "8/1/26 - 8/15/26",
 * "08/26/26 08/28/26" (no dash), "8/1 to 8/15/2026", "08/24/26". Every date
 * in the text counts; the earliest is the start and the latest the end.
 */
export function parseRentalPeriod(value: string, docDate: IsoDate): { start: IsoDate; end: IsoDate } | null {
  const ds = memoDates(value, docDate).sort((a, b) => toUtc(a) - toUtc(b));
  if (!ds.length) return null;
  return { start: ds[0], end: ds[ds.length - 1] };
}
