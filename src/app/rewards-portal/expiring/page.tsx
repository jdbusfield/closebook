import { homeHref, requireMember } from "@/lib/rewards/portal/server";
import { expiringLots, fmtDate, fmtPoints } from "@/lib/rewards/portal/view";
import { Label, Pill, StaffBanner, StripeCard, SubHeader } from "../_ui";

export const dynamic = "force-dynamic";

export default async function ExpiringPage() {
  const { base, session, view } = await requireMember();
  const lots = expiringLots(view, 60);
  const total = lots.reduce((s, l) => s + l.left, 0);
  // Name each batch by the invoice it came from.
  const source = (earnedOn: string, points: number) => {
    const r = view.rows.find((x) => x.earned_on === earnedOn && x.points === points && x.points > 0);
    if (!r) return "Points";
    return r.entry_type === "earn" && r.invoice_number ? `Invoice ${r.invoice_number}` : r.reason ?? "Points";
  };

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <SubHeader backHref={homeHref(base)} title="Expiring Points" />
      <div className="flex flex-col gap-5 px-5">
        <StripeCard>
          <Label>Expiring in the Next 60 Days</Label>
          <span className="text-[52px] font-semibold leading-[1.1]">{fmtPoints(total)}</span>
          <span className="text-[14px] text-[#BDBDBD]">
            Of {fmtPoints(view.balance.available)} Points to Spend · As of {fmtDate(view.asOf)}
          </span>
        </StripeCard>

        {lots.length > 0 && (
          <section aria-label="By date" className="flex flex-col">
            <Label className="pb-0.5">By Expiration Date</Label>
            {lots.map((l, i) => (
              <div key={`${l.earnedOn}-${i}`} className={`flex items-center justify-between py-2.5 ${i < lots.length - 1 ? "border-b border-[#222]" : ""}`}>
                <div className="flex flex-col">
                  <span className="text-[15px]">{fmtDate(l.expiresOn)}</span>
                  <span className="text-[12.5px] text-[#9A9A9A]">{source(l.earnedOn, l.points)}</span>
                </div>
                <span className="text-lg font-semibold">{fmtPoints(l.left)}</span>
              </div>
            ))}
          </section>
        )}

        <section aria-label="Expiry rules" className="flex flex-col gap-1.5 text-[13.5px] text-[#9A9A9A]">
          <span>Points Expire 12 Months After the Invoice Date</span>
          <span>Oldest Points Are Used First</span>
        </section>
      </div>

      <div className="mt-auto px-5 pb-7 pt-8">
        <Pill href={`${base}/rewards`} kind="red" block>
          Redeem Points
        </Pill>
      </div>
    </main>
  );
}
