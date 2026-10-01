import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addCalendarDays, assertQuoteActionable, assertQuoteTermsCompatible, businessDate,
  calendarDate, prepareQuoteValidity, quoteIssueDate, quoteValidityText,
} from "../quote-validity";

const issued = new Date("2026-10-01T19:00:00Z");
const quote = (valid_until: string | null = "2026-10-02") => ({
  created_at: issued.toISOString(), valid_until, status: "draft",
});

test("October 1 issuance for October 3 event expires October 2", () => {
  assert.deepEqual(prepareQuoteValidity("2026-10-03", null, issued), quoteFields("2026-10-02"));
  assert.doesNotThrow(() => assertQuoteActionable(quote(), { start_date: "2026-10-03" }, issued));
});

function quoteFields(valid_until: string | null) {
  return { created_at: issued.toISOString(), valid_until };
}

test("three calendar days includes weekends and caps distant events at issuance+3", () => {
  assert.equal(prepareQuoteValidity("2026-10-20", undefined, issued).valid_until, "2026-10-04");
  assert.equal(addCalendarDays("2026-10-31", 3), "2026-11-03");
  assert.equal(addCalendarDays("2028-02-28", 3), "2028-03-02");
  assert.equal(addCalendarDays("2026-12-30", 3), "2027-01-02");
});

test("same-day, past, missing and free-text event dates yield review drafts", () => {
  for (const event of ["2026-10-01", "2026-09-30", null, "", "October 3", "2026-02-30", "2026-10-03T00:00:00Z"]) {
    assert.deepEqual(prepareQuoteValidity(event, null, issued), quoteFields(null));
    assert.throws(() => assertQuoteActionable(quote(null), { start_date: event }, issued), /review|exact event date/i);
  }
});

test("next-day event remains actionable through issuance day only", () => {
  const saved = prepareQuoteValidity("2026-10-02", null, issued);
  assert.equal(saved.valid_until, "2026-10-01");
  assert.doesNotThrow(() => assertQuoteActionable(saved, { start_date: "2026-10-02" }, new Date("2026-10-02T06:59:59.999Z")));
  assert.throws(() => assertQuoteActionable(saved, { start_date: "2026-10-02" }, new Date("2026-10-02T07:00:00Z")), /Same-day/);
});

test("expired acceptance/send rejects immediately after LA midnight", () => {
  const saved = quote("2026-10-02");
  const event = { start_date: "2026-10-10" };
  assert.doesNotThrow(() => assertQuoteActionable(saved, event, new Date("2026-10-03T06:59:59.999Z")));
  assert.throws(() => assertQuoteActionable(saved, event, new Date("2026-10-03T07:00:00Z")), /expired/);
});

test("null is default for new quotes, but legacy null is never unbounded", () => {
  assert.equal(prepareQuoteValidity("2026-10-03", null, issued).valid_until, "2026-10-02");
  assert.throws(() => assertQuoteActionable(quote(null), { start_date: "2026-10-03" }, issued), /validity is missing/);
  assert.match(quoteValidityText(quote(null)), /requires review/);
});

test("earlier custom expiry persists; late/invalid custom and legacy validity require review", () => {
  assert.equal(prepareQuoteValidity("2026-10-03", "2026-10-01", issued).valid_until, "2026-10-01");
  for (const expiry of ["2026-10-03", "2026-10-15", "2026-09-30", "2026-02-30", "nonsense"]) {
    assert.throws(() => prepareQuoteValidity("2026-10-03", expiry, issued));
    assert.throws(() => assertQuoteActionable(quote(expiry), { start_date: "2026-10-03" }, issued));
  }
});

test("persisted issuance is stable across UTC midnight and DST boundaries", () => {
  assert.equal(quoteIssueDate("2026-10-02T06:59:59Z"), "2026-10-01");
  assert.equal(quoteIssueDate("2026-10-02T07:00:00Z"), "2026-10-02");
  assert.equal(quoteIssueDate("2026-10-01T23:30:00-07:00"), "2026-10-01");
  assert.equal(businessDate(new Date("2026-03-08T07:59:59Z")), "2026-03-07");
  assert.equal(businessDate(new Date("2026-03-08T08:00:00Z")), "2026-03-08");
  assert.equal(prepareQuoteValidity("2026-03-20", null, new Date("2026-03-07T20:00:00Z")).valid_until, "2026-03-10");
  assert.equal(prepareQuoteValidity("2026-11-20", null, new Date("2026-10-31T19:00:00Z")).valid_until, "2026-11-03");
  assert.equal(quoteIssueDate("2026-10-01T12:00:00"), null);
  assert.equal(calendarDate("2026-02-29"), null);
});

test("future issuance and terminal quote states cannot send/accept", () => {
  for (const status of ["accepted", "declined", "expired"]) {
    assert.throws(() => assertQuoteActionable({ ...quote(), status }, { start_date: "2026-10-03" }, issued));
  }
  assert.throws(() => assertQuoteActionable(quote(), { start_date: "2026-10-03" }, new Date("2026-09-30T19:00:00Z")), /policy/);
});

test("legacy price promises are flagged without conflating inventory holds", () => {
  for (const text of [
    "The quote is good for 14 days", "This quote is valid for three days.",
    "Pricing is held for 3 calendar days.", "We will hold this price for fourteen days.",
    "Quoted pricing is guaranteed for 3 days", "Price is valid for three (3) days",
    "The pricing stands for 14 days from my first email",
  ]) assert.throws(() => assertQuoteTermsCompatible(text), /legacy quote terms/);
  for (const text of [
    "We hold inventory for 24 hours", "We hold your date for 48 hours",
    "Rental duration: 3 days", "Reply to confirm and we will hold your date.", quoteValidityText(quote()),
  ]) assert.doesNotThrow(() => assertQuoteTermsCompatible(text));
});
