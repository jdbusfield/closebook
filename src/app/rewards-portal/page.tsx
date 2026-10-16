import Link from "next/link";
import { requireMember } from "@/lib/rewards/portal/server";
import { fmtDate, fmtMoney, fmtPoints } from "@/lib/rewards/portal/view";
import { Chevron, Label, Logo, Pill, ProgressBar, StaffBanner, WAREHOUSE_PHOTO } from "./_ui";
import { LedgerItem } from "./_ledger";

export const dynamic = "force-dynamic";

export default async function PortalHome() {
  const { admin, base, session, member, settings, view, tierName, today } = await requireMember();
  const { status, balance } = view;
  const next = status.next;
  const pct = next ? (status.qualifyingSpend / next.minAnnualSpend) * 100 : 100;
  const beforeLaunch = !session.includePreview && today < settings.programStartDate;

  const { data: unseen } = await admin
    .from("rewards_tier_changes")
    .select("id, to_tier_key")
    .eq("member_id", member.id)
    .is("customer_seen_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const reached = unseen?.[0] && view.tiers.findIndex((t) => t.key === unseen[0].to_tier_key) > 0 ? unseen[0] : null;
  const prevYear = Number(view.asOf.slice(0, 4)) - 1;
  const hasPrevYear = (view.byYear.get(prevYear)?.earned ?? 0) > 0;
  const initials = member.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <section className="relative h-[236px] flex-none overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={WAREHOUSE_PHOTO} alt="Versatile Studios Warehouse" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "62% 30%" }} />
        <div aria-hidden="true" className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 40%, #000 100%)" }} />
        <header className="relative flex h-16 items-center justify-between px-5">
          <Logo />
          <Link
            href={`${base}/account`}
            aria-label="Account"
            className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white text-[15px] font-semibold text-white no-underline"
          >
            {initials}
          </Link>
        </header>
        <div className="absolute bottom-3.5 left-5 right-5 flex flex-col gap-1">
          <Label>{member.name}</Label>
          <h1 className="text-4xl font-semibold leading-[1.1]">{tierName(status.tier.key)} Member</h1>
        </div>
      </section>

      <div className="flex flex-1 flex-col gap-[18px] px-5 pb-8 pt-2">
        {reached && (
          <Link href={`${base}/tier-reached`} className="flex items-center justify-between rounded-lg bg-[#D2232A] px-4 py-3 text-white no-underline">
            <span className="font-semibold">Tier Reached: {tierName(reached.to_tier_key)}</span>
            <Chevron />
          </Link>
        )}

        <section aria-label="Points" className="relative overflow-hidden rounded-lg border border-[#2A2A2A] bg-[#121212]">
          <div className="flex flex-col gap-0.5 px-[18px] pb-4 pt-[18px]">
            <Label>Points to Spend</Label>
            <span className="text-[60px] font-semibold leading-[1.05]">{fmtPoints(balance.available)}</span>
            {balance.pending > 0 && <span className="text-[14px] text-[#BDBDBD]">{fmtPoints(balance.pending)} Pending Payment</span>}
            {beforeLaunch && <span className="text-[14px] text-[#BDBDBD]">Points Start {fmtDate(settings.programStartDate)}</span>}
          </div>
          <div className="h-1.5 bg-[#D2232A]" />
        </section>

        <section aria-label="Next tier" className="flex flex-col gap-2.5">
          <div className="flex items-end justify-between">
            <div className="flex flex-col">
              <Label>{next ? "Next Tier" : "Top Tier"}</Label>
              <span className="text-[28px] font-semibold leading-[1.15]">{next ? next.name : status.tier.name}</span>
            </div>
            <Link href={`${base}/tiers`} className="flex items-center gap-1 pb-0.5 text-[15px] text-[#BDBDBD] no-underline">
              {next ? `${fmtMoney(status.spendToNext ?? 0)} to Go` : `${fmtMoney(status.qualifyingSpend)} Spent`}
              <Chevron />
            </Link>
          </div>
          <ProgressBar pct={pct} />
          <div className="flex justify-between text-[12.5px] font-semibold text-[#8C8C8C]">
            {view.tiers.map((t) => (
              <span key={t.key} className={t.key === status.tier.key ? "text-white" : ""}>
                {t.name}
              </span>
            ))}
          </div>
        </section>

        <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
          <Pill href={`${base}/rewards`} kind="white">
            Redeem
          </Pill>
          <Pill href={`${base}/perks`}>My Perks</Pill>
          <Pill href={`${base}/activity`}>Activity</Pill>
        </nav>

        {balance.expiringSoon > 0 && (
          <Link href={`${base}/expiring`} className="flex items-center justify-between border-y border-[#262626] py-3 text-white no-underline">
            <span className="text-[15px]">{fmtPoints(balance.expiringSoon)} Points Expire Within 60 Days</span>
            <Chevron />
          </Link>
        )}

        <section aria-label="Recent activity" className="flex flex-col">
          {view.rows.length === 0 ? (
            <p className="border-t border-[#262626] pt-3 text-[14px] text-[#9A9A9A]">No Activity Yet</p>
          ) : (
            <div className="border-t border-[#262626]">
              {view.rows.slice(0, 3).map((r, i, a) => (
                <LedgerItem key={r.id} base={base} row={r} last={i === a.length - 1} />
              ))}
            </div>
          )}
        </section>

        {hasPrevYear && (
          <Link href={`${base}/year/${prevYear}`} className="flex items-center justify-between text-[15px] text-[#BDBDBD] no-underline">
            {prevYear} Summary
            <Chevron />
          </Link>
        )}
      </div>
    </main>
  );
}
