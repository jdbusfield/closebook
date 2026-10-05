import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAiCallReport, extractQuotedPrice, type RawTranscriptTurn, type ReportInquiry } from "../ai-call-report";

const inquiry: ReportInquiry = {
  id: "11111111-1111-1111-1111-111111111111",
  entity_id: "7529580d-3b44-4a9b-91f4-bc2db25f5211",
  reference: "HDR-TEST1",
  name: "Sarah Example",
  email: "sarah@example.com",
  phone: "(323) 555-0142",
  use_case: "Wedding",
  start_date: "2026-12-04",
  end_date: "2026-12-05",
  guests: null,
  location: "Santa Monica, CA",
  notes: null,
};

const priceResult = JSON.stringify({
  trailers: 3, days: 2, rate_category: "wedding / event", discount_pct: 20, attendant_hours: 0,
  per_trailer_list: 1399, per_trailer: 1119.2, attendant_total: 0, total: 3357.6, say_total: 3360,
  say: "For 450 guests we'd recommend three 4-stall trailers.",
});

// Shape of the Oct 5 test call: an aborted end_call, then the real result.
const transcript: RawTranscriptTurn[] = [
  { role: "user", message: "Uh, we're expecting 450." },
  { role: "agent", message: "", tool_results: [{ tool_name: "get_price", result_value: priceResult, is_error: false }] },
  { role: "agent", message: "We'd typically quote around thirty-three sixty for the two-day rental." },
  { role: "user", message: "I was hoping to be around, like, two thousand." },
  { role: "agent", message: "", tool_results: [{ tool_name: "end_call", result_value: "abandoned", is_error: true }] },
];

test("extractQuotedPrice takes the last successful get_price result", () => {
  const q = extractQuotedPrice(transcript);
  assert.ok(q);
  assert.equal(q.trailers, 3);
  assert.equal(q.total, 3357.6);
  assert.equal(q.say_total, 3360);
  assert.equal(q.per_trailer_list, 1399);
  assert.equal(extractQuotedPrice([{ role: "agent", message: "hi" }]), null);
  assert.equal(
    extractQuotedPrice([{ role: "agent", message: "", tool_results: [{ tool_name: "get_price", result_value: "{\"error\":\"x\"}", is_error: false }] }]),
    null
  );
});

test("hesitant caller: subject, price lines and budget", () => {
  const r = buildAiCallReport({
    kind: "answered", inquiry, attempt: 1, outcome: "completed",
    collected: { quote_response: "hesitant", customer_budget: "2000", guest_count: 450, event_date: "Dec 4-5", location: "Santa Monica" },
    transcript,
  });
  assert.equal(r.subject, "[AI CALL] HDR-TEST1 · Sarah Example · Wants a better price: quoted around $3,360, budget $2,000");
  assert.match(r.text, /3 x 4-stall restroom trailer, 2 days \(wedding \/ event rate\) at \$1,399 each = \$4,197/);
  assert.match(r.text, /Multi-trailer discount 20% = -\$839\.40/);
  assert.match(r.text, /TOTAL \$3,357\.60 \(the agent said "around \$3,360"\)/);
  assert.match(r.text, /Customer response: hesitant \(budget \$2,000\)/);
  assert.equal((r.data.quoted_price as { total: number }).total, 3357.6);
  assert.equal(r.data.quote_response, "hesitant");
});

test("accepted caller gets a send-the-quote next step", () => {
  const r = buildAiCallReport({ kind: "answered", inquiry, attempt: 1, outcome: "completed", collected: { quote_response: "accepted" }, transcript });
  assert.match(r.subject, /Accepted around \$3,360 \(3 trailers\)$/);
  assert.match(r.text, /Next step: Send the written quote/);
});

test("callback request leads the subject even when a price was quoted", () => {
  const r = buildAiCallReport({
    kind: "answered", inquiry, attempt: 1, outcome: "callback_requested",
    collected: { quote_response: "hesitant", callback_time: "right now" }, transcript,
  });
  assert.match(r.subject, /Callback requested: right now$/);
  assert.match(r.text, /The AI quoted around \$3,360/);
});

test("no price quoted says the quote is up to us", () => {
  const r = buildAiCallReport({ kind: "answered", inquiry, attempt: 1, outcome: "completed", collected: { quote_response: "accepted" }, transcript: [] });
  assert.match(r.subject, /Talked, no price quoted$/);
  assert.match(r.text, /did not quote a price, so any quote is up to us/);
  assert.equal(r.data.quote_response, "not_quoted");
});

test("do-not-call wins over everything", () => {
  const r = buildAiCallReport({ kind: "answered", inquiry, attempt: 1, outcome: "not_interested", collected: { do_not_call: true }, transcript });
  assert.match(r.subject, /DO NOT CONTACT$/);
  assert.equal(r.data.do_not_contact, true);
});

test("missed calls: voicemail and no answer after the retry", () => {
  const vm = buildAiCallReport({ kind: "voicemail", inquiry, attempt: 1, outcome: "voicemail" });
  assert.match(vm.subject, /Voicemail left$/);
  assert.match(vm.text, /sorry we missed you/);
  assert.equal(vm.data.quoted_price, null);
  const na = buildAiCallReport({ kind: "no_answer", inquiry, attempt: 2, failureReason: "no-answer" });
  assert.match(na.subject, /No answer after 2 tries$/);
  assert.match(na.text, /Email: sarah@example\.com/);
});
