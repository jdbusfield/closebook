import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { assertQuoteActionable, prepareQuoteValidity } from "../quote-validity";

// Run the actual two app mutation callbacks with isolated dependencies. This
// avoids mounting the unrelated CRM UI or creating an authenticated DB client.
const targets = [
  ["pipeline hook", "src/lib/inquiries/use-inquiries.ts"],
  ["inquiry detail page", "src/app/(app)/[entityId]/inquiries/[inquiryId]/page.tsx"],
] as const;
const NOW = new Date("2026-10-01T17:00:00Z");
type Row = Record<string, unknown>;

function callbackSource(path: string, name: string): string {
  const source = ts.createSourceFile(path, readFileSync(resolve(path), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(callback, `${name} callback exists in ${path}`);
  return ts.transpileModule(`exports.callback = ${callback.getText(source)};`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

function harness(path: string, action: string, {
  event = "2026-10-03", quote = {}, isEmbed = false, updateError = false,
}: { event?: string | null; quote?: Row; isEmbed?: boolean; updateError?: boolean } = {}) {
  const writes: { kind: string; values: Row }[] = [];
  const success: string[] = [];
  const errors: string[] = [];
  const embedCalls: Row[] = [];
  const tables: Record<string, Row> = {
    rental_inquiries: { id: "inquiry-1", entity_id: "hdr", start_date: event },
    rental_inquiry_quotes: {
      id: "quote-1", inquiry_id: "inquiry-1", entity_id: "hdr", status: "draft",
      created_at: NOW.toISOString(), valid_until: "2026-10-02", terms: null, ...quote,
    },
  };
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let kind = "read";
      let values: Row = {};
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        insert(next: Row) { kind = "insert"; values = next; return query; },
        update(next: Row) { kind = "update"; values = next; return query; },
        async single() {
          const row = tables[table];
          if (kind !== "read") {
            writes.push({ kind, values });
            if (kind === "update" && updateError) return { data: null, error: { message: "Write failed" } };
            return { data: { id: "quote-1", quote_number: "Q1242", ...values }, error: null };
          }
          return filters.every(([key, value]) => row?.[key] === value)
            ? { data: row, error: null }
            : { data: null, error: { message: "Not found" } };
        },
      };
      return query;
    },
  };
  const embedPost = async (payload: Row) => { embedCalls.push(payload); return { quote: { id: "quote-1", quote_number: "Q1242" } }; };
  const exports: { callback?: (...args: unknown[]) => Promise<unknown> } = {};
  runInNewContext(callbackSource(path, action), {
    exports, Error, Date, isEmbed,
    eid: "hdr", entityId: "hdr", actor: "Test rep", QUOTE_COLUMNS: "*", createClient: () => client,
    embedPost, embedAction: embedPost, load: async () => {}, addActivity: async () => {},
    toast: { success: (text: string) => success.push(text), error: (text: string) => errors.push(text) },
    prepareQuoteValidity: (start: string | null, requested?: string | null) => prepareQuoteValidity(start, requested, NOW),
    assertQuoteActionable: (saved: Parameters<typeof assertQuoteActionable>[0], inquiry: { start_date?: string | null }) => assertQuoteActionable(saved, inquiry, NOW),
    // Guarded status updates should never claim an optimistic success.
    setInquiries: () => assert.fail("Status changed before persistence"),
    setQuotes: () => assert.fail("Status changed before persistence"),
  });
  return { writes, success, errors, embedCalls, invoke: exports.callback! };
}

const draft = { lines: [{ description: "Trailer", qty: 1, rate: 100 }], subtotal: 100, tax_rate: 0, tax: 0, total: 100, valid_until: null };

for (const [label, path] of targets) {
  test(`${label}: create validates fresh inquiry and leaves default expiry to server issuance`, async () => {
    const h = harness(path, "addQuote");
    await h.invoke("inquiry-1", draft);
    assert.deepEqual(h.errors, []);
    assert.equal(h.writes[0].values.created_at, NOW.toISOString());
    assert.equal(h.writes[0].values.valid_until, null);
    assert.equal(h.writes[0].values.total, 100);
  });

  test(`${label}: expired/same-day/null validity cannot be accepted or marked sent`, async () => {
    for (const status of ["accepted", "sent"]) {
      for (const options of [
        { quote: { created_at: "2026-09-27T17:00:00Z", valid_until: "2026-09-30" } },
        { event: "2026-10-01" },
        { quote: { valid_until: null } },
      ]) {
        const h = harness(path, "updateQuoteStatus", options);
        await h.invoke("quote-1", status);
        assert.equal(h.writes.length, 0);
        assert.equal(h.success.length, 0);
        assert.equal(h.errors.length, 1);
      }
    }
  });

  test(`${label}: accepted status succeeds only after persistence; DB failure never shows success`, async () => {
    const h = harness(path, "updateQuoteStatus");
    await h.invoke("quote-1", "accepted");
    assert.equal(h.writes[0].values.status, "accepted");
    assert.ok(h.writes[0].values.accepted_at);
    assert.equal(h.success.length, 1);
    const failed = harness(path, "updateQuoteStatus", { updateError: true });
    await failed.invoke("quote-1", "accepted");
    assert.equal(failed.success.length, 0);
    assert.deepEqual(failed.errors, ["Write failed"]);
  });

  test(`${label}: embed mode delegates both creation and status to guarded route`, async () => {
    const create = harness(path, "addQuote", { isEmbed: true });
    await create.invoke("inquiry-1", draft);
    assert.equal(create.embedCalls[0].action, "create_quote");
    assert.equal(create.writes.length, 0);
    const update = harness(path, "updateQuoteStatus", { isEmbed: true });
    await update.invoke("quote-1", "accepted");
    assert.equal(update.embedCalls[0].action, "update_quote");
    assert.equal(update.writes.length, 0);
  });
}
