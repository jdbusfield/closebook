/**
 * Which function and location a budget amount belongs to (docs/budget-dashboard-plan.md).
 * First match wins: the item's own tags, the person's (payroll), a rule on the source row,
 * a rule on the GL account (then its parent), else Unassigned. Pure: the model loads the
 * rules and people and calls this once per build.
 */
import { FUNCTIONS, normalizeFunctionSplits, readSplits, type TagSplit } from "./tagging";

export type TagOrigin = "item" | "person" | "source" | "account" | "none";

export interface TagRule {
  reportingEntityId: string | null;
  masterAccountId: string | null;
  sourceTable: string | null;
  sourceId: string | null;
  functionAllocations: TagSplit[];
  locationAllocations: TagSplit[];
  qboClassId: string | null;
}

export interface TaggableBuild {
  master_account_id: string;
  build_type: string;
  source_table: string | null;
  source_id: string | null;
  function_allocations?: unknown;
  location_allocations?: unknown;
}

export interface PersonTags {
  functionAllocations: TagSplit[];
  locationAllocations: TagSplit[];
}


export interface ResolvedTags {
  functions: TagSplit[];
  locations: TagSplit[];
  functionOrigin: TagOrigin;
  locationOrigin: TagOrigin;
  /** Scope of the rule that supplied the tags (function first), when one did */
  ruleScope: "group" | "organization" | null;
}

/** Rules indexed once per model read, group-specific rules ahead of organization-wide ones. */
export function indexRules(rules: TagRule[], reportingEntityId: string | null) {
  const applies = (r: TagRule) => r.reportingEntityId === null || r.reportingEntityId === reportingEntityId;
  const rank = (r: TagRule) => (r.reportingEntityId ? 0 : 1);
  const sorted = rules.filter(applies).sort((a, b) => rank(a) - rank(b));
  const bySource = new Map<string, TagRule[]>();
  const byAccount = new Map<string, TagRule[]>();
  for (const r of sorted) {
    if (r.sourceTable && r.sourceId) {
      const k = `${r.sourceTable}|${r.sourceId}`;
      bySource.set(k, [...(bySource.get(k) ?? []), r]);
    } else if (r.masterAccountId) {
      byAccount.set(r.masterAccountId, [...(byAccount.get(r.masterAccountId) ?? []), r]);
    }
  }
  return { bySource, byAccount };
}

export type RuleIndex = ReturnType<typeof indexRules>;

/**
 * Resolves function and location separately: an item can carry its own function and still
 * take its location from the account default.
 */
export function resolveTags(b: TaggableBuild, ctx: { index: RuleIndex; people: Map<string, PersonTags>; parentOf: (id: string) => string | null }): ResolvedTags {
  const fnOwn = normalizeFunctionSplits(readSplits(b.function_allocations));
  const locOwn = readSplits(b.location_allocations);
  const person = b.source_table === "budget_headcount" && b.source_id ? ctx.people.get(b.source_id) : undefined;
  const sourceRules = b.source_table && b.source_id ? ctx.index.bySource.get(`${b.source_table}|${b.source_id}`) ?? [] : [];
  const accountRules: TagRule[] = [];
  for (let id: string | null = b.master_account_id, guard = 0; id && guard < 5; id = ctx.parentOf(id), guard++) {
    accountRules.push(...(ctx.index.byAccount.get(id) ?? []));
  }
  const pick = (own: TagSplit[], fromPerson: TagSplit[] | undefined, field: "functionAllocations" | "locationAllocations"): [TagSplit[], TagOrigin, TagRule | null] => {
    if (own.length) return [own, "item", null];
    if (fromPerson?.length) return [fromPerson, "person", null];
    const s = sourceRules.find((r) => r[field].length);
    if (s) return [s[field], "source", s];
    const a = accountRules.find((r) => r[field].length);
    if (a) return [a[field], "account", a];
    return [[], "none", null];
  };
  const [functions, functionOrigin, fnRule] = pick(fnOwn, person ? normalizeFunctionSplits(person.functionAllocations) : undefined, "functionAllocations");
  const [locations, locationOrigin, locRule] = pick(locOwn, person?.locationAllocations, "locationAllocations");
  const rule = fnRule ?? locRule;
  return { functions: normalizeFunctionSplits(functions), locations, functionOrigin, locationOrigin, ruleScope: rule ? (rule.reportingEntityId ? "group" : "organization") : null };
}

export const UNASSIGNED = "Unassigned";

/** Months split by tag shares; an empty split goes wholly to Unassigned. Shares are scaled to 100%. */
export function splitMonths(months: number[], splits: TagSplit[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const total = splits.reduce((t, s) => t + s.pct, 0);
  if (!splits.length || total <= 0) {
    out.set(UNASSIGNED, months.slice());
    return out;
  }
  for (const s of splits) {
    const f = s.pct / total;
    const prev = out.get(s.key) ?? new Array(12).fill(0);
    out.set(s.key, prev.map((v, i) => v + months[i] * f));
  }
  return out;
}

/** Adds one split result into a running tally. */
export function addSplit(into: Map<string, number[]>, add: Map<string, number[]>) {
  for (const [k, m] of add) {
    const prev = into.get(k) ?? new Array(12).fill(0);
    into.set(k, prev.map((v, i) => v + m[i]));
  }
}

/** Shares of a tally as a split list (largest first), for showing an item's mix. */
export function tallyToSplits(tally: Map<string, number[]>): TagSplit[] {
  const totals = [...tally].map(([key, m]) => [key, m.reduce((t, v) => t + v, 0)] as const);
  const sum = totals.reduce((t, [, v]) => t + Math.abs(v), 0);
  if (sum < 0.005) return [];
  return totals
    .filter(([, v]) => Math.abs(v) >= 0.005)
    .map(([key, v]) => ({ key, pct: Math.round((Math.abs(v) / sum) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct);
}

/**
 * A split sent by the page, checked: keys present, shares positive and adding to 100.
 * Functions must be one of the four. Returns null for "inherit" (null, undefined or []).
 */
export function cleanSplitsInput(raw: unknown, kind: "function" | "location"): { ok: true; value: TagSplit[] | null } | { ok: false; error: string } {
  if (raw == null || (Array.isArray(raw) && raw.length === 0)) return { ok: true, value: null };
  if (!Array.isArray(raw)) return { ok: false, error: `${kind} must be a list of { key, pct }` };
  const splits = kind === "function" ? normalizeFunctionSplits(readSplits(raw)) : readSplits(raw);
  if (splits.length !== raw.length && kind === "location") return { ok: false, error: "Every location needs a name and a share above 0" };
  if (kind === "function" && splits.some((s) => !(FUNCTIONS as readonly string[]).includes(s.key))) {
    return { ok: false, error: `Function must be one of ${FUNCTIONS.join(", ")}` };
  }
  const sum = splits.reduce((t, s) => t + s.pct, 0);
  if (Math.abs(sum - 100) > 0.5) return { ok: false, error: `The ${kind} shares add to ${sum}%, not 100%` };
  return { ok: true, value: splits };
}

/** A rule row from the database. */
export function readRule(row: {
  reporting_entity_id: string | null;
  master_account_id: string | null;
  source_table: string | null;
  source_id: string | null;
  function_allocations: unknown;
  location_allocations: unknown;
  qbo_class_id: string | null;
}): TagRule {
  return {
    reportingEntityId: row.reporting_entity_id,
    masterAccountId: row.master_account_id,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    functionAllocations: normalizeFunctionSplits(readSplits(row.function_allocations)),
    locationAllocations: readSplits(row.location_allocations),
    qboClassId: row.qbo_class_id,
  };
}
