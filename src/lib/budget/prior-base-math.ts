/** Pure math for "Build from last year" (no database), so it can be tested on its own. */

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Booked months as they were, the months not yet booked at the booked-month average */
export function actualsBase(prior: number[], bookedMonths: number): number[] {
  if (bookedMonths <= 0) return new Array(12).fill(0);
  const avg = prior.slice(0, bookedMonths).reduce((t, v) => t + v, 0) / bookedMonths;
  return prior.map((v, i) => round2(i < bookedMonths ? v : avg));
}

/** Every month moved by the same percent */
export function applyPct(months: number[], pct: number): number[] {
  return months.map((v) => round2(v * (1 + pct / 100)));
}
