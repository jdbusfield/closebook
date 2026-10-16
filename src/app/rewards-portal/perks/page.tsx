import { homeHref, requireMember } from "@/lib/rewards/portal/server";
import { allowanceState, type AllowancePeriod } from "@/lib/rewards/perks";
import { fmtMemberNumber, fmtMoney, fmtMonth } from "@/lib/rewards/portal/view";
import { Label, StaffBanner, SubHeader } from "../_ui";

export const dynamic = "force-dynamic";

interface TierPerkRow {
  tier_id: string;
  perk_id: string;
  value_number: number | null;
  value_text: string | null;
  allowance: number | null;
  allowance_period: string | null;
  rewards_perks: { key: string; name: string; category: string; value_kind: string; description: string | null; sort_order: number; is_active: boolean };
}

const PERIOD: Record<string, string> = { order: "per Order", week: "per Week", month: "per Month", quarter: "per Quarter", year: "per Year" };

function perkValue(p: TierPerkRow): string {
  switch (p.rewards_perks.value_kind) {
    case "percent":
      return p.value_number == null ? "" : `${Number(p.value_number)}%`;
    case "text":
      return p.value_text ?? "";
    case "allowance":
      return p.allowance == null ? "Included" : `${p.allowance} ${PERIOD[p.allowance_period ?? ""] ?? ""}`.trim();
    default:
      return "Included";
  }
}

export default async function PerksPage() {
  const { admin, base, session, member, view } = await requireMember();
  const current = view.status.tier;
  const next = view.status.next;
  const { data: tierRows } = await admin.from("rewards_tiers").select("id, key").eq("entity_id", session.entityId);
  const idOf = (key: string | undefined) => tierRows?.find((t) => t.key === key)?.id;
  const ids = [idOf(current.key), idOf(next?.key)].filter(Boolean) as string[];
  const { data } = ids.length
    ? await admin.from("rewards_tier_perks").select("tier_id, perk_id, value_number, value_text, allowance, allowance_period, rewards_perks!inner(key, name, category, value_kind, description, sort_order, is_active)").in("tier_id", ids).eq("enabled", true)
    : { data: [] };
  const rows = ((data ?? []) as unknown as TierPerkRow[]).filter((r) => r.rewards_perks.is_active && r.rewards_perks.key !== "redemption_refund");
  const mine = rows.filter((r) => r.tier_id === idOf(current.key)).sort((a, b) => a.rewards_perks.sort_order - b.rewards_perks.sort_order);
  const nextRows = rows
    .filter((r) => r.tier_id === idOf(next?.key))
    .filter((r) => {
      const have = mine.find((m) => m.perk_id === r.perk_id);
      return !have || perkValue(have) !== perkValue(r);
    })
    .sort((a, b) => a.rewards_perks.sort_order - b.rewards_perks.sort_order);

  const { data: uses } = await admin
    .from("rewards_perk_uses")
    .select("perk_id, used_on, quantity")
    .eq("member_id", member.id)
    .gte("used_on", `${Number(view.asOf.slice(0, 4)) - 1}-01-01`);
  const monthName = fmtMonth(view.asOf).split(" ")[0];

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <SubHeader backHref={homeHref(base)} title={`${current.name} Perks`} />
      <div className="flex flex-col gap-[18px] px-5 pb-8">
        <section aria-label="Member number" className="flex items-center justify-between rounded-lg border border-[#2A2A2A] bg-[#121212] px-4 py-3.5">
          <div className="flex flex-col">
            <span className="text-[13px] text-[#9A9A9A]">Member Number</span>
            <span className="text-[22px] font-semibold">{fmtMemberNumber(member.member_number)}</span>
          </div>
          <span className="text-[14px] text-[#BDBDBD]">Give at the Counter</span>
        </section>

        <section aria-label="Your perks" className="flex flex-col">
          <Label className="pb-0.5">Your Perks</Label>
          {mine.length === 0 && <p className="py-2.5 text-[15px] text-[#9A9A9A]">No Perks Set for {current.name} Yet</p>}
          {mine.map((p, i) => {
            const state = allowanceState(
              p.allowance,
              p.allowance_period as AllowancePeriod | null,
              (uses ?? []).filter((u) => u.perk_id === p.perk_id).map((u) => ({ usedOn: u.used_on, quantity: u.quantity })),
              view.asOf,
            );
            const left = state && state.periodStart ? `${state.remaining} Left ${p.allowance_period === "month" ? `in ${monthName}` : `This ${p.allowance_period === "week" ? "Week" : p.allowance_period === "quarter" ? "Quarter" : "Year"}`}` : null;
            return (
              <div key={p.perk_id} className={`flex items-center justify-between gap-3 py-2.5 text-[15px] ${i < mine.length - 1 ? "border-b border-[#222]" : ""}`}>
                <div className="flex flex-col">
                  <span>{p.rewards_perks.name}</span>
                  {p.rewards_perks.description && <span className="text-[13px] text-[#9A9A9A]">{p.rewards_perks.description}</span>}
                </div>
                <div className="flex flex-none flex-col items-end">
                  <span>{perkValue(p)}</span>
                  {left && <span className="text-[13px] text-[#FF3B42]">{left}</span>}
                </div>
              </div>
            );
          })}
        </section>

        {next && nextRows.length > 0 && (
          <section aria-label={`${next.name} adds`} className="flex flex-col gap-2 rounded-lg border border-[#2A2A2A] px-4 py-3.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[17px] font-semibold">{next.name} Adds</span>
              <span className="text-[13.5px] text-[#9A9A9A]">{fmtMoney(view.status.spendToNext ?? 0)} to Go</span>
            </div>
            <div className="flex flex-col gap-1 text-[14px] text-[#BDBDBD]">
              {nextRows.map((p) => (
                <div key={p.perk_id} className="flex justify-between gap-3">
                  <span>{p.rewards_perks.name}</span>
                  <span>{perkValue(p)}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
