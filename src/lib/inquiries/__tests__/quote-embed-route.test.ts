import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { assertQuoteActionable, prepareQuoteValidity } from "../quote-validity";

// Execute the real route with in-memory database responses. No Supabase client,
// credentials, external request, or live row is used by these regression tests.
const source = readFileSync(resolve("src/app/api/inquiries/embed/route.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const NOW = new Date("2026-10-01T17:00:00Z");
type Row = Record<string, unknown>;
type Response = { status: number; body: Row };

function harness({
  event = "2026-10-03",
  quote = {},
  entity = "hdr",
  updateError = false,
}: { event?: string | null; quote?: Row; entity?: string; updateError?: boolean } = {}) {
  const writes: { table: string; kind: string; values: Row }[] = [];
  const tables: Record<string, Row[]> = {
    rental_inquiries: [{ id: "inquiry-1", entity_id: entity, start_date: event }],
    rental_inquiry_quotes: [{
      id: "quote-1", inquiry_id: "inquiry-1", entity_id: entity,
      status: "draft", created_at: NOW.toISOString(), valid_until: "2026-10-02",
      terms: null, ...quote,
    }],
  };
  const admin = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let kind = "read";
      let values: Row = {};
      const result = () => {
        const row = (tables[table] || []).find((r) => filters.every(([key, value]) => r[key] === value));
        if (kind !== "read") {
          writes.push({ table, kind, values });
          if (updateError && kind === "update") return { data: null, error: { message: "Database rejected update" } };
          return { data: kind === "insert" ? { id: "created-quote", ...values } : row, error: null };
        }
        return { data: row ?? null, error: null };
      };
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        insert(next: Row) { kind = "insert"; values = next; return query; },
        update(next: Row) { kind = "update"; values = next; return query; },
        maybeSingle: async () => result(),
        single: async () => result(),
      };
      return query;
    },
  };
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: Row, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/inquiries/shared": { HDR_ENTITY_ID: "hdr" },
    "@/lib/inquiries/embed-auth": { resolveEmbedEntity: (request: Request) => request.headers.get("x-embed-key") === "test-key" ? "hdr" : null },
    "@/lib/inquiries/quote-validity": {
      prepareQuoteValidity: (start: string | null, requested?: string | null) => prepareQuoteValidity(start, requested, NOW),
      assertQuoteActionable: (saved: Parameters<typeof assertQuoteActionable>[0], inquiry: { start_date?: string | null }) => assertQuoteActionable(saved, inquiry, NOW),
    },
    "@/lib/email-health/report": {},
    "@/lib/ads/columns": {},
  };
  runInNewContext(compiled, {
    exports, Error, Date,
    require(name: string) {
      assert.ok(name in modules, `Unexpected route dependency: ${name}`);
      return modules[name];
    },
  });
  return {
    writes,
    post: (body: Row, key = "test-key") => exports.POST!(new Request("https://test.invalid/api/inquiries/embed", {
      method: "POST", headers: { "content-type": "application/json", "x-embed-key": key }, body: JSON.stringify(body),
    })),
  };
}

const draft = {
  lines: [{ description: "Trailer", qty: 1, rate: 100 }], subtotal: 100, tax_rate: 0, tax: 0, total: 100,
};

test("embed create leaves default expiry to actual server issuance for October 1/3 request", async () => {
  const h = harness();
  const response = await h.post({ action: "create_quote", id: "inquiry-1", draft: { ...draft, valid_until: null } });
  assert.equal(response.status, 200);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].values.created_at, NOW.toISOString());
  assert.equal(h.writes[0].values.valid_until, null);
  assert.equal(h.writes[0].values.total, 100);
});

test("embed same-day draft has null validity and requires review before acceptance", async () => {
  const h = harness({ event: "2026-10-01" });
  assert.equal((await h.post({ action: "create_quote", id: "inquiry-1", draft })).status, 200);
  assert.equal(h.writes[0].values.valid_until, null);
  const accepted = await h.post({ action: "update_quote", quoteId: "quote-1", status: "accepted" });
  assert.equal(accepted.status, 409);
  assert.match(String(accepted.body.error), /Same-day/);
  assert.equal(h.writes.length, 1);
});

test("embed next-day quote accepts explicit validity through issuance day", async () => {
  const h = harness({ event: "2026-10-02" });
  assert.equal((await h.post({ action: "create_quote", id: "inquiry-1", draft: { ...draft, valid_until: "2026-10-01" } })).status, 200);
  assert.equal(h.writes[0].values.valid_until, "2026-10-01");
});

test("embed custom date within cap is retained; later date is rejected without a write", async () => {
  const allowed = harness();
  assert.equal((await allowed.post({ action: "create_quote", id: "inquiry-1", draft: { ...draft, valid_until: "2026-10-01" } })).status, 200);
  assert.equal(allowed.writes[0].values.valid_until, "2026-10-01");
  const blocked = harness();
  assert.equal((await blocked.post({ action: "create_quote", id: "inquiry-1", draft: { ...draft, valid_until: "2026-10-15" } })).status, 400);
  assert.equal(blocked.writes.length, 0);
});

test("embed rejects expired sent/accepted transitions before database writes", async () => {
  for (const status of ["sent", "accepted"]) {
    const h = harness({ quote: { created_at: "2026-09-27T17:00:00Z", valid_until: "2026-09-30" } });
    const response = await h.post({ action: "update_quote", quoteId: "quote-1", status });
    assert.equal(response.status, 409);
    assert.match(String(response.body.error), /expired/i);
    assert.equal(h.writes.length, 0);
  }
});

test("embed rejects legacy null validity and conflicting terms before acceptance", async () => {
  for (const quote of [{ valid_until: null }, { terms: "This quote is valid for 14 days." }]) {
    const h = harness({ quote });
    assert.equal((await h.post({ action: "update_quote", quoteId: "quote-1", status: "accepted" })).status, 409);
    assert.equal(h.writes.length, 0);
  }
});

test("embed accepted transition writes status only after validation, and propagates DB failures", async () => {
  const h = harness();
  assert.equal((await h.post({ action: "update_quote", quoteId: "quote-1", status: "accepted" })).status, 200);
  assert.equal(h.writes[0].values.status, "accepted");
  assert.ok(h.writes[0].values.accepted_at);
  const failed = harness({ updateError: true });
  assert.equal((await failed.post({ action: "update_quote", quoteId: "quote-1", status: "accepted" })).status, 500);
});

test("embed quote writes reject unauthorized/cross-entity IDs and unknown statuses", async () => {
  const foreign = harness({ entity: "versatile" });
  assert.equal((await foreign.post({ action: "create_quote", id: "inquiry-1", draft })).status, 404);
  assert.equal((await foreign.post({ action: "update_quote", quoteId: "quote-1", status: "accepted" })).status, 404);
  assert.equal((await foreign.post({ action: "update_quote", quoteId: "quote-1", status: "nonsense" })).status, 400);
  assert.equal((await foreign.post({ action: "update_quote", quoteId: "quote-1", status: "accepted" }, "wrong-key")).status, 401);
  assert.equal(foreign.writes.length, 0);
});
