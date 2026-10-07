import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMasterWorkbook, type MasterGroup } from "../master-export";
import type { ModelItem } from "../model";

const m12 = (v: number) => new Array(12).fill(v) as number[];
const item = (label: string, kind: ModelItem["kind"], months: number[]): ModelItem => ({
  id: label, kind, label, source: "Item", sourceHref: null, methodText: null, method: null, note: null, count: null, months, total: months.reduce((a, b) => a + b, 0), editable: true, history: null,
});

const group = (name: string, rev: number): MasterGroup => ({
  name,
  versionName: `${name} FY27`,
  model: {
    priorYear: { r1: m12(rev), ic: m12(5) },
    sections: [
      { id: "revenue", title: "Revenue", masters: [
        { id: "r1", accountNumber: "4000", name: "Rental Revenue - Vehicles", months: m12(rev * 2), items: [item("RL line", "manual", m12(rev)), item("Missouri Fleet", "driver", m12(rev))] },
        { id: "ic", accountNumber: "4999", name: "Intercompany Revenue", months: m12(5), items: [] },
      ] },
    ],
  },
});

export const sample = () => buildMasterWorkbook({ fiscalYear: 2027, kind: "budget", through: 8, groups: [group("Avon", 100), group("HDR", 10)], intercompany: new Set(["ic"]), exportedOn: "2026-10-07" });

test("master list: account rows sum their items; consolidated skips intercompany", () => {
  const ws = sample().worksheets[0];
  const header = ws.getRow(2).values as unknown[];
  assert.equal(header[2], "Entity");
  assert.ok(header.includes("Aug 2026") && !header.includes("Sep 2026") && header.includes("Dec 2027"));
  const rows: Array<{ entity: unknown; level: unknown; line: unknown }> = [];
  ws.eachRow((row, n) => { if (n > 2) rows.push({ entity: row.getCell(2).value, level: row.getCell(6).value, line: row.getCell(7).value }); });
  const avonAccount = rows.find((x) => x.entity === "Avon" && x.level === "Account" && x.line === "Rental Revenue - Vehicles");
  assert.ok(avonAccount);
  assert.ok(rows.some((x) => x.line === "RL line" && x.level === "Detail"));
  const cons = rows.filter((x) => x.entity === "Consolidated" && x.level === "Account").map((x) => x.line);
  assert.deepEqual(cons, ["Rental Revenue - Vehicles"]);
});
