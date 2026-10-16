import Link from "next/link";
import { portalBase } from "@/lib/rewards/portal/server";
import { LINK_TTL_MINUTES, SESSION_DAYS } from "@/lib/rewards/portal/session";
import { requestLinkAction } from "../actions";
import { Logo, PillButton, Rows } from "../_ui";

export default async function CheckEmailPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const base = await portalBase();
  const { to = "" } = await searchParams;
  const email = to.slice(0, 254);

  return (
    <main className="flex min-h-dvh flex-col px-5 pb-7">
      <header className="flex h-16 flex-none items-center">
        <Logo />
      </header>

      <div className="mt-20 flex flex-col gap-5">
        <div aria-hidden="true" className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </div>
        <h1 className="text-4xl font-semibold leading-[1.1]">Check Your Email</h1>
        <div className="border-t border-[#262626]">
          <Rows
            rows={[
              ["Sent To", <span key="e" className="break-all">{email}</span>],
              ["Link Valid For", `${LINK_TTL_MINUTES} Minutes`],
              ["Stays Signed In", `${SESSION_DAYS} Days`],
            ]}
          />
        </div>
        <p className="text-[13.5px] text-[#9A9A9A]">Only Emails on a Versatile Rewards Account Get a Link</p>
      </div>

      <div className="mt-auto flex flex-col gap-2.5 pt-8">
        <form action={requestLinkAction}>
          <input type="hidden" name="email" value={email} />
          <PillButton kind="outline">Resend Link</PillButton>
        </form>
        <Link href={`${base}/sign-in`} className="flex h-11 items-center justify-center text-[15px] text-[#BDBDBD] no-underline">
          Use a Different Email
        </Link>
      </div>
    </main>
  );
}
