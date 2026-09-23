import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateActualsByEmployer, sumActuals, type PersonnelActualsByEntity } from "../personnel-actuals";

const SILVERCO = "silverco";
const HDR = "hdr";
const VERSATILE = "versatile";
const NCNT = "ncnt";

function series(v: number): number[] {
  return new Array(12).fill(v);
}

function booked(entries: Array<[string, number[]]>): PersonnelActualsByEntity {
  return { year: 2026, byEntity: new Map(entries), hasData: new Array(12).fill(true), monthsWithData: 12 };
}

test("an employer's booked month follows its people's allocations", () => {
  const src = booked([[SILVERCO, series(1000)]]);
  const out = allocateActualsByEmployer(src, [
    { employerEntityId: SILVERCO, costByMonth: series(300), allocations: [{ entity_id: SILVERCO, pct: 100 }] },
    { employerEntityId: SILVERCO, costByMonth: series(100), allocations: [{ entity_id: VERSATILE, pct: 100 }] },
  ]);
  assert.equal(out.byEntity.get(SILVERCO)![0], 750);
  assert.equal(out.byEntity.get(VERSATILE)![0], 250);
  assert.equal(out.unallocated[0], 0);
});

test("a split row sends part of the booked cost to each entity", () => {
  const src = booked([[SILVERCO, series(400)]]);
  const out = allocateActualsByEmployer(src, [
    { employerEntityId: SILVERCO, costByMonth: series(200), allocations: [{ entity_id: SILVERCO, pct: 75 }, { entity_id: NCNT, pct: 25 }] },
  ]);
  assert.equal(out.byEntity.get(SILVERCO)![5], 300);
  assert.equal(out.byEntity.get(NCNT)![5], 100);
});

test("unallocated people leave their share of the booked cost unallocated", () => {
  const src = booked([[HDR, series(500)]]);
  const out = allocateActualsByEmployer(src, [
    { employerEntityId: HDR, costByMonth: series(100), allocations: [{ entity_id: HDR, pct: 100 }] },
    { employerEntityId: HDR, costByMonth: series(100), allocations: [] },
  ]);
  assert.equal(out.byEntity.get(HDR)![0], 250);
  assert.equal(out.unallocated[0], 250);
});

test("an entity with booked cost but no one on the plan keeps its own figure", () => {
  const src = booked([[VERSATILE, series(60)], [SILVERCO, series(1000)]]);
  const out = allocateActualsByEmployer(src, [
    { employerEntityId: SILVERCO, costByMonth: series(10), allocations: [{ entity_id: SILVERCO, pct: 100 }] },
  ]);
  assert.equal(out.byEntity.get(VERSATILE)![0], 60);
  assert.equal(out.byEntity.get(SILVERCO)![0], 1000);
});

test("a month where the employer's people project nothing stays where it was booked", () => {
  const src = booked([[SILVERCO, series(100)]]);
  const cost = series(50);
  cost[0] = 0;
  const out = allocateActualsByEmployer(src, [{ employerEntityId: SILVERCO, costByMonth: cost, allocations: [{ entity_id: VERSATILE, pct: 100 }] }]);
  assert.equal(out.byEntity.get(SILVERCO)![0], 100);
  assert.equal(out.byEntity.get(SILVERCO)?.[1] ?? 0, 0);
  assert.equal(out.byEntity.get(VERSATILE)![1], 100);
});

test("the organization total does not move", () => {
  const src = booked([[SILVERCO, series(1000)], [HDR, series(500)], [VERSATILE, series(60)]]);
  const out = allocateActualsByEmployer(src, [
    { employerEntityId: SILVERCO, costByMonth: series(300), allocations: [{ entity_id: SILVERCO, pct: 100 }] },
    { employerEntityId: SILVERCO, costByMonth: series(100), allocations: [{ entity_id: VERSATILE, pct: 100 }] },
    { employerEntityId: HDR, costByMonth: series(100), allocations: [{ entity_id: HDR, pct: 50 }, { entity_id: SILVERCO, pct: 50 }] },
    { employerEntityId: null, costByMonth: series(999), allocations: [{ entity_id: NCNT, pct: 100 }] },
  ]);
  let total = 0;
  for (const s of out.byEntity.values()) total += s[0];
  total += out.unallocated[0];
  assert.equal(Math.round(total * 100) / 100, 1560);
  // A row with no known employer moves nothing
  assert.equal(out.byEntity.has(NCNT), false);
});

test("sumActuals adds member entities and keeps the booked-month flags", () => {
  const src = booked([[SILVERCO, series(10)], [NCNT, series(5)]]);
  src.hasData[11] = false;
  src.monthsWithData = 11;
  const s = sumActuals(src, [SILVERCO, NCNT, "nobody"]);
  assert.equal(s.byMonth[0], 15);
  assert.equal(s.total, 180);
  assert.equal(s.monthsWithData, 11);
  assert.equal(s.hasData[11], false);
});
