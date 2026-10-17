import Link from "next/link";
import { fmtRate, fmtShortDate, fmtSignedPoints, type ViewLedgerRow } from "@/lib/rewards/portal/view";

export function rowTitle(r: ViewLedgerRow): string {
  switch (r.entry_type) {
    case "earn":
      return r.invoice_number ? `Invoice ${r.invoice_number}` : "Invoice";
    case "adjustment":
      return r.points >= 0 ? "Points Added" : "Points Removed";
    default:
      return r.reason ?? "Redemption";
  }
}

export function rowDetail(r: ViewLedgerRow): string {
  const date = fmtShortDate(r.earned_on);
  if (r.entry_type === "earn") {
    if (r.points < 0) return `${date} · Invoice Credit`;
    if (!r.is_available) return `${date} · Pending Payment`;
    return `${date} · ${r.points_per_dollar ? fmtRate(Number(r.points_per_dollar)).replace(" Points", "").replace(" Point", "") : ""}`;
  }
  if (r.entry_type === "redeem") return `${date} · Redeemed`;
  if (r.entry_type === "redeem_reversal") return `${date} · Cancelled, Points Returned`;
  if (r.entry_type === "redeem_refund") return `${date} · Points Back`;
  return r.reason ? `${date} · ${r.reason}` : date;
}

export function rowHref(base: string, r: ViewLedgerRow): string | null {
  if (r.entry_type === "earn") return `${base}/invoice/${r.id}`;
  if (r.redemption_id) return `${base}/redemptions/${r.redemption_id}`;
  return null;
}

export function LedgerItem({ base, row, last = false }: { base: string; row: ViewLedgerRow; last?: boolean }) {
  const pending = row.entry_type === "earn" && !row.is_available;
  const color = row.points < 0 ? "text-[#FF3B42]" : pending ? "text-[#9A9A9A]" : "text-white";
  const inner = (
    <>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[15px]">{rowTitle(row)}</span>
        <span className="text-[12.5px] text-[#9A9A9A]">{rowDetail(row)}</span>
      </div>
      <span className={`flex-none text-lg font-semibold ${color}`}>{fmtSignedPoints(row.points)}</span>
    </>
  );
  const cls = `flex items-center justify-between gap-3 py-2.5 ${last ? "" : "border-b border-[#222]"}`;
  const href = rowHref(base, row);
  return href ? (
    <Link href={href} className={`${cls} text-white no-underline`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
