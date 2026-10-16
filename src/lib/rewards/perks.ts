/**
 * Perk allowance math, shared by the API and the counter view. A tier perk
 * with an allowance (e.g. complimentary delivery, 1 a month) is checked
 * against the uses logged in the current period.
 */

export type AllowancePeriod = "order" | "week" | "month" | "quarter" | "year";

/** First day of the period containing asOf (weeks start Monday). */
export function periodStart(asOf: string, period: AllowancePeriod): string | null {
  const d = new Date(`${asOf}T00:00:00Z`);
  switch (period) {
    case "order":
      return null; // per order: no running count
    case "week": {
      const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
      d.setUTCDate(d.getUTCDate() - dow);
      break;
    }
    case "month":
      d.setUTCDate(1);
      break;
    case "quarter":
      d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3, 1);
      break;
    case "year":
      d.setUTCMonth(0, 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

export interface PerkUse {
  usedOn: string;
  quantity: number;
}

export interface AllowanceState {
  allowance: number;
  used: number;
  remaining: number;
  periodStart: string | null;
}

export function allowanceState(
  allowance: number | null,
  period: AllowancePeriod | null,
  uses: PerkUse[],
  asOf: string,
): AllowanceState | null {
  if (allowance === null || !period) return null;
  const start = periodStart(asOf, period);
  if (start === null) return { allowance, used: 0, remaining: allowance, periodStart: null };
  const used = uses
    .filter((u) => u.usedOn >= start && u.usedOn <= asOf)
    .reduce((s, u) => s + u.quantity, 0);
  return { allowance, used, remaining: Math.max(0, allowance - used), periodStart: start };
}

/** Points credited back after a redemption when the tier's refund perk is on. */
export function redemptionRefund(points: number, refundPercent: number | null): number {
  if (!refundPercent || refundPercent <= 0) return 0;
  return Math.floor((points * refundPercent) / 100);
}
