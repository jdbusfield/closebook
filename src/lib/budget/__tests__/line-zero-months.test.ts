import { test } from "node:test";
import assert from "node:assert/strict";
import { applyZeroMonths, parseMonths } from "../line-zero-months";

test("parseMonths keeps 1-12, unique and sorted", () => {
  assert.deepEqual(parseMonths("12, 3,3, 0, 13, x, 7"), [3, 7, 12]);
  assert.deepEqual(parseMonths(null), []);
});

test("applyZeroMonths zeroes only the chosen months", () => {
  const m = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  assert.deepEqual(applyZeroMonths(m, [1, 12]), [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0]);
  assert.deepEqual(applyZeroMonths(m, []), m);
  assert.deepEqual(applyZeroMonths(m, undefined), m);
});
