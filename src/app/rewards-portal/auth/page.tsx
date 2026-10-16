import Link from "next/link";
import { portalBase } from "@/lib/rewards/portal/server";
import { signInAction } from "../actions";
import { Logo, PillButton } from "../_ui";

// Signing in happens on the button press, not on page load: email security
// scanners open links to check them, and would otherwise use up the one-time token.
export default async function AuthPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const base = await portalBase();
  const { token = "" } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-col px-5 pb-7">
      <header className="flex h-16 flex-none items-center">
        <Logo />
      </header>
      <div className="mt-24 flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-[#FF3B42]">Versatile Rewards</span>
        <h1 className="text-4xl font-semibold leading-[1.1]">Sign In</h1>
      </div>
      <div className="mt-auto flex flex-col gap-2.5">
        {token ? (
          <form action={signInAction}>
            <input type="hidden" name="token" value={token} />
            <PillButton>Continue to My Points</PillButton>
          </form>
        ) : (
          <Link href={`${base}/sign-in`} className="flex h-[52px] items-center justify-center rounded-full bg-[#D2232A] text-[15px] font-semibold no-underline">
            Request a Sign-In Link
          </Link>
        )}
      </div>
    </main>
  );
}
