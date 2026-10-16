import { homeHref, requireMember } from "@/lib/rewards/portal/server";
import { fmtDate, fmtMoney, fmtRate } from "@/lib/rewards/portal/view";
import { Label, ProgressBar, StaffBanner, SubHeader } from "../_ui";

export const dynamic = "force-dynamic";

export default async function TiersPage() {
  const { base, session, member, view } = await requireMember();
  const { status } = view;
  const year = status.qualifyingYear;
  const lowest = view.tiers[0];

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <SubHeader backHref={homeHref(base)} title="Tiers" />
      <div className="flex flex-col gap-2.5 px-5">
        <div className="flex justify-between pb-1 text-[14px] text-[#BDBDBD]">
          <span>{year} Eligible Spend</span>
          <span className="font-semibold text-white">{fmtMoney(status.qualifyingSpend)}</span>
        </div>

        {[...view.tiers].reverse().map((t) => {
          const current = t.key === status.tier.key;
          const isNext = status.next?.key === t.key;
          const threshold = t.key === lowest.key ? "Every Account" : `${fmtMoney(t.minAnnualSpend)} per Year`;
          if (current) {
            return (
              <section key={t.key} aria-label={`${t.name}, current tier`} className="overflow-hidden rounded-lg border-2 border-white bg-[#121212]">
                <div className="flex flex-col gap-2 px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <Label>Current Tier</Label>
                      <span className="text-[26px] font-semibold">{t.name}</span>
                      <span className="text-[13.5px] text-[#9A9A9A]">{threshold}</span>
                    </div>
                    <span className="text-right text-[15px]">{fmtRate(t.pointsPerDollar)}</span>
                  </div>
                  {t.key !== lowest.key && (
                    <div className="flex flex-col gap-1 border-t border-[#2A2A2A] pt-2 text-[14px]">
                      {member.tier_effective_on && (
                        <div className="flex justify-between">
                          <span className="text-[#9A9A9A]">Reached</span>
                          <span>{fmtDate(member.tier_effective_on)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-[#9A9A9A]">Good Through</span>
                        <span>{fmtDate(status.expiresOn)}</span>
                      </div>
                      {status.spendToKeep > 0 && (
                        <div className="flex justify-between">
                          <span className="text-[#9A9A9A]">To Keep It Next Year</span>
                          <span>{fmtMoney(status.spendToKeep)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="h-1.5 bg-[#D2232A]" />
              </section>
            );
          }
          return (
            <section key={t.key} aria-label={t.name} className="flex flex-col gap-2.5 rounded-lg border border-[#2A2A2A] px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-xl font-semibold">{t.name}</span>
                  <span className="text-[13.5px] text-[#9A9A9A]">{threshold}</span>
                </div>
                <span className="text-right text-[15px]">{fmtRate(t.pointsPerDollar)}</span>
              </div>
              {isNext && (
                <>
                  <ProgressBar pct={(status.qualifyingSpend / t.minAnnualSpend) * 100} />
                  <span className="text-[13.5px] text-[#BDBDBD]">{fmtMoney(status.spendToNext ?? 0)} to Go</span>
                </>
              )}
            </section>
          );
        })}
      </div>

      <section aria-label="Tier rules" className="mt-auto flex flex-col gap-1.5 px-5 pb-8 pt-8 text-[13.5px] text-[#9A9A9A]">
        <span className="font-semibold text-white">Tier Rules</span>
        <span>Based on Eligible Spend, Jan 1 to Dec 31</span>
        <span>Tier Lasts Through the End of the Next Year</span>
        <span>New Rate Starts With the Next Invoice</span>
      </section>
    </main>
  );
}
