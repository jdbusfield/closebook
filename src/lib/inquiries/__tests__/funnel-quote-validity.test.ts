import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import { Resend } from "resend";
import { ModuleKind, transpileModule } from "typescript";
import * as funnelEngine from "../funnel-send";
import * as shared from "../shared";
import * as validity from "../quote-validity";
import {
  enrollmentQuote,
  funnelUsesQuote,
  processEnrollment,
  type EnrollmentRow,
  type FunnelStepRow,
} from "../funnel-send";
import type { InquiryQuote } from "../shared";

type Row = Record<string, unknown>;
type QueryResult = { data: Row | Row[] | null; error: { message: string } | null };

// In-memory fluent database adapter: no Supabase credentials or network.
class MemoryDatabase {
  rows: Record<string, Row[]>;
  writes: Array<{ table: string; values: Row }> = [];
  failWrite?: (table: string, values: Row) => boolean;
  afterWrite?: (table: string, values: Row) => void;
  auth = { getUser: async () => ({ data: { user: { id: "test-staff" } } }) };
  constructor(quoteChanges: Partial<InquiryQuote> = {}) {
    this.rows = {
      rental_inquiries: [{ id: "inquiry", entity_id: "entity", status: "new", email: "customer@example.test", start_date: "2026-10-03", name: "Example Customer", lane: "inbound" }],
      rental_inquiry_quotes: [{ id: "quote", inquiry_id: "inquiry", quote_number: "Q1242", status: "draft", created_at: "2026-10-01T16:00:00Z", valid_until: "2026-10-02", lines: [], subtotal: 0, tax_rate: 0, tax: 0, total: 0, terms: null, ...quoteChanges }],
      rental_inquiry_funnel_steps: [{ id: "step", funnel_id: "funnel", day_offset: 0, subject: "Your quote", body: "{quote}", sort_order: 0, resource_ids: [] }],
      rental_inquiry_messages: [],
      rental_inquiry_funnel_enrollments: [{ ...enrollment }],
      rental_inquiry_funnels: [{ id: "funnel", entity_id: "entity", name: "Quote funnel", archived: false }],
    };
  }
  from(table: string) {
    let values: Row | null = null;
    let inserted = false;
    let single = false;
    let limit = Infinity;
    const predicates: Array<(row: Row) => boolean> = [];
    const run = (): QueryResult => {
      const rows = this.rows[table] ?? [];
      let matches = rows.filter((row) => predicates.every((predicate) => predicate(row))).slice(0, limit);
      if (values) {
        this.writes.push({ table, values });
        if (this.failWrite?.(table, values)) return { data: null, error: { message: "simulated database outage" } };
        if (inserted) {
          const row = { id: "new-enrollment", ...values };
          matches = [row];
          rows.push(row);
        } else {
          matches.forEach((row) => Object.assign(row, values));
        }
        this.afterWrite?.(table, values);
      }
      return { data: single ? matches[0] ?? null : matches, error: null };
    };
    const query = {
      select: () => query,
      update: (next: Row) => { values = next; return query; },
      insert: (next: Row) => { values = next; inserted = true; return query; },
      eq: (key: string, value: unknown) => { predicates.push((row) => row[key] === value); return query; },
      in: (key: string, value: unknown[]) => { predicates.push((row) => value.includes(row[key])); return query; },
      like: (key: string, value: string) => { predicates.push((row) => String(row[key]).startsWith(value.replace(/%$/, ""))); return query; },
      gt: (key: string, value: string) => { predicates.push((row) => String(row[key]) > value); return query; },
      order: () => query,
      limit: (count: number) => { limit = count; return query; },
      maybeSingle: () => { single = true; return query; },
      single: () => { single = true; return query; },
      then: <T>(resolve: (result: QueryResult) => T) => Promise.resolve(run()).then(resolve),
    };
    return query;
  }
  get admin() { return this as unknown as Parameters<typeof processEnrollment>[0]; }
  get enrollment() { return this.rows.rental_inquiry_funnel_enrollments[0] as unknown as EnrollmentRow; }
}

const enrollment: EnrollmentRow = {
  id: "enrollment", inquiry_id: "inquiry", entity_id: "entity", funnel_id: "funnel", quote_id: "quote",
  status: "active", enrolled_at: "2026-10-01T16:00:00Z", steps_sent: 0, next_send_at: "2026-10-01T16:00:00Z",
};
let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_only_no_network";
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T17:00:00Z") });
  mock.method(globalThis, "fetch", () => { throw new Error("Network is forbidden in this test"); });
});
afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
});

function providerSuccess() {
  return mock.method(Resend.prototype, "post", async () => ({ data: { id: "provider-id" }, error: null, headers: null }));
}

test("October 1 / October 3 quote sends October 2 expiry and marks draft sent", async () => {
  const db = new MemoryDatabase();
  const sent = providerSuccess();
  const result = await processEnrollment(db.admin, { ...enrollment });
  assert.deepEqual(result, { outcome: "sent", stepId: "step", final: true });
  assert.equal(sent.mock.callCount(), 1);
  const [, message, options] = sent.mock.calls[0].arguments;
  assert.match((message as { text: string }).text, /Pricing valid through Oct 2, 2026 \(America\/Los_Angeles\)/);
  assert.equal((options as { idempotencyKey: string }).idempotencyKey, "funnel/enrollment/step/0");
  assert.equal(db.rows.rental_inquiry_quotes[0].status, "sent");
  assert.equal(db.enrollment.status, "completed");
  assert.equal(db.enrollment.steps_sent, 1);
  assert.equal(db.rows.rental_inquiry_messages[0].resend_email_id, "provider-id");
});

test("next-day event permits send through issuance day, including a custom earlier expiry", async () => {
  const db = new MemoryDatabase({ valid_until: "2026-10-01" });
  db.rows.rental_inquiries[0].start_date = "2026-10-02";
  const sent = providerSuccess();
  assert.equal((await processEnrollment(db.admin, { ...enrollment })).outcome, "sent");
  assert.equal(sent.mock.callCount(), 1);
});

test("same-day event and null or legacy overlong validity stop before contacting provider", async () => {
  const sent = providerSuccess();
  for (const changes of [{ valid_until: null }, { valid_until: "2026-10-15" }, {}]) {
    const db = new MemoryDatabase(changes);
    if (!Object.keys(changes).length) db.rows.rental_inquiries[0].start_date = "2026-10-01";
    assert.equal((await processEnrollment(db.admin, { ...enrollment })).outcome, "stopped");
    assert.equal(db.enrollment.status, "stopped");
  }
  assert.equal(sent.mock.callCount(), 0);
});

test("expired quote blocks later funnel step even without a quote token", async () => {
  const db = new MemoryDatabase({ created_at: "2026-09-28T16:00:00Z", valid_until: "2026-09-30" });
  db.rows.rental_inquiry_funnel_steps.push({ id: "followup", funnel_id: "funnel", day_offset: 0, subject: "Checking in", body: "Any questions?", sort_order: 1, resource_ids: [] });
  const sent = providerSuccess();
  const result = await processEnrollment(db.admin, { ...enrollment, steps_sent: 1 });
  assert.equal(result.outcome, "stopped");
  if (result.outcome === "stopped") assert.match(result.reason, /expired/i);
  assert.equal(sent.mock.callCount(), 0);
});

test("Los Angeles midnight, not UTC midnight, controls expiration", async () => {
  const db = new MemoryDatabase({ valid_until: "2026-10-01" });
  const sent = providerSuccess();
  mock.timers.setTime(new Date("2026-10-02T06:59:59Z").getTime());
  assert.equal((await processEnrollment(db.admin, { ...enrollment })).outcome, "sent");
  const expired = new MemoryDatabase({ valid_until: "2026-10-01" });
  mock.timers.setTime(new Date("2026-10-02T07:00:00Z").getTime());
  assert.equal((await processEnrollment(expired.admin, { ...enrollment })).outcome, "stopped");
  assert.equal(sent.mock.callCount(), 1);
});

test("expiry is checked again if preparing the email crosses Los Angeles midnight", async () => {
  mock.timers.setTime(new Date("2026-10-02T06:59:59Z").getTime());
  const db = new MemoryDatabase({ valid_until: "2026-10-01" });
  db.afterWrite = (table, values) => {
    if (table === "rental_inquiry_funnel_enrollments" && values.stopped_reason === "delivery_pending:step") {
      mock.timers.setTime(new Date("2026-10-02T07:00:00Z").getTime());
    }
  };
  const sent = providerSuccess();
  assert.equal((await processEnrollment(db.admin, { ...enrollment })).outcome, "stopped");
  assert.match(String(db.rows.rental_inquiry_funnel_enrollments[0].stopped_reason), /^quote_review:.*expired/i);
  assert.equal(sent.mock.callCount(), 0);
});

test("selected missing/deleted quote fails instead of substituting a different quote", async () => {
  const db = new MemoryDatabase();
  db.rows.rental_inquiry_quotes[0].id = "different-quote";
  await assert.rejects(enrollmentQuote(db.admin, enrollment), /selected quote is missing/);
  const sent = providerSuccess();
  assert.equal((await processEnrollment(db.admin, { ...enrollment })).outcome, "stopped");
  assert.equal((await processEnrollment(new MemoryDatabase().admin, { ...enrollment, quote_id: null })).outcome, "stopped");
  assert.equal(sent.mock.callCount(), 0);
});

test("legacy funnel promises are blocked without changing their text or inventory hold policy", async () => {
  const db = new MemoryDatabase();
  const oldBody = "{quote}\nThe quote is good for 3 days. Inventory hold is 48 hours.";
  db.rows.rental_inquiry_funnel_steps[0].body = oldBody;
  const sent = providerSuccess();
  const result = await processEnrollment(db.admin, { ...enrollment });
  assert.equal(result.outcome, "stopped");
  assert.equal(sent.mock.callCount(), 0);
  assert.equal(db.rows.rental_inquiry_funnel_steps[0].body, oldBody);
});

test("later quote-linked followup includes exact persisted expiry and leaves sent quote status alone", async () => {
  const db = new MemoryDatabase({ status: "sent" });
  db.rows.rental_inquiry_funnel_steps[0].body = "Any questions? Inventory hold is 48 hours.";
  const sent = providerSuccess();
  assert.equal((await processEnrollment(db.admin, { ...enrollment })).outcome, "sent");
  const message = sent.mock.calls[0].arguments[1] as { text: string };
  assert.match(message.text, /Oct 2, 2026/);
  assert.match(message.text, /Inventory hold is 48 hours/);
  assert.equal(db.rows.rental_inquiry_quotes[0].status, "sent");
});

test("acceptance racing with delivery is preserved by draft-only status update", async () => {
  const db = new MemoryDatabase();
  mock.method(Resend.prototype, "post", async () => {
    db.rows.rental_inquiry_quotes[0].status = "accepted";
    return { data: { id: "provider-id" }, error: null, headers: null };
  });
  assert.equal((await processEnrollment(db.admin, { ...enrollment })).outcome, "sent");
  assert.equal(db.rows.rental_inquiry_quotes[0].status, "accepted");
});

test("post-send database error retains delivery claim and never retries automatically", async () => {
  const db = new MemoryDatabase();
  db.failWrite = (table) => table === "rental_inquiry_quotes";
  const sent = providerSuccess();
  const result = await processEnrollment(db.admin, { ...enrollment });
  assert.equal(result.outcome, "sent");
  if (result.outcome === "sent") assert.match(result.warning ?? "", /Email was sent.*Do not resend/);
  assert.equal(db.enrollment.status, "stopped");
  assert.equal(db.rows.rental_inquiry_funnel_enrollments[0].stopped_reason, "delivery_pending:step");
  assert.equal((await processEnrollment(db.admin, db.enrollment)).outcome, "skipped");
  assert.equal(sent.mock.callCount(), 1);
});

test("provider failure or uncertain delivery keeps stopped claim for review", async () => {
  const db = new MemoryDatabase();
  const sent = mock.method(Resend.prototype, "post", async () => { throw new Error("connection interrupted"); });
  const result = await processEnrollment(db.admin, { ...enrollment });
  assert.equal(result.outcome, "error");
  if (result.outcome === "error") assert.equal(result.deliveryMayHaveOccurred, true);
  assert.equal(db.enrollment.status, "stopped");
  assert.equal(db.rows.rental_inquiry_quotes[0].status, "draft");
  assert.equal((await processEnrollment(db.admin, db.enrollment)).outcome, "skipped");
  assert.equal(sent.mock.callCount(), 1);
});

test("an already claimed enrollment cannot send a duplicate from stale input", async () => {
  const db = new MemoryDatabase();
  db.rows.rental_inquiry_funnel_enrollments[0].status = "stopped";
  const sent = providerSuccess();
  assert.equal((await processEnrollment(db.admin, { ...enrollment })).outcome, "skipped");
  assert.equal(sent.mock.callCount(), 0);
});

test("all canonical quote merge tokens identify a quote-led funnel", () => {
  for (const token of ["quote", "quote_number", "quote_valid_until", "quote_issued_on", "quote_validity"]) {
    assert.equal(funnelUsesQuote([{ subject: "", body: `{${token}}` }] as FunnelStepRow[]), true);
  }
});

// Execute the actual route source, substituting only its external auth/DB/HTTP
// adapters. This exercises both app and embed branches without Next request
// context, a real auth session, Supabase credentials, or network access.
const compiledRoute = transpileModule(
  readFileSync("src/app/api/inquiries/funnels/route.ts", "utf8"),
  { compilerOptions: { module: ModuleKind.CommonJS } },
).outputText;

function routeRequest(db: MemoryDatabase, mode: "app" | "embed", body: Row): Promise<Response> {
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), init) } },
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/inquiries/embed-auth": { resolveEmbedEntity: (request: Request) => request.headers.get("x-embed-key") === "test-key" ? "entity" : null },
    "@/lib/inquiries/shared": shared,
    "@/lib/inquiries/quote-validity": validity,
    "@/lib/inquiries/funnel-send": funnelEngine,
  };
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  new Function("require", "exports", compiledRoute)((id: string) => {
    assert.ok(id in dependencies, `Unexpected route dependency ${id}`);
    return dependencies[id];
  }, exports);
  return exports.POST!(new Request("http://test.invalid/api/inquiries/funnels", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(mode === "embed" ? { "x-embed-key": "test-key" } : {}) },
    body: JSON.stringify(body),
  }));
}

for (const mode of ["app", "embed"] as const) {
  test(`${mode} enrollment validates and pins the latest quote before scheduling`, async () => {
    const db = new MemoryDatabase();
    db.rows.rental_inquiry_funnel_steps[0].day_offset = 1;
    const response = await routeRequest(db, mode, { action: "enroll", inquiryId: "inquiry", funnelId: "funnel" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.enrollment.quote_id, "quote");
    assert.equal(body.enrollment.status, "active");
  });

  test(`${mode} enrollment blocks invalid and expired quotes before replacing any enrollment`, async () => {
    for (const changes of [
      { valid_until: "2026-09-30", created_at: "2026-09-28T16:00:00Z" },
      { valid_until: null },
      { valid_until: "2026-10-15" },
      { terms: "Pricing guaranteed for 3 days." },
    ]) {
      const db = new MemoryDatabase(changes);
      const response = await routeRequest(db, mode, { action: "enroll", inquiryId: "inquiry", funnelId: "funnel", quoteId: "quote" });
      assert.equal(response.status, 400);
      assert.equal(db.writes.length, 0);
    }
  });

  test(`${mode} enrollment rejects same-day events and an explicitly missing quote`, async () => {
    const sameDay = new MemoryDatabase();
    sameDay.rows.rental_inquiries[0].start_date = "2026-10-01";
    const response = await routeRequest(sameDay, mode, { action: "enroll", inquiryId: "inquiry", funnelId: "funnel" });
    assert.equal(response.status, 400);
    const missing = new MemoryDatabase();
    const missingResponse = await routeRequest(missing, mode, { action: "enroll", inquiryId: "inquiry", funnelId: "funnel", quoteId: "missing" });
    assert.equal(missingResponse.status, 400);
    assert.equal(missing.writes.length, 0);
  });

  test(`${mode} enrollment rejects stored fixed-day funnel copy without modifying it`, async () => {
    const db = new MemoryDatabase();
    db.rows.rental_inquiry_funnel_steps[0].body = "{quote} Pricing stands for 14 days from my first email.";
    const response = await routeRequest(db, mode, { action: "enroll", inquiryId: "inquiry", funnelId: "funnel" });
    assert.equal(response.status, 400);
    assert.equal(db.writes.length, 0);
  });

  test(`${mode} resume validates expiry even when the next step has no quote token`, async () => {
    const db = new MemoryDatabase({ created_at: "2026-09-28T16:00:00Z", valid_until: "2026-09-30" });
    db.rows.rental_inquiry_funnel_enrollments[0].status = "stopped";
    db.rows.rental_inquiry_funnel_steps[0].body = "Any questions?";
    const response = await routeRequest(db, mode, { action: "resume", enrollmentId: "enrollment" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /expired/i);
    assert.equal(db.writes.length, 0);
  });

  test(`${mode} delivery-review marker cannot be bypassed through enroll, stop, or resume`, async () => {
    const db = new MemoryDatabase();
    Object.assign(db.rows.rental_inquiry_funnel_enrollments[0], { status: "stopped", stopped_reason: "delivery_pending:step" });
    for (const action of ["enroll", "stop", "resume"]) {
      const response = await routeRequest(db, mode, { action, inquiryId: "inquiry", funnelId: "funnel", enrollmentId: "enrollment" });
      assert.equal(response.status, 409);
    }
    assert.equal(db.writes.length, 0);
  });
}
