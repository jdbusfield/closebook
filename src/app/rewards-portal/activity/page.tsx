import { homeHref, requireMember } from "@/lib/rewards/portal/server";
import { fmtMonth, fmtPoints, type ViewLedgerRow } from "@/lib/rewards/portal/view";
import { FilterPills, Label, StaffBanner, SubHeader } from "../_ui";
import { LedgerItem } from "../_ledger";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "earned", label: "Earned" },
  { key: "pending", label: "Pending" },
  { key: "redeemed", label: "Redeemed" },
] as const;

function matches(r: ViewLedgerRow, filter: string): boolean {
  if (filter === "earned") return r.entry_type === "earn" && r.is_available;
  if (filter === "pending") return r.entry_type === "earn" && !r.is_available;
  if (filter === "redeemed") return r.entry_type.startsWith("redeem");
  return true;
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { base, session, view } = await requireMember();
  const { filter: raw = "all" } = await searchParams;
  const filter = FILTERS.some((f) => f.key === raw) ? raw : "all";
  const year = Number(view.asOf.slice(0, 4));
  const totals = view.byYear.get(year);
  const rows = view.rows.filter((r) => matches(r, filter)).slice(0, 300);

  const months: { key: string; rows: ViewLedgerRow[] }[] = [];
  for (const r of rows) {
    const key = r.earned_on.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else months.push({ key, rows: [r] });
  }

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <SubHeader backHref={homeHref(base)} title="Activity" />
      <div className="flex flex-col gap-3.5 px-5 pb-8">
        <div className="grid grid-cols-3 gap-2">
          {[
            [`Earned ${year}`, totals?.earned ?? 0],
            ["Redeemed", totals?.redeemed ?? 0],
            ["Pending", view.balance.pending],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex flex-col rounded-lg border border-[#2A2A2A] bg-[#121212] px-3 py-2.5">
              <span className="text-[12.5px] text-[#9A9A9A]">{k}</span>
              <span className="text-xl font-semibold">{fmtPoints(Number(v))}</span>
            </div>
          ))}
        </div>

        <FilterPills items={FILTERS.map((f) => ({ href: `${base}/activity${f.key === "all" ? "" : `?filter=${f.key}`}`, label: f.label, active: f.key === filter }))} />

        {months.length === 0 && <p className="pt-2 text-[14px] text-[#9A9A9A]">Nothing Here Yet</p>}
        {months.map((m) => (
          <section key={m.key} aria-label={fmtMonth(`${m.key}-01`)} className="flex flex-col">
            <Label className="pb-0.5">{fmtMonth(`${m.key}-01`)}</Label>
            {m.rows.map((r, i) => (
              <LedgerItem key={r.id} base={base} row={r} last={i === m.rows.length - 1} />
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
