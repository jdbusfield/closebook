import { notFound } from "next/navigation";
import { requireMember } from "@/lib/rewards/portal/server";
import { fetchAll } from "@/lib/rewards/run";
import { fmtDate, fmtMoney, fmtRate, fmtSignedPoints } from "@/lib/rewards/portal/view";
import { Label, Rows, StaffBanner, StripeCard, SubHeader } from "../../_ui";

export const dynamic = "force-dynamic";

const REC_LABEL: Record<string, string> = {
  R: "Rental",
  S: "Sales and Expendables",
  M: "Misc Charges",
  L: "Labor",
  F: "Fees",
};

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { admin, base, session, settings, view, tierName } = await requireMember();
  // Only rows in this member's own ledger can be opened.
  const row = view.rows.find((r) => r.id === id && r.entry_type === "earn");
  if (!row) notFound();

  const [{ data: inv }, { data: items }] = row.rw_invoice_id
    ? await Promise.all([
        admin.from("rw_invoices_cache").select("sub_total").eq("rw_invoice_id", row.rw_invoice_id).maybeSingle(),
        fetchAll((from, to) =>
          admin.from("rw_invoice_items").select("id, rec_type, i_code, extended").eq("rw_invoice_id", row.rw_invoice_id!).order("id").range(from, to),
        ).then((data) => ({ data })),
      ])
    : [{ data: null }, { data: [] }];

  const eligibleTypes = new Set(settings.eligibleRecTypes);
  const excluded = new Set(settings.excludedICodes);
  const groups = new Map<string, { label: string; amount: number; counts: boolean }>();
  for (const it of items ?? []) {
    const rec = (it.rec_type ?? "").toUpperCase();
    const counts = eligibleTypes.has(rec) && !excluded.has((it.i_code ?? "").trim().toUpperCase());
    const label = (REC_LABEL[rec] ?? "Other") + (eligibleTypes.has(rec) && !counts ? ", Excluded Items" : "");
    const key = `${label}|${counts}`;
    const g = groups.get(key) ?? { label, amount: 0, counts };
    g.amount += Math.abs(Number(it.extended) || 0);
    groups.set(key, g);
  }
  const lines = [...groups.values()].sort((a, b) => Number(b.counts) - Number(a.counts) || b.amount - a.amount);

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <SubHeader backHref={`${base}/activity`} title={`Invoice ${row.invoice_number ?? ""}`} />
      <div className="flex flex-col gap-5 px-5 pb-8">
        <StripeCard>
          <Label>{row.points >= 0 ? "Points Earned" : "Points Taken Back"}</Label>
          <span className="text-[52px] font-semibold leading-[1.1]">{fmtSignedPoints(row.points)}</span>
          <span className="text-[14px] text-[#BDBDBD]">{row.is_available ? "Paid · Spendable" : "Pending Payment"}</span>
        </StripeCard>

        <Rows
          rows={[
            ["Invoice Date", fmtDate(row.invoice_date)],
            ...(inv ? [["Subtotal Before Tax", fmtMoney(Number(inv.sub_total), true)] as [string, string]] : []),
            ["Eligible Spend", fmtMoney(Number(row.eligible_spend), true)],
            ["Tier on Invoice Date", tierName(row.tier_key)],
            ["Earn Rate", row.points_per_dollar ? fmtRate(Number(row.points_per_dollar)) : ""],
            ...(row.points > 0 ? [["Points Expire", fmtDate(row.expires_on)] as [string, string]] : []),
          ]}
        />

        {lines.length > 0 && (
          <section aria-label="What counts" className="flex flex-col">
            <Label className="pb-1">What Counts</Label>
            {lines.map((l, i) => (
              <div key={l.label + l.counts} className={`flex items-center justify-between py-2 text-[15px] ${i < lines.length - 1 ? "border-b border-[#222]" : ""}`}>
                <span className={l.counts ? "" : "text-[#9A9A9A]"}>{l.label}</span>
                <span className="flex gap-3">
                  <span className={l.counts ? "" : "text-[#9A9A9A]"}>{fmtMoney(l.amount, true)}</span>
                  <span className={l.counts ? "font-semibold" : "text-[#9A9A9A]"}>{l.counts ? "Counts" : "Not Counted"}</span>
                </span>
              </div>
            ))}
            <span className="pt-2 text-[12.5px] text-[#8C8C8C]">Line Totals Before Discounts. Points Use the Discounted Amount.</span>
          </section>
        )}

        <p className="text-[14px] text-[#9A9A9A]">
          Questions:{" "}
          <a href="tel:+12139358124" className="font-semibold text-white no-underline">
            213.935.8124
          </a>
        </p>
      </div>
    </main>
  );
}
