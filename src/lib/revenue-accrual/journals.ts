import type { AccrualItem, AccrualSettings, MonthRef } from "./types";
import { accountLabel } from "./engine";
import { jePrefix, monthEnd, monthShort, monthStart, shiftMonth } from "./dates";

const cents = (n: number) => Math.round(n * 100) / 100;

/** One row in the HDR JE layout: ACCOUNT | DEBITS | CREDITS | DESCRIPTION | NAME | CLASS */
export interface JeRow {
  account: string;
  debit: number | null;
  credit: number | null;
  description: string;
  name: string;
  className: string;
}

export interface Journal {
  number: string;
  date: string;
  title: string;
  rows: JeRow[];
  total: number;
}

function groupRevenue(items: AccrualItem[]) {
  const m = new Map<string, { account: string; className: string; amount: number }>();
  for (const it of items) {
    for (const a of it.allocation) {
      const account = accountLabel(a.account);
      const className = a.className ?? "";
      const k = `${account}|${className}`;
      const cur = m.get(k);
      if (cur) cur.amount = cents(cur.amount + a.amount);
      else m.set(k, { account, className, amount: cents(a.amount) });
    }
  }
  return [...m.values()]
    .filter((g) => g.amount !== 0)
    .sort((a, b) => a.account.localeCompare(b.account) || a.className.localeCompare(b.className));
}

/**
 * revenueSide "credit": accrual (Cr revenue, Dr accrued asset).
 * revenueSide "debit": deferral (Dr revenue, Cr deferred liability).
 */
function buildJournal(
  number: string,
  date: string,
  title: string,
  items: AccrualItem[],
  revenueSide: "credit" | "debit",
  offsetAccount: string,
  flip: boolean,
): Journal {
  const groups = groupRevenue(items);
  const rows: JeRow[] = [];
  let net = 0;
  const side = flip ? (revenueSide === "credit" ? "debit" : "credit") : revenueSide;
  for (const g of groups) {
    // A negative revenue amount (credit memo, discount) lands on the other column
    const toCredit = (side === "credit") === g.amount > 0;
    const amt = Math.abs(g.amount);
    rows.push({
      account: g.account,
      debit: toCredit ? null : amt,
      credit: toCredit ? amt : null,
      description: number,
      name: "",
      className: g.className,
    });
    net = cents(net + (toCredit ? amt : -amt));
  }
  if (net !== 0) {
    // Offset balances the entry to the penny
    rows.push({
      account: offsetAccount,
      debit: net > 0 ? net : null,
      credit: net < 0 ? -net : null,
      description: number,
      name: "",
      className: "",
    });
  }
  const total = cents(rows.reduce((s, r) => s + (r.debit ?? 0), 0));
  return { number, date, title, rows, total };
}

export function buildJournals(period: MonthRef, included: AccrualItem[], settings: AccrualSettings): Journal[] {
  const p = jePrefix(period);
  const end = monthEnd(period);
  const nextFirst = monthStart(shiftMonth(period, 1));
  const accruals = included.filter((i) => i.kind === "accrual");
  const deferrals = included.filter((i) => i.kind === "deferral");
  const accrued = accountLabel(settings.accruedAccount);
  const deferred = accountLabel(settings.deferredAccount);
  const mon = monthShort(period);
  const out: Journal[] = [];
  if (accruals.length) {
    out.push(buildJournal(`${p} Accr Rev`, end, "Revenue accrual", accruals, "credit", accrued, false));
    out.push(buildJournal(`${p} Accr RevR`, nextFirst, "Reverse revenue accrual", accruals, "credit", accrued, true));
  }
  if (deferrals.length) {
    out.push(buildJournal(`${p} ${mon} Def Rev`, end, "Revenue deferral", deferrals, "debit", deferred, false));
    out.push(buildJournal(`${p} ${mon} Def RevR`, nextFirst, "Reverse revenue deferral", deferrals, "debit", deferred, true));
  }
  return out;
}
