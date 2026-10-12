// QuickBooks advertising charges for the restroom ad ROI view. Pure parsing
// lives here (unit-tested); the route does the fetching and joins the tags.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AdExpenseTag = "restroom_ads" | "other_ads" | "not_ads";
export const AD_EXPENSE_TAGS: AdExpenseTag[] = ["restroom_ads", "other_ads", "not_ads"];

export const AD_EXPENSE_TAG_LABEL: Record<AdExpenseTag, string> = {
  restroom_ads: "Restroom Trailer Ads",
  other_ads: "Other Brand Ads",
  not_ads: "Not Ads",
};

/** QBO transaction types that can carry an advertising expense line. */
export const AD_TXN_TYPES = ["Purchase", "Bill", "VendorCredit", "JournalEntry"] as const;
export type AdTxnType = (typeof AD_TXN_TYPES)[number];

export interface QboAdExpenseLine {
  entityId: string;
  entityName: string;
  txnType: AdTxnType;
  txnId: string;
  lineId: string;
  date: string; // YYYY-MM-DD
  docNumber: string | null;
  vendor: string | null;
  memo: string | null;
  account: string;
  className: string | null;
  /** Expense amount: positive = spend, negative = refund or credit. */
  amount: number;
  /** Ad platform the text points at, as a tagging hint only. */
  platformHint: "google" | "meta" | "chatgpt" | null;
}

const AD_ACCOUNT_RE = /advertis|marketing|promotion/i;

/** Ids of expense accounts that hold advertising, by name (sub-accounts included). */
export function adAccountIds(accounts: any[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of accounts) {
    const name = String(a.FullyQualifiedName ?? a.Name ?? "");
    const cls = String(a.Classification ?? "");
    if (cls && cls !== "Expense") continue;
    if (AD_ACCOUNT_RE.test(name)) out.set(String(a.Id), name);
  }
  return out;
}

export function platformHint(text: string): QboAdExpenseLine["platformHint"] {
  const t = text.toLowerCase();
  if (/google|adwords|gads/.test(t)) return "google";
  if (/facebook|\bfb\b|meta|instagram/.test(t)) return "meta";
  if (/openai|chatgpt/.test(t)) return "chatgpt";
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Advertising lines in one QBO transaction. Returns [] when none hit an ad account. */
export function adLinesFromTxn(
  txnType: AdTxnType,
  txn: any,
  accounts: Map<string, string>,
  entity: { id: string; name: string },
): QboAdExpenseLine[] {
  const out: QboAdExpenseLine[] = [];
  const header =
    txn.EntityRef?.name ?? txn.VendorRef?.name ?? null;
  // A card refund (Purchase with Credit=true) and a vendor credit reduce spend.
  const sign = txnType === "VendorCredit" || (txnType === "Purchase" && txn.Credit === true) ? -1 : 1;

  for (const line of txn.Line ?? []) {
    let accountId: string | undefined;
    let classRef: any;
    let lineSign = sign;
    let lineVendor: string | null = null;
    if (line.DetailType === "AccountBasedExpenseLineDetail") {
      accountId = line.AccountBasedExpenseLineDetail?.AccountRef?.value;
      classRef = line.AccountBasedExpenseLineDetail?.ClassRef;
    } else if (line.DetailType === "JournalEntryLineDetail") {
      const d = line.JournalEntryLineDetail ?? {};
      accountId = d.AccountRef?.value;
      classRef = d.ClassRef;
      lineSign = d.PostingType === "Credit" ? -1 : 1;
      lineVendor = d.Entity?.EntityRef?.name ?? null;
    } else {
      continue;
    }
    if (!accountId || !accounts.has(String(accountId))) continue;
    const amount = round2(lineSign * Number(line.Amount ?? 0));
    if (amount === 0) continue;
    const vendor = lineVendor ?? header;
    const memo = (line.Description || txn.PrivateNote || "").trim() || null;
    out.push({
      entityId: entity.id,
      entityName: entity.name,
      txnType,
      txnId: String(txn.Id),
      lineId: String(line.Id ?? ""),
      date: String(txn.TxnDate ?? "").slice(0, 10),
      docNumber: txn.DocNumber ?? null,
      vendor,
      memo,
      account: accounts.get(String(accountId)) ?? "",
      className: classRef?.name ?? null,
      amount,
      platformHint: platformHint(`${vendor ?? ""} ${memo ?? ""}`),
    });
  }
  return out;
}

export interface AdExpenseTagRow {
  entity_id: string;
  txn_type: string;
  txn_id: string;
  line_id: string;
  tag: AdExpenseTag;
  restroom_share: number;
  note: string | null;
}

export function tagKey(r: { entityId?: string; entity_id?: string; txnType?: string; txn_type?: string; txnId?: string; txn_id?: string; lineId?: string; line_id?: string }): string {
  return [r.entityId ?? r.entity_id, r.txnType ?? r.txn_type, r.txnId ?? r.txn_id, r.lineId ?? r.line_id ?? ""].join("|");
}

/** Restroom share of one line's amount under its tag (0 when untagged or not restroom). */
export function restroomAmount(amount: number, tag: AdExpenseTagRow | undefined): number {
  if (!tag || tag.tag !== "restroom_ads") return 0;
  return round2(amount * Number(tag.restroom_share ?? 1));
}
