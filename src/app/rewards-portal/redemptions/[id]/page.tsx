import { notFound } from "next/navigation";
import { homeHref, requireMember } from "@/lib/rewards/portal/server";
import { fmtDate, fmtPoints } from "@/lib/rewards/portal/view";
import { cancelRedemptionAction } from "../../actions";
import { Label, Notice, Pill, PillButton, Rows, StaffBanner, SubHeader } from "../../_ui";

export const dynamic = "force-dynamic";

function Step({ done, current, title, detail, line }: { done: boolean; current: boolean; title: string; detail: string; line: "solid" | "dim" | null }) {
  return (
    <li className="flex gap-3.5">
      <div className="flex flex-col items-center">
        {done ? (
          <div aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </div>
        ) : (
          <div aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${current ? "border-[#D2232A]" : "border-[#3A3A3A]"}`}>
            {current && <div className="h-2.5 w-2.5 rounded-full bg-[#D2232A]" />}
          </div>
        )}
        {line && <div className={`min-h-9 w-0.5 flex-1 ${line === "solid" ? "bg-white" : "bg-[#3A3A3A]"}`} />}
      </div>
      <div className={`flex flex-col pt-[3px] ${line ? "pb-[18px]" : ""}`}>
        <span className={`text-[17px] font-semibold ${!done && !current ? "text-[#8C8C8C]" : ""}`}>{title}</span>
        <span className="text-[14px] text-[#9A9A9A]">{detail}</span>
      </div>
    </li>
  );
}

export default async function RedemptionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const { admin, base, session, view } = await requireMember();
  const { data: red } = await admin
    .from("rewards_redemptions")
    .select("id, description, points, status, requested_at, approved_at, fulfilled_at, cancelled_at, rewards_contacts(name)")
    .eq("id", id)
    .eq("member_id", session.memberId)
    .maybeSingle();
  if (!red) notFound();

  const by = (red.rewards_contacts as unknown as { name: string | null } | null)?.name;
  const cancelled = red.status === "cancelled";
  const approved = !!red.approved_at || red.status === "fulfilled";
  const fulfilled = red.status === "fulfilled";

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <SubHeader backHref={`${base}/activity`} title="Redemption" />
      <div className="flex flex-col gap-6 px-5">
        {error && <Notice>{error}</Notice>}
        <section aria-label="Reward" className="flex flex-col gap-0.5">
          <Label>Requested {fmtDate(red.requested_at.slice(0, 10))}</Label>
          <span className="text-[30px] font-semibold leading-[1.15]">{red.description}</span>
          <span className="text-[15px] text-[#BDBDBD]">{fmtPoints(red.points)} Points</span>
        </section>

        {cancelled ? (
          <Rows rows={[["Status", "Cancelled"], ["Cancelled", fmtDate(red.cancelled_at?.slice(0, 10))], ["Points Returned", fmtPoints(red.points)]]} />
        ) : (
          <ol aria-label="Status" className="m-0 flex list-none flex-col p-0">
            <Step done title="Requested" detail={`${fmtDate(red.requested_at.slice(0, 10))}${by ? ` · ${by}` : ""}`} current={false} line={approved ? "solid" : "dim"} />
            <Step
              done={approved}
              current={!approved}
              title="Approved"
              detail={red.approved_at ? fmtDate(red.approved_at.slice(0, 10)) : "Waiting on Versatile"}
              line={fulfilled ? "solid" : "dim"}
            />
            <Step
              done={fulfilled}
              current={approved && !fulfilled}
              title="Fulfilled"
              detail={fulfilled ? fmtDate(red.fulfilled_at?.slice(0, 10)) : approved ? `In Progress${session.contactEmail ? ` · ${session.contactEmail}` : ""}` : "Not Started"}
              line={null}
            />
          </ol>
        )}

        <div className="border-t border-[#222]">
          <Rows rows={[["Points to Spend Now", <span key="p" className="font-semibold">{fmtPoints(view.balance.available)}</span>]]} />
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2.5 px-5 pb-7 pt-8">
        <Pill href={homeHref(base)} kind="white" block>
          Back to Home
        </Pill>
        {red.status === "requested" && !session.readOnly && (
          <form action={cancelRedemptionAction}>
            <input type="hidden" name="redemptionId" value={red.id} />
            <PillButton kind="outline">Cancel Request</PillButton>
          </form>
        )}
      </div>
    </main>
  );
}
