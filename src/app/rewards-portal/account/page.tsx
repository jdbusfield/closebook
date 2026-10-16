import { homeHref, requireMember } from "@/lib/rewards/portal/server";
import { fmtDate, fmtMemberNumber } from "@/lib/rewards/portal/view";
import { signOutAction, toggleStatementsAction } from "../actions";
import { Label, PillButton, Rows, StaffBanner, SubHeader } from "../_ui";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const { admin, base, session, member } = await requireMember();
  const [{ data: contacts }, { data: accounts }, { data: me }] = await Promise.all([
    admin.from("rewards_contacts").select("id, name, title, email").eq("member_id", member.id).order("created_at"),
    admin.from("rewards_member_customers").select("customer_name").eq("member_id", member.id).order("customer_name"),
    session.contactId
      ? admin.from("rewards_contacts").select("receives_statements").eq("id", session.contactId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const statementsOn = me?.receives_statements ?? false;

  return (
    <main className="flex flex-1 flex-col">
      <StaffBanner show={session.readOnly} preview={session.includePreview} />
      <SubHeader backHref={homeHref(base)} title="Account" />
      <div className="flex flex-col gap-5 px-5">
        <section aria-label="Company" className="flex flex-col">
          <span className="pb-1.5 text-[26px] font-semibold">{member.name}</span>
          <Rows
            rows={[
              ["Member Number", fmtMemberNumber(member.member_number)],
              ...(member.activated_at ? [["Member Since", fmtDate(member.activated_at.slice(0, 10))] as [string, string]] : []),
              ["Signed In As", <span key="e" className="break-all">{session.contactEmail ?? "Versatile Staff"}</span>],
            ]}
          />
        </section>

        <section aria-label="People with access" className="flex flex-col text-[15px]">
          <Label className="pb-0.5">People With Access</Label>
          {(contacts ?? []).map((c, i, a) => (
            <div key={c.id} className={`flex justify-between gap-3 py-2.5 ${i < a.length - 1 ? "border-b border-[#222]" : ""}`}>
              <span>{c.name || c.email}</span>
              <span className="text-[#9A9A9A]">{c.title ?? ""}</span>
            </div>
          ))}
          <span className="pt-2 text-[13.5px] text-[#9A9A9A]">Add or Remove People: 213.935.8124</span>
        </section>

        <section aria-label="Linked accounts" className="flex flex-col text-[15px]">
          <Label className="pb-0.5">Versatile Accounts Earning Points</Label>
          {(accounts ?? []).map((a, i, all) => (
            <div key={`${a.customer_name}-${i}`} className={`py-2.5 ${i < all.length - 1 ? "border-b border-[#222]" : ""}`}>
              {a.customer_name}
            </div>
          ))}
        </section>

        {session.contactId && (
          <form action={toggleStatementsAction} className="flex items-center justify-between border-t border-[#222] pt-3.5">
            <input type="hidden" name="on" value={statementsOn ? "0" : "1"} />
            <div className="flex flex-col text-[15px]">
              <span>Monthly Statement Email</span>
              <span className="text-[13px] text-[#9A9A9A]">{statementsOn ? "On · Sent on the 5th" : "Off"}</span>
            </div>
            <button
              type="submit"
              role="switch"
              aria-checked={statementsOn}
              aria-label="Monthly Statement Email"
              className={`relative h-8 w-14 cursor-pointer rounded-full transition-colors ${statementsOn ? "bg-[#D2232A]" : "bg-[#3A3A3A]"}`}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${statementsOn ? "left-7" : "left-1"}`} />
            </button>
          </form>
        )}
      </div>

      <form action={signOutAction} className="mt-auto px-5 pb-7 pt-8">
        <PillButton kind="outline">Sign Out</PillButton>
      </form>
    </main>
  );
}
