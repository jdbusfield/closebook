import Link from "next/link";
import { redirect } from "next/navigation";
import { homeHref, requireMember } from "@/lib/rewards/portal/server";
import { fmtDate, fmtMoney, fmtRate } from "@/lib/rewards/portal/view";
import { markTierSeenAction } from "../actions";
import { Label, Logo, PillButton, Rows, StaffBanner, WAREHOUSE_PHOTO } from "../_ui";

export const dynamic = "force-dynamic";

export default async function TierReachedPage() {
  const { admin, base, session, member, view } = await requireMember();
  const { data: changes } = await admin
    .from("rewards_tier_changes")
    .select("id, to_tier_key, effective_on")
    .eq("member_id", member.id)
    .is("customer_seen_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const change = changes?.[0];
  const idx = change ? view.tiers.findIndex((t) => t.key === change.to_tier_key) : -1;
  if (!change || idx <= 0) redirect(homeHref(base));
  const tier = view.tiers[idx];
  const next = view.tiers[idx + 1] ?? null;
  const year = Number(change.effective_on.slice(0, 4));
  const spend = view.byYear.get(year)?.spend ?? view.status.qualifyingSpend;

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <section className="relative h-[360px] flex-none overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={WAREHOUSE_PHOTO} alt="Versatile Studios Warehouse" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "70% 35%" }} />
        <div aria-hidden="true" className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.2) 40%, #000 100%)" }} />
        <header className="relative flex h-16 items-center justify-between pl-5 pr-3">
          <Logo />
          <form action={markTierSeenAction}>
            <input type="hidden" name="next" value="home" />
            <button type="submit" aria-label="Close" className="flex h-11 w-11 cursor-pointer items-center justify-center text-white">
              <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </form>
        </header>
        <div className="absolute bottom-2.5 left-5 right-5 flex flex-col gap-1">
          <Label>Tier Reached</Label>
          <h1 className="text-[56px] font-semibold leading-[1.05]">{tier.name}</h1>
        </div>
      </section>

      <div className="px-5 pt-2">
        <Rows
          rows={[
            ["Effective", fmtDate(change.effective_on)],
            ["Good Through", `Dec 31, ${year + 1}`],
            ["New Earn Rate", fmtRate(tier.pointsPerDollar)],
            ["Rate Starts", "Next Invoice"],
            [`${year} Eligible Spend`, fmtMoney(spend)],
            ...(next ? [[`To ${next.name}`, fmtMoney(Math.max(0, next.minAnnualSpend - spend))] as [string, string]] : []),
          ]}
        />
      </div>

      <div className="mt-auto flex flex-col gap-2.5 px-5 pb-7 pt-8">
        <form action={markTierSeenAction}>
          <input type="hidden" name="next" value="perks" />
          <PillButton kind="white">See {tier.name} Perks</PillButton>
        </form>
        <form action={markTierSeenAction}>
          <input type="hidden" name="next" value="tiers" />
          <PillButton kind="outline">View All Tiers</PillButton>
        </form>
        <Link href={homeHref(base)} className="sr-only">
          Home
        </Link>
      </div>
    </main>
  );
}
