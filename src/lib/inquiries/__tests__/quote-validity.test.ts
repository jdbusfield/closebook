import assert from "node:assert/strict";
import { test } from "node:test";
import { assertQuoteNotExpired, prepareQuoteValidity, quoteIssueDate, quoteValidityText } from "../quote-validity";

const issued = new Date("2026-10-01T19:00:00Z");

test("default is issue date plus three calendar days, capped before event", () => {
  assert.equal(prepareQuoteValidity("2026-10-20", null, issued).valid_until, "2026-10-04");
  assert.deepEqual(prepareQuoteValidity("2026-10-03", null, issued), {
    created_at: issued.toISOString(), valid_until: "2026-10-02",
  });
  assert.equal(prepareQuoteValidity("2026-10-02", null, issued).valid_until, "2026-10-01");
});

test("calendar addition crosses month/year boundaries and leap day", () => {
  for (const [created, event, expected] of [
    ["2026-01-30T20:00:00Z", "2026-02-20", "2026-02-02"],
    ["2026-12-30T20:00:00Z", "2027-01-20", "2027-01-02"],
    ["2028-02-28T20:00:00Z", "2028-03-20", "2028-03-02"],
  ]) assert.equal(prepareQuoteValidity(event, null, new Date(created)).valid_until, expected);
});

test("LA issuance and calendar arithmetic remain stable around UTC midnight and DST", () => {
  assert.equal(quoteIssueDate("2026-10-02T06:59:59Z"), "2026-10-01");
  assert.equal(quoteIssueDate("2026-10-02T07:00:00Z"), "2026-10-02");
  assert.equal(prepareQuoteValidity("2026-03-20", null, new Date("2026-03-07T20:00:00Z")).valid_until, "2026-03-10");
  assert.equal(prepareQuoteValidity("2026-11-20", null, new Date("2026-10-31T19:00:00Z")).valid_until, "2026-11-03");
});

test("missing, invalid, same-day and earlier event dates have no default expiry", () => {
  for (const event of [null, undefined, "", "October 3", "2026-02-30", "2026-10-01", "2026-09-30"]) {
    assert.equal(prepareQuoteValidity(event, null, issued).valid_until, null);
  }
});

test("explicit custom dates are retained rather than replaced by the default", () => {
  assert.equal(prepareQuoteValidity("2026-10-03", "2026-10-15", issued).valid_until, "2026-10-15");
  assert.equal(prepareQuoteValidity(null, "2026-10-02", issued).valid_until, "2026-10-02");
  assert.equal(prepareQuoteValidity("2026-10-03", "", issued).valid_until, "2026-10-02");
});

test("expired sent/accepted refusal uses the saved deadline and exact message", () => {
  const quote = { valid_until: "2026-10-02" };
  assert.doesNotThrow(() => assertQuoteNotExpired(quote, new Date("2026-10-03T06:59:59.999Z")));
  assert.throws(() => assertQuoteNotExpired(quote, new Date("2026-10-03T07:00:00Z")), {
    message: "This quote expired on Oct 2, 2026. Issue a new quote.",
  });
});

test("expiration honors the midnight following a DST transition", () => {
  assert.doesNotThrow(() => assertQuoteNotExpired({ valid_until: "2026-03-08" }, new Date("2026-03-09T06:59:59Z")));
  assert.throws(() => assertQuoteNotExpired({ valid_until: "2026-03-08" }, new Date("2026-03-09T07:00:00Z")));
  assert.doesNotThrow(() => assertQuoteNotExpired({ valid_until: "2026-11-01" }, new Date("2026-11-02T07:59:59Z")));
  assert.throws(() => assertQuoteNotExpired({ valid_until: "2026-11-01" }, new Date("2026-11-02T08:00:00Z")));
});

test("legacy dates remain authoritative; null has no expiry to reject", () => {
  const legacy = { valid_until: "2026-10-15" };
  assert.doesNotThrow(() => assertQuoteNotExpired(legacy, new Date("2026-10-10T19:00:00Z")));
  assert.equal(legacy.valid_until, "2026-10-15");
  assert.doesNotThrow(() => assertQuoteNotExpired({ valid_until: null }, issued));
  assert.equal(quoteValidityText(legacy), "Pricing valid through Oct 15, 2026.");
});
