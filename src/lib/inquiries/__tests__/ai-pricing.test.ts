import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_AI_PRICING as P,
  categoryFor,
  formQuote,
  guestBands,
  normalizePricing,
  quoteTrailers,
  parseGuests,
  rentalDays,
  saySentence,
  spokenAmounts,
  trailersFor,
} from "../ai-pricing";

test("trailers = ceil(guests / 200), at least one", () => {
  assert.equal(trailersFor(1, 200), 1);
  assert.equal(trailersFor(150, 200), 1);
  assert.equal(trailersFor(200, 200), 1);
  assert.equal(trailersFor(201, 200), 2);
  assert.equal(trailersFor(400, 200), 2);
  assert.equal(trailersFor(450, 200), 3);
  assert.equal(trailersFor(0, 200), 1);
});

test("rentalDays counts both ends and rejects reversed or bad dates", () => {
  assert.equal(rentalDays("2026-10-15", "2026-10-17"), 3);
  assert.equal(rentalDays("2026-10-15"), 1);
  assert.equal(rentalDays("2026-10-15", ""), 1);
  assert.equal(rentalDays("2026-10-31", "2026-11-01"), 2);
  assert.equal(rentalDays("2026-11-01", "2026-11-02"), 2); // across the DST change
  assert.equal(rentalDays("2026-10-17", "2026-10-15"), null);
  assert.equal(rentalDays("Oct 15", "Oct 17"), null);
});

test("categoryFor: weddings and unknowns are events, backyard/private are private", () => {
  assert.equal(categoryFor("Wedding"), "event");
  assert.equal(categoryFor("Backyard wedding"), "event");
  assert.equal(categoryFor("backyard party"), "private");
  assert.equal(categoryFor("Private party"), "private");
  assert.equal(categoryFor("Birthday"), "private");
  assert.equal(categoryFor("Corporate event"), "event");
  assert.equal(categoryFor(""), "event");
  assert.equal(categoryFor(undefined), "event");
});

// The worked examples from the agent prompt, plus the 450-guest case the
// agent got wrong on Oct 5 (it said 2 trailers, about $3,200).
test("quotes match JD's worked examples", () => {
  const wedding3 = quoteTrailers({ category: "event", guests: 150, days: 3 }, P);
  assert.equal(wedding3.trailers, 1);
  assert.equal(wedding3.total, 1549);
  assert.equal(wedding3.say_total, 1549);

  const wedding400 = quoteTrailers({ category: "event", guests: 400, days: 1 }, P);
  assert.equal(wedding400.trailers, 2);
  assert.equal(wedding400.discount_pct, 10);
  assert.equal(wedding400.total, 2248.2);
  assert.equal(wedding400.say_total, 2250);

  const backyard = quoteTrailers({ category: "private", guests: 120, days: 3 }, P);
  assert.equal(backyard.total, 1149);

  const corp450 = quoteTrailers({ category: "event", guests: 450, days: 2 }, P);
  assert.equal(corp450.trailers, 3);
  assert.equal(corp450.discount_pct, 20);
  assert.equal(corp450.per_trailer, 1119.2);
  assert.equal(corp450.total, 3357.6);
  assert.equal(corp450.say_total, 3360);

  const big = quoteTrailers({ category: "event", guests: 900, days: 1 }, P);
  assert.equal(big.trailers, 5);
  assert.equal(big.discount_pct, 25);
  assert.equal(big.total, 4683.75);
});

test("attendant applies the minimum hours once per event", () => {
  const q = quoteTrailers({ category: "private", guests: 100, days: 1, attendantHours: 4 }, P);
  assert.equal(q.attendant_hours, 6);
  assert.equal(q.attendant_total, 300);
  assert.equal(q.total, 1149);
  const none = quoteTrailers({ category: "private", guests: 100, days: 1 }, P);
  assert.equal(none.attendant_total, 0);
});

test("normalizePricing reads numeric strings and falls back to defaults", () => {
  const p = normalizePricing({ event_first_day: "1299", guests_per_trailer: 180, discount_2_pct: null });
  assert.equal(p.event_first_day, 1299);
  assert.equal(p.guests_per_trailer, 180);
  assert.equal(p.discount_2_pct, 10);
  assert.deepEqual(normalizePricing(null), P);
});

test("guestBands follow guests_per_trailer", () => {
  const bands = guestBands(P, 3);
  assert.deepEqual(bands.map((b) => b.label), ["1–200", "201–400", "401–600"]);
  assert.deepEqual(bands.map((b) => b.trailers), [1, 2, 3]);
});

test("formQuote prices the website form, or null when it can't", () => {
  // Steve, Oct 6: wedding, 150 guests, one day. The agent guessed $3,000.
  const steve = formQuote({ use_case: "Wedding", guests: "150", start_date: "2027-04-10", end_date: "2027-04-10" }, P);
  assert.ok(steve);
  assert.equal(steve.say_total, 1249);
  assert.equal(saySentence(steve), "For 150 guests we'd recommend one 4-stall trailer. We'd typically quote around $1,249 for the day.");
  const range = formQuote({ use_case: "Corporate", guests: "300-450", start_date: "2026-12-04", end_date: "2026-12-05" }, P);
  assert.equal(range?.trailers, 3);
  assert.equal(saySentence(range!), "For 450 guests we'd recommend three 4-stall trailers. We'd typically quote around $3,360 for the 2-day rental.");
  assert.equal(formQuote({ use_case: "Wedding", guests: "", start_date: "2027-04-10", end_date: null }, P), null);
  assert.equal(formQuote({ use_case: "Wedding", guests: "150", start_date: null, end_date: null }, P), null);
  assert.equal(parseGuests("about 1,200 people"), 1200);
  assert.equal(parseGuests("unknown"), null);
});

test("spokenAmounts finds prices in digits and words, not guest counts", () => {
  assert.deepEqual(spokenAmounts("So we'd typically quote around three thousand dollars for that day"), [3000]);
  assert.deepEqual(spokenAmounts("We'd typically quote around $1,249 for the day."), [1249]);
  assert.deepEqual(spokenAmounts("around thirty-three sixty for the two-day rental"), [3360]);
  assert.deepEqual(spokenAmounts("around twelve forty-nine for the day"), [1249]);
  assert.deepEqual(spokenAmounts("around eight hundred forty-nine dollars"), [849]);
  assert.deepEqual(spokenAmounts("around eleven hundred forty-nine"), [1149]);
  assert.deepEqual(spokenAmounts("I have April tenth with one hundred fifty guests in the nine two five zero four area"), []);
  assert.deepEqual(spokenAmounts("For 450 guests we'd recommend three 4-stall trailers."), []);
});
