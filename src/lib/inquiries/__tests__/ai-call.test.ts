import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  dynamicVariables,
  inCallingHours,
  formatCallMessage,
  ineligibleReason,
  nextCallTime,
  parseAllowlist,
  parseHours,
  toE164,
  verifyWebhookSignature,
} from "../ai-call";
import { HDR_ENTITY_ID, VERSATILE_ENTITY_ID } from "../shared";

const hours = { start: 9, end: 18 };

test("toE164 accepts US numbers in common formats and rejects the rest", () => {
  assert.equal(toE164("(323) 555-0142"), "+13235550142");
  assert.equal(toE164("323.555.0142"), "+13235550142");
  assert.equal(toE164("+1 323 555 0142"), "+13235550142");
  assert.equal(toE164("1-323-555-0142"), "+13235550142");
  assert.equal(toE164("555-0142"), null);
  assert.equal(toE164("023 555 0142"), null);
  assert.equal(toE164("+44 20 7946 0958"), null);
  assert.equal(toE164(null), null);
});

test("parseHours falls back to 9-18 on bad input", () => {
  assert.deepEqual(parseHours("8-20"), { start: 8, end: 20 });
  assert.deepEqual(parseHours(undefined), hours);
  assert.deepEqual(parseHours("20-8"), hours);
  assert.deepEqual(parseHours("nine"), hours);
});

test("nextCallTime dials after the delay inside calling hours", () => {
  // 10:00 PDT = 17:00Z
  assert.equal(nextCallTime(new Date("2026-10-01T17:00:00Z"), 2, hours).toISOString(), "2026-10-01T17:02:00.000Z");
});

test("nextCallTime pushes early-morning inquiries to 9am the same LA day", () => {
  // 6:30 PDT = 13:30Z -> 9:00 PDT = 16:00Z
  assert.equal(nextCallTime(new Date("2026-10-01T13:30:00Z"), 2, hours).toISOString(), "2026-10-01T16:00:00.000Z");
});

test("nextCallTime pushes evening inquiries to 9am the next LA day", () => {
  // 20:15 PDT Oct 1 = 03:15Z Oct 2 -> 9:00 PDT Oct 2 = 16:00Z
  assert.equal(nextCallTime(new Date("2026-10-02T03:15:00Z"), 2, hours).toISOString(), "2026-10-02T16:00:00.000Z");
  // 17:59 PDT plus a 2 minute delay lands after close.
  assert.equal(nextCallTime(new Date("2026-10-02T00:59:00Z"), 2, hours).toISOString(), "2026-10-02T16:00:00.000Z");
});

test("inCallingHours checks LA time at dial time", () => {
  assert.equal(inCallingHours(new Date("2026-10-01T16:00:00Z"), hours), true); // 9:00 PDT
  assert.equal(inCallingHours(new Date("2026-10-02T00:59:00Z"), hours), true); // 17:59 PDT
  assert.equal(inCallingHours(new Date("2026-10-02T01:00:00Z"), hours), false); // 18:00 PDT
  assert.equal(inCallingHours(new Date("2026-10-01T15:59:00Z"), hours), false); // 8:59 PDT
});

test("nextCallTime handles the November DST change", () => {
  // Sat Oct 31 2026 21:00 PDT = Nov 1 04:00Z. DST ends Nov 1, so 9:00 PST = 17:00Z.
  assert.equal(nextCallTime(new Date("2026-11-01T04:00:00Z"), 2, hours).toISOString(), "2026-11-01T17:00:00.000Z");
});

test("ineligibleReason only allows HDR site quote inquiries with a US phone", () => {
  const base = { entity_id: HDR_ENTITY_ID, source: "website", request_type: "inquiry", phone: "323-555-0142" };
  const on = { enabled: true, allowlist: [] };
  assert.equal(ineligibleReason(base, on), null);
  assert.equal(ineligibleReason(base, { enabled: false, allowlist: [] }), "disabled");
  assert.equal(ineligibleReason({ ...base, source: "hollywooddepot" }, on), "not an HDR site inquiry");
  assert.equal(ineligibleReason({ ...base, entity_id: VERSATILE_ENTITY_ID }, on), "not an HDR site inquiry");
  assert.equal(ineligibleReason({ ...base, request_type: "reservation" }, on), "not a quote inquiry");
  assert.equal(ineligibleReason({ ...base, phone: "n/a" }, on), "no valid US phone");
  assert.equal(ineligibleReason({ ...base, phone: "808-555-0142" }, on), "area code outside calling hours");
});

test("pilot allowlist restricts calls to listed numbers", () => {
  const allowlist = parseAllowlist("(310) 555-0100, junk");
  assert.deepEqual(allowlist, ["+13105550100"]);
  const base = { entity_id: HDR_ENTITY_ID, source: "website", request_type: "inquiry", phone: "323-555-0142" };
  assert.equal(ineligibleReason(base, { enabled: true, allowlist }), "not on pilot allowlist");
  assert.equal(ineligibleReason({ ...base, phone: "310-555-0100" }, { enabled: true, allowlist }), null);
});

test("dynamicVariables always fills every prompt variable", () => {
  const vars = dynamicVariables(
    { name: "Sarah Lopez", use_case: "Wedding", start_date: "2027-06-14", end_date: null, guests: "", location: "Malibu", notes: null },
    "call-1"
  );
  assert.deepEqual(vars, {
    customer_name: "Sarah",
    event_type: "Wedding",
    start_date: "2027-06-14",
    end_date: "2027-06-14",
    guests: "unknown",
    event_location: "Malibu",
    notes: "unknown",
    closebook_call_id: "call-1",
  });
  assert.equal(dynamicVariables({ name: null, use_case: null, start_date: null, end_date: null, guests: null, location: null, notes: null }, "x").customer_name, "there");
});

test("verifyWebhookSignature accepts a valid signature and rejects tampering or stale times", () => {
  const secret = "wsec_test";
  const body = '{"type":"post_call_transcription"}';
  const t = 1_790_000_000;
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const now = t * 1000;
  assert.equal(verifyWebhookSignature(body, `t=${t},v0=${sig}`, secret, now), true);
  assert.equal(verifyWebhookSignature(body + " ", `t=${t},v0=${sig}`, secret, now), false);
  assert.equal(verifyWebhookSignature(body, `t=${t},v0=${sig}`, "wrong", now), false);
  assert.equal(verifyWebhookSignature(body, `t=${t},v0=${sig}`, secret, now + 3600_000), false);
  assert.equal(verifyWebhookSignature(body, null, secret, now), false);
});

test("formatCallMessage puts the outcome, details and transcript on the card", () => {
  const { subject, body } = formatCallMessage({
    outcome: "completed",
    durationSecs: 72,
    hotLead: true,
    summary: "Sarah wants two trailers for a June wedding.",
    collected: { event_date: "June 14", event_times: "3pm-11pm", guest_count: 400, location: "Malibu", notes: "" },
    evaluation: { four_items: "success" },
    transcript: [
      { role: "agent", message: "Hi, is this Sarah?" },
      { role: "user", message: "Yes." },
    ],
    conversationId: "conv_1",
  });
  assert.equal(subject, "AI call · Completed · 1m 12s · HOT LEAD");
  assert.match(body, /Guests: 400/);
  assert.doesNotMatch(body, /Notes:/);
  assert.match(body, /HDR AI: Hi, is this Sarah\?\nCustomer: Yes\./);
  assert.match(body, /history\/conv_1$/);
});
