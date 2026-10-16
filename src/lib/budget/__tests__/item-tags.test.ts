import { test } from "node:test";
import assert from "node:assert/strict";
import { indexRules, resolveTags, splitMonths, tallyToSplits, addSplit, UNASSIGNED, type TagRule } from "../item-tags";
import { normalizeFunctionSplits } from "../tagging";

const rule = (p: Partial<TagRule>): TagRule => ({
  reportingEntityId: null, masterAccountId: null, sourceTable: null, sourceId: null,
  functionAllocations: [], locationAllocations: [], qboClassId: null, ...p,
});
const parents: Record<string, string> = { m6110: "m6100" };
const parentOf = (id: string) => parents[id] ?? null;
const build = (p: Record<string, unknown>) => ({ master_account_id: "m5030", build_type: "manual", source_table: null, source_id: null, ...p });

test("an item's own tags win over every rule", () => {
  const index = indexRules([rule({ masterAccountId: "m5030", functionAllocations: [{ key: "Fleet", pct: 100 }] })], "re1");
  const r = resolveTags(build({ function_allocations: [{ key: "Sales", pct: 100 }] }), { index, people: new Map(), parentOf });
  assert.deepEqual(r.functions, [{ key: "Sales", pct: 100 }]);
  assert.equal(r.functionOrigin, "item");
});

test("function and location resolve separately", () => {
  const index = indexRules([rule({ masterAccountId: "m5030", functionAllocations: [{ key: "Fleet", pct: 100 }], locationAllocations: [{ key: "Saticoy", pct: 100 }] })], "re1");
  const r = resolveTags(build({ function_allocations: [{ key: "Sales", pct: 100 }] }), { index, people: new Map(), parentOf });
  assert.equal(r.functionOrigin, "item");
  assert.equal(r.locationOrigin, "account");
  assert.deepEqual(r.locations, [{ key: "Saticoy", pct: 100 }]);
});

test("payroll takes the person's tags, old function names mapped to the four", () => {
  const people = new Map([["h1", { functionAllocations: [{ key: "Executive", pct: 50 }, { key: "Administrative", pct: 50 }], locationAllocations: [{ key: "Saticoy", pct: 100 }] }]]);
  const r = resolveTags(build({ build_type: "headcount", source_table: "budget_headcount", source_id: "h1", master_account_id: "m6110" }), { index: indexRules([], "re1"), people, parentOf });
  assert.deepEqual(r.functions, [{ key: "Overhead", pct: 100 }]);
  assert.equal(r.functionOrigin, "person");
});

test("a source rule beats the account rule; a group rule beats an organization rule", () => {
  const index = indexRules([
    rule({ masterAccountId: "m6000", functionAllocations: [{ key: "Operations", pct: 100 }] }),
    rule({ sourceTable: "leases", sourceId: "L1", functionAllocations: [{ key: "Operations", pct: 100 }] }),
    rule({ sourceTable: "leases", sourceId: "L1", reportingEntityId: "re1", functionAllocations: [{ key: "Fleet", pct: 50 }, { key: "Sales", pct: 50 }] }),
  ], "re1");
  const r = resolveTags(build({ build_type: "schedule", source_table: "leases", source_id: "L1", master_account_id: "m6000" }), { index, people: new Map(), parentOf });
  assert.equal(r.functionOrigin, "source");
  assert.deepEqual(r.functions.map((s) => s.key).sort(), ["Fleet", "Sales"]);
  // Another group ignores re1's rule and gets the organization rule
  const other = resolveTags(build({ build_type: "schedule", source_table: "leases", source_id: "L1", master_account_id: "m6000" }), { index: indexRules([
    rule({ sourceTable: "leases", sourceId: "L1", functionAllocations: [{ key: "Operations", pct: 100 }] }),
    rule({ sourceTable: "leases", sourceId: "L1", reportingEntityId: "re1", functionAllocations: [{ key: "Fleet", pct: 100 }] }),
  ], "re2"), people: new Map(), parentOf });
  assert.deepEqual(other.functions, [{ key: "Operations", pct: 100 }]);
});

test("an account rule on the parent covers its sub-accounts; nothing gives Unassigned", () => {
  const index = indexRules([rule({ masterAccountId: "m6100", locationAllocations: [{ key: "Overhead", pct: 100 }] })], null);
  const r = resolveTags(build({ master_account_id: "m6110" }), { index, people: new Map(), parentOf });
  assert.equal(r.locationOrigin, "account");
  assert.equal(r.functionOrigin, "none");
  const split = splitMonths(new Array(12).fill(10), r.functions);
  assert.deepEqual([...split.keys()], [UNASSIGNED]);
});

test("splitMonths scales shares to 100% and tallies add up", () => {
  const months = new Array(12).fill(100);
  const s = splitMonths(months, [{ key: "Fleet", pct: 75 }, { key: "Sales", pct: 25 }]);
  assert.equal(s.get("Fleet")![0], 75);
  assert.equal(s.get("Sales")![0], 25);
  const odd = splitMonths(months, [{ key: "A", pct: 1 }, { key: "B", pct: 3 }]);
  assert.equal(odd.get("B")![0], 75);
  const tally = new Map<string, number[]>();
  addSplit(tally, s);
  addSplit(tally, splitMonths(months, [{ key: "Fleet", pct: 100 }]));
  assert.deepEqual(tallyToSplits(tally), [{ key: "Fleet", pct: 87.5 }, { key: "Sales", pct: 12.5 }]);
});

test("normalizeFunctionSplits merges repeats after renaming", () => {
  assert.deepEqual(normalizeFunctionSplits([{ key: "Fleet & Maintenance", pct: 25 }, { key: "Fleet", pct: 25 }, { key: "Sales", pct: 50 }]), [{ key: "Fleet", pct: 50 }, { key: "Sales", pct: 50 }]);
});
