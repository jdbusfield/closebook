/**
 * Member portal view model. Pure: ledger rows + program rules in, numbers the
 * screens show out. Customers never see preview (pre-launch) rows; a staff
 * "View With 2026 Preview" session treats them as live so the portal can be
 * checked against real invoices before launch.
 */

import {
  computeBalance,
  openLots,
  sortTiers,
  tierStatus,
  type Balance,
  type PointLot,
  type RewardsSettings,
  type TierDef,
  type TierStatus,
} from "../engine";

export interface ViewLedgerRow {
  id: string;
  entry_type: string;
  points: number;
  eligible_spend: number;
  invoice_number: string | null;
  invoice_date: string | null;
  invoice_status: string | null;
  tier_key: string | null;
  points_per_dollar: number | null;
  is_preview: boolean;
  is_available: boolean;
  earned_on: string;
  expires_on: string | null;
  redemption_id: string | null;
  reason: string | null;
  rw_invoice_id: string | null;
}

export interface YearTotals {
  spend: number;
  earned: number;
  redeemed: number;
  redemptions: number;
}

export interface MemberView {
  asOf: string;
  balance: Balance;
  lots: PointLot[];
  status: TierStatus;
  tiers: TierDef[];
  /** Ledger rows the customer sees, newest first. */
  rows: ViewLedgerRow[];
  byYear: Map<number, YearTotals>;
}

/** Rows as the customer sees them: preview hidden, or shown as live for a staff preview. */
export function visibleRows(rows: ViewLedgerRow[], settings: RewardsSettings, includePreview: boolean): ViewLedgerRow[] {
  if (!includePreview) return rows.filter((r) => !r.is_preview);
  return rows.map((r) =>
    r.is_preview
      ? { ...r, is_preview: false, is_available: settings.paidStatuses.includes((r.invoice_status ?? "").toUpperCase()) }
      : r,
  );
}

export function buildMemberView(
  allRows: ViewLedgerRow[],
  tiers: TierDef[],
  settings: RewardsSettings,
  today: string,
  includePreview: boolean,
): MemberView {
  const rows = visibleRows(allRows, settings, includePreview).sort(
    (a, b) => b.earned_on.localeCompare(a.earned_on) || (b.invoice_number ?? "").localeCompare(a.invoice_number ?? ""),
  );
  // Before launch a customer sees the program's first day; a preview session sees today.
  const asOf = !includePreview && today < settings.programStartDate ? settings.programStartDate : today;

  const entries = rows.map((r) => ({
    points: r.points,
    earnedOn: r.earned_on,
    expiresOn: r.expires_on,
    isAvailable: r.is_available,
    isPreview: false,
  }));

  const spendByYear = new Map<number, number>();
  const byYear = new Map<number, YearTotals>();
  const year = (iso: string) => Number(iso.slice(0, 4));
  for (const r of rows) {
    const y = year(r.invoice_date ?? r.earned_on);
    const t = byYear.get(y) ?? { spend: 0, earned: 0, redeemed: 0, redemptions: 0 };
    if (r.entry_type === "earn") {
      t.spend += Number(r.eligible_spend);
      t.earned += r.points;
      spendByYear.set(y, (spendByYear.get(y) ?? 0) + Number(r.eligible_spend));
    } else if (r.entry_type === "redeem") {
      t.redeemed += -r.points;
      t.redemptions += 1;
    } else if (r.entry_type === "redeem_reversal") {
      t.redeemed -= r.points;
      t.redemptions -= 1;
    } else if (r.points > 0) {
      t.earned += r.points;
    }
    byYear.set(y, t);
  }
  for (const t of byYear.values()) t.spend = Math.round(t.spend * 100) / 100;

  const statusSettings = includePreview ? { ...settings, programStartDate: settings.previewStartDate ?? settings.programStartDate } : settings;
  return {
    asOf,
    balance: computeBalance(entries, asOf),
    lots: openLots(entries, asOf),
    status: tierStatus(spendByYear, tiers, statusSettings, asOf),
    tiers: sortTiers(tiers),
    rows,
    byYear,
  };
}

/** Lots with points left that expire within `days` of asOf, soonest first. */
export function expiringLots(view: MemberView, days = 60): PointLot[] {
  const limit = new Date(Date.parse(view.asOf) + days * 864e5).toISOString().slice(0, 10);
  return view.lots.filter((l) => l.expiresOn && l.expiresOn <= limit).sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? ""));
}

// ── Formatting ───────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const fmtPoints = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtSignedPoints = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmtPoints(Math.abs(n));
export const fmtMoney = (n: number, cents = false) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
/** "Mar 12, 2027" */
export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "";
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
};
/** "Mar 12" */
export const fmtShortDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
/** "March 2027" */
export const fmtMonth = (iso: string) => `${MONTHS_LONG[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** "1.25 Points per $1" */
export const fmtRate = (ppd: number) => `${Number(ppd.toFixed(4))} ${ppd === 1 ? "Point" : "Points"} per $1`;
export const fmtMemberNumber = (n: number | null | undefined) => (n ? `VR-${n}` : "");
