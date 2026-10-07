import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDigest, maskPhone, type DigestConversation } from "../ai-call-digest";
import { laDayStart } from "../ai-call";

const steve: DigestConversation = {
  conversation_id: "conv_steve",
  start_time_unix_secs: Date.parse("2026-10-06T20:07:14Z") / 1000, // 1:07pm PDT
  direction: "outbound",
  call_duration_secs: 59,
  phone_number: "+15555550123",
  transcript: [
    { role: "agent", message: "Hi, this is HDR Site Services' AI assistant, on a recorded line. Is this Steve?", time_in_call_secs: 3 },
    { role: "agent", message: "So we'd typically quote around three thousand dollars for that day.", time_in_call_secs: 30 },
    { role: "agent", message: "", time_in_call_secs: 31, tool_calls: [{ tool_name: "end_call", params_as_json: "{}" }] },
  ],
  dynamic_variables: { event_type: "Wedding", start_date: "2027-04-10", end_date: "2027-04-10", guests: "150", event_location: "92504", form_price: "unknown" },
  collected: { call_outcome: "completed", quote_response: "hesitant", guest_count: 150 },
  evaluation: { disclosed_ai_recording: { result: "success" }, three_items: { result: "failure", rationale: "no guests confirmed" } },
  summary: "Quoted about $3,000.",
};
const test1: DigestConversation = {
  ...steve,
  conversation_id: "conv_test",
  start_time_unix_secs: Date.parse("2026-10-06T19:51:00Z") / 1000,
  direction: null,
  phone_number: null,
};

test("digest lists calls in time order with inquiry, form price, tools and masked phone", () => {
  const d = buildDigest("Tue, Oct 6", [steve, test1], new Map([["conv_steve", { reference: "HDR-ABC12", name: "Steve Example" }]]));
  assert.equal(d.subject, "[AI CALL DIGEST] Tue, Oct 6 · 1 call · 1 test");
  assert.match(d.text, /CALL 1 of 1 · 1:07 PM PT · phone call · 59s · conv_steve/);
  assert.match(d.text, /TEXT TESTS \(not real calls, not reviewed\):\n  12:51 PM PT · 59s · conv_test/);
  assert.match(d.text, /Inquiry: HDR-ABC12 \(Steve\) · phone \.\.\.0123/);
  assert.match(d.text, /form_price given to the agent: unknown/);
  assert.match(d.text, /\[30s\] AI: So we'd typically quote around three thousand dollars/);
  assert.match(d.text, /TOOL CALL end_call/);
  assert.match(d.text, /three_items rationale: no guests confirmed/);
  assert.doesNotMatch(d.text, /5555550123/);
});

test("empty day still produces a digest", () => {
  const d = buildDigest("Wed, Oct 7", [], new Map());
  assert.equal(d.subject, "[AI CALL DIGEST] Wed, Oct 7 · 0 calls");
  assert.match(d.text, /No conversations today\./);
});

test("laDayStart is Pacific midnight, across DST", () => {
  assert.equal(laDayStart(new Date("2026-10-07T01:15:00Z")).toISOString(), "2026-10-06T07:00:00.000Z"); // 6:15pm PDT Oct 6
  assert.equal(laDayStart(new Date("2026-11-03T01:15:00Z")).toISOString(), "2026-11-02T08:00:00.000Z"); // 5:15pm PST Nov 2
  assert.equal(maskPhone("(661) 904-1169"), "...1169");
  assert.equal(maskPhone(null), "none");
});
