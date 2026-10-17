import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/rewards/portal/server";
import { fmtPoints } from "@/lib/rewards/portal/view";
import { redeemAction } from "../../actions";
import { Notice, PillButton, Rows, StaffBanner, SubHeader } from "../../_ui";

export const dynamic = "force-dynamic";

export default async function ConfirmRedemptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ itemId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { itemId } = await params;
  const { error } = await searchParams;
  const { admin, base, session, view } = await requireMember();
  const { data: item } = await admin
    .from("rewards_catalog_items")
    .select("id, name, points_cost")
    .eq("id", itemId)
    .eq("entity_id", session.entityId)
    .eq("is_active", true)
    .maybeSingle();
  if (!item) notFound();

  const points = view.balance.available;
  const after = points - item.points_cost;
  const enough = after >= 0;

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <SubHeader backHref={`${base}/rewards`} title="Confirm Redemption" />
      <form action={redeemAction} className="flex flex-1 flex-col">
        <input type="hidden" name="itemId" value={item.id} />
        <div className="flex flex-col gap-5 px-5">
          {error && <Notice>{error}</Notice>}
          <section aria-label="Reward" className="overflow-hidden rounded-lg border border-[#2A2A2A] bg-[#121212]">
            <div className="flex items-center gap-4 p-[18px]">
              <div aria-hidden="true" className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-white text-black">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="6" width="18" height="12" rx="2" />
                  <path d="M3 10h18M7 15h4" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-[22px] font-semibold leading-tight">{item.name}</span>
                <span className="text-[14px] text-[#BDBDBD]">{fmtPoints(item.points_cost)} Points</span>
              </div>
            </div>
            <div className="h-1.5 bg-[#D2232A]" />
          </section>

          <Rows
            rows={[
              ["Points Now", fmtPoints(points)],
              ["This Reward", <span key="r" className="text-[#FF3B42]">−{fmtPoints(item.points_cost)}</span>],
              ["Points After", <span key="a" className="font-semibold">{enough ? fmtPoints(after) : "Not Enough Points"}</span>],
              ...(session.contactEmail ? [["Sent To", <span key="s" className="break-all">{session.contactEmail}</span>] as [string, React.ReactNode]] : []),
              ["Fulfilled By", "Versatile Staff"],
            ]}
          />

          <div className="flex flex-col gap-2">
            <label htmlFor="note" className="text-[13px] font-semibold text-[#BDBDBD]">
              Note for Versatile (Optional)
            </label>
            <input
              id="note"
              name="note"
              type="text"
              maxLength={500}
              className="h-12 rounded-lg border-[1.5px] border-[#5A5A5A] bg-transparent px-3.5 text-[15px] text-white focus:outline-none focus:ring-2 focus:ring-[#D2232A]"
            />
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-2.5 px-5 pb-7 pt-8">
          <PillButton disabled={!enough || session.readOnly}>{session.readOnly ? "Staff Preview Is Read Only" : "Confirm Redemption"}</PillButton>
          <Link href={`${base}/rewards`} className="flex h-11 items-center justify-center text-[15px] text-[#BDBDBD] no-underline">
            Cancel
          </Link>
        </div>
      </form>
    </main>
  );
}
