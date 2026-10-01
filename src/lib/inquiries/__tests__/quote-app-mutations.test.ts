import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { assertQuoteNotExpired, prepareQuoteValidity } from "../quote-validity";

const now = new Date("2026-10-01T17:00:00Z");
const targets = [
  ["pipeline", "src/lib/inquiries/use-inquiries.ts"],
  ["detail", "src/app/(app)/[entityId]/inquiries/[inquiryId]/page.tsx"],
  ["embed", "src/app/api/inquiries/embed/route.ts"],
] as const;
type Row = Record<string, unknown>;

// Execute real app callbacks and the embed route against an in-memory DB.
// No credentials, live records, React mount, or network requests are involved.
function harness(path: string, action: "create" | "update", expiry: string | null = "2026-10-02") {
  const embed = path.includes("/api/");
  let source = readFileSync(path, "utf8");
  if (!embed) {
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback: ts.Expression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === (action === "create" ? "addQuote" : "updateQuoteStatus") && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.ok(callback);
    source = `exports.run = ${callback.getText(ast)};`;
  }
  const writes: Row[] = [], errors: string[] = [];
  const db = { from: () => {
    let mutation: Row | undefined;
    const result = () => ({ data: mutation ? { quote_number: "Q1242", ...mutation } : { start_date: "2026-10-03", valid_until: expiry }, error: null });
    const query = {
      select: () => query, eq: () => query,
      insert: (row: Row) => { mutation = row; writes.push(row); return query; },
      update: (row: Row) => { mutation = row; writes.push(row); return query; },
      single: async () => result(), maybeSingle: async () => result(),
      then: (done: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(done),
    };
    return query;
  } };
  const policy = {
    prepareQuoteValidity: (start: string | null, custom?: string | null) => prepareQuoteValidity(start, custom, now),
    assertQuoteNotExpired: (quote: { valid_until?: string | null }) => assertQuoteNotExpired(quote, now),
  };
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: Row, options?: { status: number }) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/supabase/admin": { createAdminClient: () => db },
    "@/lib/inquiries/shared": { HDR_ENTITY_ID: "hdr" },
    "@/lib/inquiries/embed-auth": { resolveEmbedEntity: () => "hdr" },
    "@/lib/inquiries/quote-validity": policy,
    "@/lib/email-health/report": {}, "@/lib/ads/columns": {},
  };
  const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, Error, Date, ...policy, require: (name: string) => { assert.ok(name in modules); return modules[name]; },
    createClient: () => db, isEmbed: false, eid: "hdr", entityId: "hdr", actor: "Test", QUOTE_COLUMNS: "*",
    setQuotes: () => {}, setInquiries: () => {}, load: async () => {}, addActivity: async () => {},
    toast: { error: (message: string) => errors.push(message) },
  });
  const invoke = async (value: string | Row) => {
    if (!embed) return exports.run(action === "create" ? "inquiry" : "quote", value);
    const body = action === "create" ? { action: "create_quote", id: "inquiry", draft: value } : { action: "update_quote", quoteId: "quote", status: value };
    const response = await exports.POST(new Request("https://test.invalid", { method: "POST", body: JSON.stringify(body) })) as { body: Row; status: number };
    if (response.status !== 200) errors.push(String(response.body.error));
  };
  return { writes, errors, invoke };
}

for (const [label, path] of targets) {
  test(`${label}: new quotes persist default expiry and preserve explicit custom expiry`, async () => {
    for (const custom of [null, "2026-10-15"]) {
      const h = harness(path, "create");
      await h.invoke({ lines: [], subtotal: 100, tax_rate: 0, tax: 0, total: 100, valid_until: custom });
      assert.deepEqual(h.errors, []);
      assert.equal(h.writes[0].created_at, now.toISOString());
      assert.equal(h.writes[0].valid_until, custom ?? "2026-10-02");
      assert.equal(h.writes[0].total, 100);
    }
    // A default displayed for a previous event/date is recomputed at save,
    // while the same date entered explicitly above remains a custom expiry.
    const staleDefault = harness(path, "create");
    await staleDefault.invoke({ lines: [], total: 100, valid_until: "2026-10-04", use_default_validity: true });
    assert.equal(staleDefault.writes[0].valid_until, "2026-10-02");
    assert.equal("use_default_validity" in staleDefault.writes[0], false);
  });
  test(`${label}: send and acceptance reject only expired stored validity`, async () => {
    for (const status of ["sent", "accepted"]) {
      for (const expiry of ["2026-09-30", "2026-10-01", "2026-10-15", null]) {
        const h = harness(path, "update", expiry);
        await h.invoke(status);
        assert.equal(h.writes.length, expiry === "2026-09-30" ? 0 : 1);
        assert.deepEqual(h.errors, expiry === "2026-09-30" ? ["This quote expired on Sep 30, 2026. Issue a new quote."] : []);
      }
    }
  });
}
