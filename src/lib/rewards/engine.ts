/**
 * Versatile Rewards earning engine. Pure functions, no I/O: the nightly runner
 * (run.ts) feeds it cached RentalWorks invoices and writes what it returns.
 *
 * Rules (JD, Oct 16 2026):
 * - Points are earned on eligible spend: the invoice subtotal (pre-tax, after
 *   every discount, so negotiated discounts never stack) on rental lines only.
 * - Tiers qualify on eligible spend in dollars per calendar year. A tier earned
 *   in year Y lasts through Dec 31 of Y+1.
 * - Points are spendable once the invoice is paid and expire 12 months after
 *   they are earned (the invoice date).
 * - Invoices before program_start_date are "preview": computed so staff can
 *   see what 2026 would have earned, never shown to customers or spendable.
 */

export interface RewardsSettings {
  programStartDate: string; // YYYY-MM-DD
  previewStartDate: string | null;
  invoicePrefixes: string[];
  countedStatuses: string[];
  paidStatuses: string[];
  eligibleRecTypes: string[];
  excludedICodes: string[];
  bathroomICodes: string[];
  weekendBonusEnabled: boolean;
  pointsExpireMonths: number;
}

export interface TierDef {
  key: string;
  name: string;
  sortOrder: number;
  minAnnualSpend: number;
  pointsPerDollar: number;
  weekendPointsPerDollar: number | null;
  bathroomBonusPoints: number | null;
}

export interface CachedInvoice {
  rwInvoiceId: string;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  billingStartDate: string | null;
  billingEndDate: string | null;
  status: string;
  customerId: string;
  customerName: string;
  subTotal: number;
}

export interface CachedItem {
  iCode: string | null;
  recType: string | null;
  extended: number;
  quantity: number;
}

export interface EarnRow {
  sourceKey: string;
  rwInvoiceId: string;
  rwCustomerId: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceStatus: string;
  eligibleSpend: number;
  points: number;
  bonusPoints: number;
  tierKey: string;
  pointsPerDollar: number;
  weekendApplied: boolean;
  isPreview: boolean;
  isAvailable: boolean;
  earnedOn: string;
  expiresOn: string;
}

export interface TierTransition {
  fromTierKey: string | null;
  toTierKey: string;
  effectiveOn: string;
  isPreview: boolean;
}

export interface MemberEarnings {
  rows: EarnRow[];
  /** Eligible spend per calendar year. */
  spendByYear: Map<number, number>;
  transitions: TierTransition[];
}

// ── Dates ────────────────────────────────────────────────────────────────

const yearOf = (iso: string) => Number(iso.slice(0, 4));

/** Add calendar months to a YYYY-MM-DD date, clamping to the month's last day. */
export function addMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + months;
  const d = Number(iso.slice(8, 10));
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** True when the billing period includes a Saturday or Sunday. */
export function coversWeekend(start: string | null, end: string | null): boolean {
  if (!start) return false;
  const s = Date.parse(start);
  const e = Date.parse(end && end >= start ? end : start);
  if (isNaN(s) || isNaN(e)) return false;
  if (e - s >= 6 * 864e5) return true;
  for (let t = s; t <= e; t += 864e5) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) return true;
  }
  return false;
}

// ── Invoice scope and eligible spend ──────────────────────────────────────

/** Earliest date that earns anything (preview start, else program start). */
export function earliestCountedDate(settings: RewardsSettings): string {
  const p = settings.previewStartDate;
  return p && p < settings.programStartDate ? p : settings.programStartDate;
}

export function isInScope(inv: CachedInvoice, settings: RewardsSettings): boolean {
  const num = (inv.invoiceNumber || "").toUpperCase();
  if (!settings.invoicePrefixes.some((p) => num.startsWith(p.toUpperCase()))) return false;
  if (!settings.countedStatuses.includes((inv.status || "").toUpperCase())) return false;
  if (!inv.invoiceDate || inv.invoiceDate < earliestCountedDate(settings)) return false;
  return !!inv.customerId;
}

/**
 * Eligible spend = invoice subtotal × (eligible line value ÷ all line value).
 * The subtotal is already net of discounts and pre-tax; prorating it by line
 * value carries the discount onto the rental lines that earn. Reversal
 * invoices have a negative subtotal and positive cached lines, so they come
 * out negative and take points back.
 */
export function eligibleSpend(
  inv: CachedInvoice,
  items: CachedItem[],
  settings: RewardsSettings,
): number {
  const types = new Set(settings.eligibleRecTypes.map((t) => t.toUpperCase()));
  const excluded = new Set(settings.excludedICodes.map((c) => c.trim().toUpperCase()));
  let total = 0;
  let eligible = 0;
  for (const it of items) {
    const ext = Math.abs(Number(it.extended) || 0);
    total += ext;
    const recType = (it.recType || "").toUpperCase();
    const code = (it.iCode || "").trim().toUpperCase();
    if (types.has(recType) && !excluded.has(code)) eligible += ext;
  }
  if (total === 0) return 0;
  return round2((Number(inv.subTotal) || 0) * (eligible / total));
}

export function bathroomCount(items: CachedItem[], settings: RewardsSettings): number {
  if (settings.bathroomICodes.length === 0) return 0;
  const codes = new Set(settings.bathroomICodes.map((c) => c.trim().toUpperCase()));
  let n = 0;
  for (const it of items) {
    if (codes.has((it.iCode || "").trim().toUpperCase())) n += Math.max(0, Math.round(Number(it.quantity) || 0));
  }
  return n;
}

// ── Tiers ──────────────────────────────────────────────────────────────

export function sortTiers(tiers: TierDef[]): TierDef[] {
  return [...tiers].sort((a, b) => a.minAnnualSpend - b.minAnnualSpend || a.sortOrder - b.sortOrder);
}

/** Highest tier whose threshold the spend reaches (the lowest tier otherwise). */
export function tierForSpend(sorted: TierDef[], spend: number): TierDef {
  let best = sorted[0];
  for (const t of sorted) if (spend >= t.minAnnualSpend) best = t;
  return best;
}

export function higherTier(sorted: TierDef[], a: TierDef, b: TierDef | null): TierDef {
  if (!b) return a;
  return sorted.indexOf(b) > sorted.indexOf(a) ? b : a;
}

export function nextTier(sorted: TierDef[], t: TierDef): TierDef | null {
  const i = sorted.indexOf(t);
  return i >= 0 && i < sorted.length - 1 ? sorted[i + 1] : null;
}

/**
 * Whether last year's spend can carry a tier into this year. Live years carry
 * only from live years, so 2026 preview spend never seeds a 2027 tier.
 */
export function carryAllowed(prevYear: number, settings: RewardsSettings): boolean {
  const liveStart = yearOf(settings.programStartDate);
  if (prevYear >= liveStart) return true;
  const previewStart = settings.previewStartDate ? yearOf(settings.previewStartDate) : null;
  return previewStart !== null && prevYear >= previewStart && prevYear + 1 < liveStart;
}

/**
 * The tier whose earn rate applies to one invoice.
 *
 * statusTier is the member's tier before this invoice (this year's spend so
 * far, or last year's carried tier, whichever is higher). spendBefore and
 * spendAfter are this calendar year's eligible spend before and after it.
 * Matters only for the invoice that crosses a threshold.
 */
export function earningTier(
  sorted: TierDef[],
  statusTier: TierDef,
  spendBefore: number,
  spendAfter: number,
): TierDef {
  // JD, Oct 16 2026: the crossing invoice earns at the old rate. The new
  // tier's rate starts with the next invoice.
  void sorted;
  void spendBefore;
  void spendAfter;
  return statusTier;
}

// ── Points for one member ───────────────────────────────────────────────

/** V300607A -> V300607 (RW reversal/adjustment invoices add a trailing letter). */
export function baseInvoiceNumber(num: string): string | null {
  const m = /^(.*\d)[A-Z]$/i.exec((num || "").trim());
  return m ? m[1] : null;
}

/** Round half away from zero so a reversal cancels its base to the point. */
export function roundPoints(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Walk one member's invoices in date order and decide each one's points.
 * itemsByInvoice is keyed by rwInvoiceId.
 */
export function computeMemberEarnings(
  invoices: CachedInvoice[],
  itemsByInvoice: Map<string, CachedItem[]>,
  tiers: TierDef[],
  settings: RewardsSettings,
): MemberEarnings {
  const sorted = sortTiers(tiers);
  const inScope = invoices
    .filter((inv) => isInScope(inv, settings))
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));

  const spendByYear = new Map<number, number>();
  const rateByInvoice = new Map<string, { tier: TierDef; ppd: number; weekend: boolean }>();
  const rows: EarnRow[] = [];
  const transitions: TierTransition[] = [];
  let lastStatusKey: string | null = null;
  let lastPreview: boolean | null = null;

  for (const inv of inScope) {
    const items = itemsByInvoice.get(inv.rwInvoiceId) ?? [];
    const year = yearOf(inv.invoiceDate);
    const isPreview = inv.invoiceDate < settings.programStartDate;
    // A new track (preview -> live) starts with no status.
    if (lastPreview !== null && lastPreview !== isPreview) lastStatusKey = null;
    lastPreview = isPreview;

    const spend = eligibleSpend(inv, items, settings);
    const before = spendByYear.get(year) ?? 0;
    const after = round2(before + spend);
    const prevSpend = spendByYear.get(year - 1) ?? 0;
    const carried = carryAllowed(year - 1, settings) ? tierForSpend(sorted, prevSpend) : null;
    const statusBefore = higherTier(sorted, tierForSpend(sorted, before), carried);

    // Reversals reverse at their base invoice's rate.
    const base = baseInvoiceNumber(inv.invoiceNumber);
    const baseRate = spend < 0 && base ? rateByInvoice.get(base) : undefined;
    let tier: TierDef;
    let ppd: number;
    let weekend = false;
    if (baseRate) {
      ({ tier, ppd, weekend } = baseRate);
    } else {
      tier = earningTier(sorted, statusBefore, before, after);
      weekend =
        settings.weekendBonusEnabled &&
        tier.weekendPointsPerDollar !== null &&
        coversWeekend(inv.billingStartDate, inv.billingEndDate);
      ppd = weekend ? (tier.weekendPointsPerDollar as number) : tier.pointsPerDollar;
    }
    rateByInvoice.set(inv.invoiceNumber, { tier, ppd, weekend });

    const trailers = bathroomCount(items, settings);
    const bonus = trailers > 0 && tier.bathroomBonusPoints ? Math.sign(spend || 1) * trailers * tier.bathroomBonusPoints : 0;
    const points = roundPoints(spend * ppd) + bonus;

    spendByYear.set(year, after);
    const statusAfter = higherTier(sorted, tierForSpend(sorted, after), carried);
    if (statusAfter.key !== lastStatusKey) {
      transitions.push({ fromTierKey: lastStatusKey, toTierKey: statusAfter.key, effectiveOn: inv.invoiceDate, isPreview });
      lastStatusKey = statusAfter.key;
    }

    if (spend === 0 && bonus === 0) continue;
    rows.push({
      sourceKey: `inv:${inv.rwInvoiceId}`,
      rwInvoiceId: inv.rwInvoiceId,
      rwCustomerId: inv.customerId,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      invoiceStatus: inv.status,
      eligibleSpend: spend,
      points,
      bonusPoints: bonus,
      tierKey: tier.key,
      pointsPerDollar: ppd,
      weekendApplied: weekend,
      isPreview,
      isAvailable: !isPreview && settings.paidStatuses.includes((inv.status || "").toUpperCase()),
      earnedOn: inv.invoiceDate,
      expiresOn: addMonths(inv.invoiceDate, settings.pointsExpireMonths),
    });
  }

  return { rows, spendByYear, transitions };
}

// ── Status as of a date ──────────────────────────────────────────────────

export interface TierStatus {
  tier: TierDef;
  qualifyingYear: number;
  qualifyingSpend: number;
  /** Dec 31 of the year after the year the tier was earned. */
  expiresOn: string;
  /** The tier above the current one. */
  next: TierDef | null;
  spendToNext: number | null;
  /** For a tier carried from last year: spend still needed this year to keep it. */
  spendToKeep: number;
}

/** The member's tier on a date: this year's spend, or last year's carried tier. */
export function tierStatus(
  spendByYear: Map<number, number>,
  tiers: TierDef[],
  settings: RewardsSettings,
  asOf: string,
): TierStatus {
  const sorted = sortTiers(tiers);
  const year = yearOf(asOf);
  const spend = spendByYear.get(year) ?? 0;
  const thisYear = tierForSpend(sorted, spend);
  const carried = carryAllowed(year - 1, settings) ? tierForSpend(sorted, spendByYear.get(year - 1) ?? 0) : null;
  const tier = higherTier(sorted, thisYear, carried);
  const earnedYear = tier === thisYear ? year : year - 1;
  const next = nextTier(sorted, tier);
  return {
    tier,
    qualifyingYear: year,
    qualifyingSpend: round2(spend),
    expiresOn: `${earnedYear + 1}-12-31`,
    next,
    spendToNext: next ? round2(Math.max(0, next.minAnnualSpend - spend)) : null,
    spendToKeep: earnedYear < year ? round2(Math.max(0, tier.minAnnualSpend - spend)) : 0,
  };
}

// ── Balance with expiry ───────────────────────────────────────────────────

export interface LedgerEntry {
  points: number;
  earnedOn: string;
  expiresOn: string | null;
  isAvailable: boolean;
  isPreview: boolean;
}

export interface Balance {
  available: number;
  pending: number;
  expired: number;
  expiringSoon: number;
  lifetimeEarned: number;
}

/**
 * Spendable balance on a date. Positive available entries are lots that
 * expire on their own date; negative entries (redemptions, reversals,
 * deductions) use up the oldest live lots first. Preview entries never count.
 */
export function computeBalance(entries: LedgerEntry[], asOf: string, soonDays = 60): Balance {
  const live = entries.filter((e) => !e.isPreview);
  const pending = live.filter((e) => !e.isAvailable && e.points > 0).reduce((s, e) => s + e.points, 0);
  const { lots, expired, deficit } = spendLots(live, asOf);
  const soon = addDays(asOf, soonDays);
  let available = 0;
  let expiringSoon = 0;
  for (const lot of lots) {
    available += lot.left;
    if (lot.left > 0 && lot.expiresOn && lot.expiresOn <= soon) expiringSoon += lot.left;
  }
  return {
    available: available - deficit,
    pending,
    expired,
    expiringSoon,
    lifetimeEarned: live.filter((e) => e.points > 0).reduce((s, e) => s + e.points, 0),
  };
}

export interface PointLot {
  earnedOn: string;
  expiresOn: string | null;
  points: number;
  /** Points of this lot not yet spent or expired as of the date asked. */
  left: number;
}

/**
 * The spendable lots still holding points on a date, oldest first, after
 * redemptions and expiry. Used for the "expiring soon" list.
 */
export function openLots(entries: LedgerEntry[], asOf: string): PointLot[] {
  return spendLots(entries.filter((e) => !e.isPreview), asOf).lots.filter((l) => l.left > 0);
}

function spendLots(live: LedgerEntry[], asOf: string): { lots: PointLot[]; expired: number; deficit: number } {
  const lots = live
    .filter((e) => e.isAvailable && e.points > 0)
    .map((e) => ({ ...e, left: e.points }))
    .sort((a, b) => a.earnedOn.localeCompare(b.earnedOn));
  const debits = live
    .filter((e) => e.isAvailable && e.points < 0)
    .sort((a, b) => a.earnedOn.localeCompare(b.earnedOn));

  let expired = 0;
  let deficit = 0;
  const expireThrough = (date: string) => {
    for (const lot of lots) {
      if (lot.left > 0 && lot.expiresOn && lot.expiresOn <= date && lot.earnedOn <= date) {
        expired += lot.left;
        lot.left = 0;
      }
    }
  };
  const consume = (amount: number, date: string) => {
    let need = amount;
    for (const lot of lots) {
      if (need <= 0) break;
      if (lot.left <= 0 || lot.earnedOn > date) continue;
      const take = Math.min(lot.left, need);
      lot.left -= take;
      need -= take;
    }
    deficit += need;
  };

  for (const d of debits) {
    if (d.earnedOn > asOf) continue;
    expireThrough(d.earnedOn);
    consume(-d.points, d.earnedOn);
  }
  // A deficit (spent before the points that cover it landed) eats later lots.
  if (deficit > 0) {
    const owed = deficit;
    deficit = 0;
    consume(owed, asOf);
  }
  expireThrough(asOf);

  return {
    lots: lots
      .filter((l) => l.earnedOn <= asOf)
      .map((l) => ({ earnedOn: l.earnedOn, expiresOn: l.expiresOn, points: l.points, left: l.left })),
    expired,
    deficit,
  };
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);
}
