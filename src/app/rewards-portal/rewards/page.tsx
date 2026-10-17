import Link from "next/link";
import { homeHref, requireMember } from "@/lib/rewards/portal/server";
import { fmtPoints } from "@/lib/rewards/portal/view";
import { FilterPills, Label, StaffBanner, SubHeader } from "../_ui";

export const dynamic = "force-dynamic";

const KINDS = [
  { key: "all", label: "All" },
  { key: "gift_card", label: "Gift Cards" },
  { key: "order_credit", label: "Order Credit" },
  { key: "swag", label: "Swag" },
] as const;

export default async function RewardsPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { admin, base, session, view } = await requireMember();
  const { kind: raw = "all" } = await searchParams;
  const kind = KINDS.some((k) => k.key === raw) ? raw : "all";
  let q = admin.from("rewards_catalog_items").select("id, name, points_cost, kind").eq("entity_id", session.entityId).eq("is_active", true);
  if (kind !== "all") q = q.eq("kind", kind);
  const { data: items } = await q.order("points_cost", { ascending: false }).order("sort_order");
  const points = view.balance.available;
  const ready = (items ?? []).filter((i) => i.points_cost <= points);
  const later = (items ?? []).filter((i) => i.points_cost > points).sort((a, b) => a.points_cost - b.points_cost);

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <SubHeader
        backHref={homeHref(base)}
        title="Rewards"
        right={
          <span className="text-[15px]">
            <span className="font-semibold">{fmtPoints(points)}</span> <span className="text-[#9A9A9A]">Points</span>
          </span>
        }
      />
      <div className="flex flex-col px-5 pb-8">
        <FilterPills items={KINDS.map((k) => ({ href: `${base}/rewards${k.key === "all" ? "" : `?kind=${k.key}`}`, label: k.label, active: k.key === kind }))} />

        <section aria-label="Available now" className="mt-2.5 flex flex-col">
          {ready.length === 0 && <p className="py-3 text-[14px] text-[#9A9A9A]">No Rewards Available Yet</p>}
          {ready.map((i, idx) => (
            <Link
              key={i.id}
              href={`${base}/rewards/${i.id}`}
              className={`flex items-center justify-between gap-3 py-3 text-white no-underline ${idx < ready.length - 1 ? "border-b border-[#222]" : ""}`}
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-[15.5px] font-semibold">{i.name}</span>
                <span className="text-[13px] text-[#9A9A9A]">{fmtPoints(i.points_cost)} Points</span>
              </div>
              <span className={`inline-flex h-8 flex-none items-center rounded-full px-3.5 text-[13.5px] font-semibold ${idx === 0 ? "bg-[#D2232A]" : "border-[1.5px] border-white"}`}>
                Redeem
              </span>
            </Link>
          ))}
        </section>

        {later.length > 0 && (
          <section aria-label="Keep earning" className="flex flex-col">
            <Label className="pb-1 pt-4">Keep Earning</Label>
            {later.map((i, idx) => (
              <div key={i.id} className={`flex items-center justify-between gap-3 py-3 ${idx < later.length - 1 ? "border-b border-[#222]" : ""}`}>
                <div className="flex min-w-0 flex-col">
                  <span className="text-[15.5px] text-[#BDBDBD]">{i.name}</span>
                  <span className="text-[13px] text-[#8C8C8C]">{fmtPoints(i.points_cost)} Points</span>
                </div>
                <span className="flex-none text-[13.5px] text-[#9A9A9A]">{fmtPoints(i.points_cost - points)} to Go</span>
              </div>
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
