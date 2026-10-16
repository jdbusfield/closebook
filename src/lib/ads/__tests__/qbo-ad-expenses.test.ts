import assert from "node:assert/strict";
import { test } from "node:test";
import { adAccountIds, adLinesFromTxn, platformHint, restroomAmount, tagKey } from "../qbo-ad-expenses";

const entity = { id: "e1", name: "Hollywood Depot Rentals" };
const accounts = adAccountIds([
  { Id: "10", Name: "Advertising and Promotion", FullyQualifiedName: "Advertising and Promotion", Classification: "Expense" },
  { Id: "11", Name: "Online Ads", FullyQualifiedName: "Marketing:Online Ads", Classification: "Expense" },
  { Id: "12", Name: "Rent", FullyQualifiedName: "Rent", Classification: "Expense" },
  { Id: "13", Name: "Marketing Receivable", FullyQualifiedName: "Marketing Receivable", Classification: "Asset" },
]);

test("advertising accounts match by full name, expense only", () => {
  assert.deepEqual([...accounts.keys()].sort(), ["10", "11"]);
});

test("card purchase keeps ad lines only, with vendor and class", () => {
  const lines = adLinesFromTxn(
    "Purchase",
    {
      Id: "501",
      TxnDate: "2026-09-03",
      EntityRef: { name: "Google" },
      Line: [
        { Id: "1", Amount: 812.4, Description: "Google Ads Aug", DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "10" }, ClassRef: { name: "Overhead" } } },
        { Id: "2", Amount: 50, DetailType: "AccountBasedExpenseLineDetail",
          AccountBasedExpenseLineDetail: { AccountRef: { value: "12" } } },
      ],
    },
    accounts,
    entity,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, 812.4);
  assert.equal(lines[0].vendor, "Google");
  assert.equal(lines[0].className, "Overhead");
  assert.equal(lines[0].account, "Advertising and Promotion");
  assert.equal(lines[0].platformHint, "google");
});

test("card refunds and vendor credits reduce spend", () => {
  const refund = adLinesFromTxn(
    "Purchase",
    { Id: "7", TxnDate: "2026-09-10", Credit: true, Line: [
      { Id: "1", Amount: 20, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "11" } } },
    ] },
    accounts,
    entity,
  );
  assert.equal(refund[0].amount, -20);
  const credit = adLinesFromTxn(
    "VendorCredit",
    { Id: "8", TxnDate: "2026-09-10", VendorRef: { name: "Meta Platforms" }, Line: [
      { Id: "1", Amount: 15, DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: "10" } } },
    ] },
    accounts,
    entity,
  );
  assert.equal(credit[0].amount, -15);
  assert.equal(credit[0].platformHint, "meta");
});

test("journal entries sign by posting type", () => {
  const lines = adLinesFromTxn(
    "JournalEntry",
    { Id: "9", TxnDate: "2026-08-31", Line: [
      { Id: "0", Amount: 300, DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "10" } } },
      { Id: "1", Amount: 100, DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "10" } } },
      { Id: "2", Amount: 200, DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "99" } } },
    ] },
    accounts,
    entity,
  );
  assert.deepEqual(lines.map((l) => l.amount), [300, -100]);
});

test("restroom amount applies the tag share", () => {
  const base = { entity_id: "e1", txn_type: "Purchase", txn_id: "1", line_id: "1", note: null };
  assert.equal(restroomAmount(1000, { ...base, tag: "restroom_ads", restroom_share: 0.6 }), 600);
  assert.equal(restroomAmount(1000, { ...base, tag: "other_ads", restroom_share: 0 }), 0);
  assert.equal(restroomAmount(1000, undefined), 0);
});

test("tag key is the same for a line and its tag row", () => {
  assert.equal(
    tagKey({ entityId: "e1", txnType: "Bill", txnId: "4", lineId: "2" }),
    tagKey({ entity_id: "e1", txn_type: "Bill", txn_id: "4", line_id: "2" }),
  );
  assert.equal(platformHint("OPENAI *CHATGPT ADS"), "chatgpt");
  assert.equal(platformHint("Staples"), null);
});
