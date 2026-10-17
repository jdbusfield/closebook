import { notFound } from "next/navigation";
import { homeHref, requireMember } from "@/lib/rewards/portal/server";
import { tierForSpend } from "@/lib/rewards/engine";
import { fmtMoney, fmtPoints } from "@/lib/rewards/portal/view";
import { Label, Pill, Rows, StaffBanner, StripeCard, SubHeader } from "../../_ui";

export const dynamic = "force-dynamic";

export default async function YearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: raw } = await params;
  const year = Number(raw);
  const { base, session, view } = await requireMember();
  const totals = view.byYear.get(year);
  if (!Number.isInteger(year) || !totals) notFound();

  const earnedTier = tierForSpend(view.tiers, totals.spend);
  const lowest = view.tiers[0];
  const top = view.tiers[view.tiers.length - 1];

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <SubHeader backHref={homeHref(base)} title={`${year} Summary`} />
      <div className="flex flex-col gap-[18px] px-5">
        <StripeCard>
          <Label>Your {year + 1} Tier</Label>
          <span className="text-[46px] font-semibold leading-[1.1]">{earnedTier.name}</span>
          <span className="text-[14px] text-[#BDBDBD]">{earnedTier.key === lowest.key ? "Every Account" : `Good Through Dec 31, ${year + 1}`}</span>
        </StripeCard>

        <section aria-label={`${year} totals`} className="grid grid-cols-2 gap-2">
          {[
            ["Eligible Spend", fmtMoney(totals.spend)],
            ["Points Earned", fmtPoints(totals.earned)],
            ["Points Redeemed", fmtPoints(totals.redeemed)],
            ["Rewards Redeemed", String(totals.redemptions)],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col rounded-lg border border-[#2A2A2A] px-3.5 py-3">
              <span className="text-[12.5px] text-[#9A9A9A]">{k}</span>
              <span className="text-[22px] font-semibold">{v}</span>
            </div>
          ))}
        </section>

        <section aria-label={String(year + 1)} className="flex flex-col">
          <Label className="pb-0.5">{year + 1}</Label>
          <Rows
            rows={[
              ["Spend Count Restarts", `Jan 1, ${year + 1}`],
              ...(earnedTier.key !== lowest.key ? [[`Keep ${earnedTier.name} Into ${year + 2}`, `${fmtMoney(earnedTier.minAnnualSpend)} Spend`] as [string, string]] : []),
              ...(earnedTier.key !== top.key ? [[`Reach ${top.name}`, `${fmtMoney(top.minAnnualSpend)} Spend`] as [string, string]] : []),
              ["Points to Spend", fmtPoints(view.balance.available)],
            ]}
          />
        </section>
      </div>

      <div className="mt-auto px-5 pb-7 pt-8">
        <Pill href={`${base}/expiring`} block>
          See Expiring Points
        </Pill>
      </div>
    </main>
  );
}
