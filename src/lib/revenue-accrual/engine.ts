import type {
  AccountRef,
  AccrualItem,
  AccrualSettings,
  Allocation,
  Doc,
  DocLine,
  MonthRef,
  Quote,
  RunResult,
} from "./types";
import { addDays, daysBetween, memoDates, monthEnd, monthStart, shareThrough, shiftMonth, toUtc } from "./dates";
import { buildKeyMapper, customerLeaf, customerTop, normKey } from "./names";

const cents = (n: number) => Math.round(n * 100) / 100;
const MATCH_WINDOW_DAYS = 150;
const NAMELESS_MATCH_DAYS = 14;
const NEXT_MONTH_REVIEW_DAYS = 10;

export interface RunInput {
  period: MonthRef;
  quotes: Quote[];
  docs: Doc[];
  settings: AccrualSettings;
}

interface DocInfo {
  doc: Doc;
  revenue: number;
  lines: DocLine[];
  leafKey: string;
  topKey: string;
  nameless: boolean;
  quote: Quote | null;
}

export function isExcluded(line: DocLine, settings: AccrualSettings): boolean {
  const n = line.accountNumber ?? "";
  return settings.excludeAccountPrefixes.some((p) => p && n.startsWith(p));
}

/** Spread `amount` over weights, rounding to cents; the rounding difference goes on the largest share. */
export function allocate(amount: number, weights: Allocation[]): Allocation[] {
  const total = weights.reduce((s, w) => s + w.amount, 0);
  const target = cents(amount);
  if (!weights.length || Math.abs(total) < 0.005) return [];
  const out = weights.map((w) => ({ ...w, amount: cents((target * w.amount) / total) }));
  const diff = cents(target - out.reduce((s, w) => s + w.amount, 0));
  if (diff !== 0) {
    let big = 0;
    out.forEach((w, i) => {
      if (Math.abs(w.amount) > Math.abs(out[big].amount)) big = i;
    });
    out[big].amount = cents(out[big].amount + diff);
  }
  return out.filter((w) => w.amount !== 0);
}

function lineWeights(lines: DocLine[]): Allocation[] {
  const m = new Map<string, Allocation>();
  for (const l of lines) {
    const k = `${l.accountNumber ?? ""}|${l.accountName}|${l.className ?? ""}`;
    const cur = m.get(k);
    if (cur) cur.amount += l.amount;
    else m.set(k, { account: { number: l.accountNumber, name: l.accountName }, className: l.className, amount: l.amount });
  }
  // Weight by revenue lines; drop net-zero groups
  return [...m.values()].filter((a) => Math.abs(a.amount) >= 0.005);
}

function isApproved(q: Quote, s: AccrualSettings): boolean {
  return s.approvedStatuses.some((a) => a.toLowerCase() === q.status.toLowerCase());
}

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

export function runAccrual({ period, quotes, docs, settings }: RunInput): RunResult {
  const S = monthStart(period);
  const E = monthEnd(period);
  const prevStart = monthStart(shiftMonth(period, -1));
  const twoBackStart = monthStart(shiftMonth(period, -2));
  const windowStart = monthStart(shiftMonth(period, -6));
  const windowEnd = monthEnd(shiftMonth(period, 4));

  // ---- documents
  const infos: DocInfo[] = docs.map((doc) => {
    const lines = doc.lines.filter((l) => !isExcluded(l, settings));
    const revenue = cents(lines.reduce((s, l) => s + l.amount, 0));
    const nameless = !doc.customer || doc.customer === "(none)";
    return {
      doc,
      revenue,
      lines,
      leafKey: nameless ? "" : normKey(customerLeaf(doc.customer)),
      topKey: nameless ? "" : normKey(customerTop(doc.customer)),
      nameless,
      quote: null,
    };
  });
  const customerKeys = new Set<string>();
  for (const i of infos) {
    if (i.leafKey) customerKeys.add(i.leafKey);
    if (i.topKey) customerKeys.add(i.topKey);
  }
  const mapKey = buildKeyMapper(customerKeys, settings.aliases);

  // ---- quotes in play
  const inWindow = quotes.filter(
    (q) => q.amount && toUtc(q.end) >= toUtc(windowStart) && toUtc(q.start) <= toUtc(windowEnd),
  );
  const qKey = new Map<string, string | null>();
  for (const q of inWindow) qKey.set(q.id, mapKey(q.project));
  const byCents = new Map<number, Quote[]>();
  for (const q of inWindow) {
    const c = Math.round(q.amount * 100);
    if (!byCents.has(c)) byCents.set(c, []);
    byCents.get(c)!.push(q);
  }
  const used = new Set<string>();

  const matchPass = (namelessPass: boolean) => {
    const order = infos
      .filter((i) => !i.quote && i.revenue > 0 && i.nameless === namelessPass)
      .sort((a, b) => b.revenue - a.revenue);
    for (const i of order) {
      const cands = byCents.get(Math.round(i.revenue * 100)) ?? [];
      let best: { q: Quote; key: [number, number] } | null = null;
      for (const q of cands) {
        if (used.has(q.id)) continue;
        if (!namelessPass) {
          const k = qKey.get(q.id);
          if (!k || (k !== i.leafKey && k !== i.topKey)) continue;
        }
        const dist = Math.min(Math.abs(daysBetween(q.end, i.doc.date)), Math.abs(daysBetween(q.start, i.doc.date)));
        if (dist > (namelessPass ? NAMELESS_MATCH_DAYS : MATCH_WINDOW_DAYS)) continue;
        const key: [number, number] = [isApproved(q, settings) ? 0 : 1, dist];
        if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) best = { q, key };
      }
      if (best) {
        i.quote = best.q;
        used.add(best.q.id);
      }
    }
  };
  matchPass(false);
  matchPass(true);

  const items: AccrualItem[] = [];
  const consumed = new Map<string, number>(); // doc key -> amount already placed in an item

  const docItem = (
    i: DocInfo,
    kind: "accrual" | "deferral",
    amount: number,
    source: string,
    reason: string,
    extra: Partial<AccrualItem>,
    weights: Allocation[],
    idSuffix = "",
  ) => {
    const amt = cents(amount);
    if (Math.abs(amt) < 0.01) return;
    items.push({
      id: `${kind}:${i.doc.key}${idSuffix}`,
      kind,
      tier: "confirmed",
      source,
      reason,
      amount: amt,
      defaultInclude: true,
      allocation: allocate(amt, weights),
      allocationSource: "Invoice lines",
      docNum: i.doc.num,
      docType: i.doc.type,
      docDate: i.doc.date,
      docCreated: i.doc.created,
      docAmount: i.revenue,
      customer: i.doc.customer,
      ...extra,
    });
    consumed.set(i.doc.key, cents((consumed.get(i.doc.key) ?? 0) + Math.abs(amt)));
  };

  // ---- (a) invoices tied to a quote, (b) invoices carrying a Rental Period field
  for (const i of infos) {
    const span = i.quote
      ? { start: i.quote.start, end: i.quote.end }
      : i.doc.rentalPeriod ?? null;
    if (!span || i.revenue === 0) continue;
    const source = i.quote ? "Invoice ties to a quote" : "Rental Period on invoice";
    const extra: Partial<AccrualItem> = i.quote
      ? { quoteId: i.quote.id, project: i.quote.project, quoteStart: i.quote.start, quoteEnd: i.quote.end, quoteAmount: i.quote.amount }
      : { quoteStart: span.start, quoteEnd: span.end };
    const earned = shareThrough(span.start, span.end, E);
    const weights = lineWeights(i.lines);
    if (toUtc(i.doc.date) > toUtc(E)) {
      if (earned > 0 && toUtc(span.start) >= toUtc(windowStart)) {
        docItem(i, "accrual", i.revenue * earned, source,
          `Invoiced ${i.doc.date}; ${pct(earned)} of the rental (${span.start} to ${span.end}) was on or before ${E}.`, extra, weights);
      }
    } else if (earned < 1) {
      docItem(i, "deferral", i.revenue * (1 - earned), source,
        `Invoiced ${i.doc.date}; ${pct(1 - earned)} of the rental (${span.start} to ${span.end}) is after ${E}.`, extra, weights);
    }
    consumed.set(i.doc.key, Math.abs(i.revenue));
  }

  // ---- (c) service dates in line memos, on documents not tied to a quote
  for (const i of infos) {
    if (i.quote || i.doc.rentalPeriod) continue;
    const after = toUtc(i.doc.date) > toUtc(E);
    const inMonth = !after && toUtc(i.doc.date) >= toUtc(S);
    if (!after && !inMonth) continue;
    i.lines.forEach((l, idx) => {
      const ds = memoDates(l.description, i.doc.date);
      if (!ds.length || Math.abs(l.amount) < 0.01) return;
      const last = ds.reduce((a, b) => (toUtc(a) > toUtc(b) ? a : b));
      const first = ds.reduce((a, b) => (toUtc(a) < toUtc(b) ? a : b));
      const w = [{ account: { number: l.accountNumber, name: l.accountName }, className: l.className, amount: l.amount }];
      if (after && toUtc(last) <= toUtc(E) && toUtc(last) >= toUtc(prevStart)) {
        docItem(i, "accrual", l.amount, "Service date in invoice memo",
          `Invoiced ${i.doc.date}; the line says the service was ${last}.`, { memo: l.description }, w, `:L${idx}`);
      } else if (inMonth && toUtc(first) > toUtc(E)) {
        docItem(i, "deferral", l.amount, "Service date in invoice memo",
          `Invoiced ${i.doc.date}; the line says the service is ${first}.`, { memo: l.description }, w, `:L${idx}`);
      }
    });
  }

  // ---- job-level lookups for quote-only work
  const jobDocs = new Map<string, DocInfo[]>();
  for (const i of infos) {
    for (const k of new Set([i.leafKey, i.topKey])) {
      if (!k) continue;
      if (!jobDocs.has(k)) jobDocs.set(k, []);
      jobDocs.get(k)!.push(i);
    }
  }
  const jobMix = (key: string | null): Allocation[] | null => {
    if (!key) return null;
    const lines = (jobDocs.get(key) ?? []).flatMap((i) =>
      i.lines.filter((l) => l.amount > 0 && !(l.accountNumber ?? "").startsWith("48002")),
    );
    const w = lineWeights(lines).filter((a) => a.amount > 0);
    return w.length ? w : null;
  };
  const ruleMix = (q: Quote): { weights: Allocation[]; source: string } => {
    const hay = `${q.path ?? ""} ${q.project}`.toLowerCase();
    const rule = settings.typeRules.find((r) => r.match && hay.includes(r.match.toLowerCase()));
    if (rule) return { weights: [{ account: rule.account, className: rule.className, amount: 1 }], source: `Quote type "${rule.match}"` };
    return {
      weights: [{ account: settings.defaultAccount, className: settings.defaultClass, amount: 1 }],
      source: "Default account and class",
    };
  };

  // ---- (d) quotes with no exact invoice: apply the job's other invoices to its open quotes, oldest first
  const monthJobs = new Set<string>();
  for (const q of inWindow) {
    if (!isApproved(q, settings)) continue;
    if (toUtc(q.start) <= toUtc(E) && toUtc(q.end) >= toUtc(S)) {
      const k = qKey.get(q.id);
      if (k) monthJobs.add(k);
    }
  }
  // Pool of uncommitted invoice dollars per job (loss & damage never covers quoted work)
  const pool = new Map<string, { i: DocInfo; left: number; lines: DocLine[] }>();
  const poolFor = (i: DocInfo) => {
    let p = pool.get(i.doc.key);
    if (!p) {
      const memoUsed = consumed.get(i.doc.key) ?? 0;
      const lines = i.lines.filter(
        (l) => !(l.accountNumber ?? "").startsWith("48002") && !(memoUsed && memoDates(l.description, i.doc.date).length),
      );
      p = { i, left: cents(lines.reduce((s, l) => s + l.amount, 0)), lines };
      pool.set(i.doc.key, p);
    }
    return p;
  };
  const openQuotes = inWindow
    .filter((q) => !used.has(q.id) && isApproved(q, settings) && q.amount > 0)
    .sort((a, b) => toUtc(a.start) - toUtc(b.start) || toUtc(a.end) - toUtc(b.end));
  const fmt$ = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  for (const q of openQuotes) {
    const key = qKey.get(q.id) ?? null;
    const earned = shareThrough(q.start, q.end, E);
    const qExtra: Partial<AccrualItem> = {
      quoteId: q.id, project: q.project, quoteStart: q.start, quoteEnd: q.end, quoteAmount: q.amount,
    };
    let need = cents(q.amount);
    if (key) {
      const cands = (jobDocs.get(key) ?? [])
        .filter((i) => !i.quote && !i.doc.rentalPeriod && i.revenue > 0 && toUtc(i.doc.date) >= toUtc(addDays(q.start, -30)))
        .sort((a, b) => toUtc(a.doc.date) - toUtc(b.doc.date));
      for (const i of cands) {
        if (need < 0.01) break;
        const p = poolFor(i);
        if (p.left < 0.01) continue;
        const take = cents(Math.min(p.left, need));
        p.left = cents(p.left - take);
        need = cents(need - take);
        const after = toUtc(i.doc.date) > toUtc(E);
        const amt = after ? take * earned : take * (1 - earned);
        if (cents(amt) < 0.01) continue;
        const kind = after ? "accrual" : "deferral";
        items.push({
          id: `${kind}:job:${q.id}:${i.doc.key}`,
          kind,
          tier: "job",
          source: "Invoice on the same job",
          reason: after
            ? `Invoice ${i.doc.num} (${i.doc.date}) on this job does not tie to a single quote; ${fmt$(take)} of it was applied to this quote, and ${pct(earned)} of the rental (${q.start} to ${q.end}) was on or before ${E}.`
            : `Invoice ${i.doc.num} (${i.doc.date}) on this job was applied to this quote; ${pct(1 - earned)} of the rental (${q.start} to ${q.end}) is after ${E}.`,
          amount: cents(amt),
          defaultInclude: true,
          allocation: allocate(amt, lineWeights(p.lines.length ? p.lines : i.lines)),
          allocationSource: "Invoice lines",
          docNum: i.doc.num,
          docType: i.doc.type,
          docDate: i.doc.date,
          docCreated: i.doc.created,
          docAmount: i.revenue,
          customer: i.doc.customer,
          ...qExtra,
        });
      }
    }
    // Whatever no invoice covers is accrued from the quote's rental dates
    if (need >= 0.01 && earned > 0 && toUtc(q.end) >= toUtc(prevStart)) {
      const amount = cents(need * earned);
      if (amount < 0.01) continue;
      const long = toUtc(q.start) < toUtc(twoBackStart);
      const endedBefore = toUtc(q.end) < toUtc(S);
      const mix = jobMix(key);
      const rule = mix ? null : ruleMix(q);
      items.push({
        id: `accrual:quote:${q.id}`,
        kind: "accrual",
        tier: long || endedBefore ? "review" : "quote",
        source: "Approved quote, not invoiced yet",
        reason: long
          ? `Rental started ${q.start}. Long rentals are often billed up front or monthly on invoices that do not tie to the quote; check before accruing ${fmt$(amount)}.`
          : endedBefore
            ? `Rental ended ${q.end}, before ${S.slice(0, 7)}, and still has no invoice. It may have been billed under another customer name; accrue it only if it is still unbilled.`
            : `No invoice found for ${fmt$(need)} of this quote. ${pct(earned)} of the rental (${q.start} to ${q.end}) was on or before ${E}.`,
        amount,
        defaultInclude: !long && !endedBefore,
        allocation: allocate(amount, mix ?? rule!.weights),
        allocationSource: mix ? "This job's invoice mix" : rule!.source,
        customer: key ? (jobDocs.get(key)?.[0]?.doc.customer ?? null) : null,
        ...qExtra,
      });
    }
  }

  // ---- (e) early next-month invoices left over after (d), on jobs that had work this month
  const reviewCut = addDays(E, NEXT_MONTH_REVIEW_DAYS);
  for (const i of infos) {
    if (i.quote || i.doc.rentalPeriod || i.revenue <= 0) continue;
    if (toUtc(i.doc.date) <= toUtc(E) || toUtc(i.doc.date) > toUtc(reviewCut)) continue;
    if (!(monthJobs.has(i.leafKey) || monthJobs.has(i.topKey))) continue;
    const p = poolFor(i);
    if (p.left < 0.01) continue;
    items.push({
      id: `accrual:review:${i.doc.key}`,
      kind: "accrual",
      tier: "review",
      source: "Early next-month invoice, no quote left to apply it to",
      reason: `Invoiced ${i.doc.date} on a job that had approved quotes in ${S.slice(0, 7)}; ${fmt$(p.left)} of it is more than the job's open quotes. Include it if the work was done by ${E}.`,
      amount: p.left,
      defaultInclude: false,
      allocation: allocate(p.left, lineWeights(p.lines.length ? p.lines : i.lines)),
      allocationSource: "Invoice lines",
      docNum: i.doc.num,
      docType: i.doc.type,
      docDate: i.doc.date,
      docCreated: i.doc.created,
      docAmount: i.revenue,
      customer: i.doc.customer,
    });
  }

  // ---- (f) this month's invoices on jobs whose quotes all start later
  const jobQuotes = new Map<string, Quote[]>();
  for (const q of inWindow) {
    const k = qKey.get(q.id);
    if (!k || !isApproved(q, settings)) continue;
    if (!jobQuotes.has(k)) jobQuotes.set(k, []);
    jobQuotes.get(k)!.push(q);
  }
  for (const i of infos) {
    if (i.quote || i.doc.rentalPeriod || i.revenue <= 0) continue;
    if (toUtc(i.doc.date) < toUtc(S) || toUtc(i.doc.date) > toUtc(E)) continue;
    if (consumed.get(i.doc.key)) continue;
    const qs = [...(jobQuotes.get(i.leafKey) ?? []), ...(jobQuotes.get(i.topKey) ?? [])];
    if (!qs.length) continue;
    if (qs.some((q) => toUtc(q.start) <= toUtc(E) && toUtc(q.end) >= toUtc(addDays(S, -45)))) continue;
    const firstStart = qs.map((q) => q.start).sort()[0];
    if (toUtc(firstStart) <= toUtc(E)) continue;
    items.push({
      id: `deferral:review:${i.doc.key}`,
      kind: "deferral",
      tier: "review",
      source: "Invoiced before the job's rental starts",
      reason: `Invoiced ${i.doc.date}, but this job's approved quotes start ${firstStart}. Defer it if it is billing in advance.`,
      amount: i.revenue,
      defaultInclude: false,
      allocation: allocate(i.revenue, lineWeights(i.lines)),
      allocationSource: "Invoice lines",
      docNum: i.doc.num,
      docType: i.doc.type,
      docDate: i.doc.date,
      docCreated: i.doc.created,
      docAmount: i.revenue,
      customer: i.doc.customer,
    });
  }

  const matched = infos.filter((i) => i.quote);
  return {
    period,
    periodEnd: E,
    items,
    stats: {
      quotes: quotes.length,
      quotesInWindow: inWindow.length,
      docs: infos.length,
      docsMatched: matched.length,
      docsMatchedAmount: cents(matched.reduce((s, i) => s + i.revenue, 0)),
      docsAmount: cents(infos.reduce((s, i) => s + i.revenue, 0)),
    },
    unmatchedDocs: infos
      .filter((i) => !i.quote && i.revenue !== 0 && toUtc(i.doc.date) >= toUtc(prevStart))
      .map((i) => ({ num: i.doc.num, type: i.doc.type, date: i.doc.date, customer: i.doc.customer, amount: i.revenue })),
  };
}

/** Items after applying review decisions. */
export function includedItems(result: RunResult, decisions: Record<string, boolean>): AccrualItem[] {
  return result.items.filter((it) => (it.id in decisions ? decisions[it.id] : it.defaultInclude));
}

export function accountLabel(a: AccountRef): string {
  return a.number ? `${a.number} ${a.name}` : a.name;
}
