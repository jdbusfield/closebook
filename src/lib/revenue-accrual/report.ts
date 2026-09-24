import type { AccrualItem, AccrualSettings, BookedJournal, MonthRef, Quote, RunResult } from "./types";
import type { QboPull } from "./qbo";
import { includedItems, runAccrual } from "./engine";
import { buildJournals, type Journal } from "./journals";
import { jePrefix, monthShort, shiftMonth } from "./dates";

const cents = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: AccrualItem[]) => cents(xs.reduce((s, i) => s + i.amount, 0));

export interface BookedForMonth {
  accrual: BookedJournal[];
  deferral: BookedJournal[];
  accrualTotal: number;
  deferralTotal: number;
}

export interface AccrualReport {
  result: RunResult;
  decisions: Record<string, boolean>;
  totals: {
    accrual: number;
    deferral: number;
    byTier: Record<string, { accrual: number; deferral: number; count: number; included: number }>;
  };
  journals: Journal[];
  booked: BookedForMonth;
  prior: {
    period: MonthRef;
    recomputedAccrual: number;
    bookedAccrual: number;
    shortfall: number;
    enteredBeforeBooking: number | null;
    bookedAt: string | null;
  };
}

/** Accrual / deferral JEs already in QuickBooks for the month ("26.08 Accr Rev", "26.08 Aug Def Rev"). */
export function bookedFor(p: MonthRef, journals: BookedJournal[]): BookedForMonth {
  const pre = jePrefix(p);
  const mine = journals.filter((j) => j.num.replace(/\s+/g, " ").trim().startsWith(pre));
  const accrual = mine.filter((j) => /accr\s*rev(?!r)/i.test(j.num) && !/revr\b/i.test(j.num));
  const deferral = mine.filter(
    (j) => new RegExp(`${monthShort(p)}\\w*\\s*def\\s*rev(?!r)`, "i").test(j.num) && !/revr\b/i.test(j.num),
  );
  return {
    accrual,
    deferral,
    accrualTotal: cents(accrual.reduce((s, j) => s + j.revenueCredit, 0)),
    deferralTotal: cents(-deferral.reduce((s, j) => s + j.revenueCredit, 0)),
  };
}

export function buildReport(
  period: MonthRef,
  quotes: Quote[],
  pull: QboPull,
  settings: AccrualSettings,
  decisions: Record<string, boolean>,
): AccrualReport {
  const result = runAccrual({ period, quotes, docs: pull.docs, settings });
  const included = includedItems(result, decisions);
  const includedIds = new Set(included.map((i) => i.id));
  const byTier: AccrualReport["totals"]["byTier"] = {};
  for (const it of result.items) {
    const t = (byTier[it.tier] ??= { accrual: 0, deferral: 0, count: 0, included: 0 });
    t.count++;
    if (includedIds.has(it.id)) {
      t.included++;
      t[it.kind] = cents(t[it.kind] + it.amount);
    }
  }

  // Prior month: what the same method says now vs what was booked
  const pp = shiftMonth(period, -1);
  const priorRes = runAccrual({ period: pp, quotes, docs: pull.docs, settings });
  const priorIncluded = includedItems(priorRes, {}).filter((i) => i.kind === "accrual" && i.tier !== "review");
  const priorBooked = bookedFor(pp, pull.journals);
  const bookedAt = priorBooked.accrual.map((j) => j.created).filter(Boolean).sort()[0] ?? null;
  const enteredBefore = bookedAt
    ? sum(priorIncluded.filter((i) => i.tier === "confirmed" && i.docCreated && i.docCreated <= bookedAt))
    : null;
  const recomputed = sum(priorIncluded);

  return {
    result,
    decisions,
    totals: {
      accrual: sum(included.filter((i) => i.kind === "accrual")),
      deferral: sum(included.filter((i) => i.kind === "deferral")),
      byTier,
    },
    journals: buildJournals(period, included, settings),
    booked: bookedFor(period, pull.journals),
    prior: {
      period: pp,
      recomputedAccrual: recomputed,
      bookedAccrual: priorBooked.accrualTotal,
      shortfall: cents(recomputed - priorBooked.accrualTotal),
      enteredBeforeBooking: enteredBefore,
      bookedAt,
    },
  };
}
