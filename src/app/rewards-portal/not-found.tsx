import Link from "next/link";
import { homeHref, portalBase } from "@/lib/rewards/portal/server";
import { Logo } from "./_ui";

export default async function PortalNotFound() {
  const base = await portalBase();
  return (
    <main className="flex min-h-dvh flex-col px-5 pb-7">
      <header className="flex h-16 items-center">
        <Logo />
      </header>
      <div className="mt-24 flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-[#FF3B42]">Versatile Rewards</span>
        <h1 className="text-4xl font-semibold leading-[1.1]">Page Not Found</h1>
      </div>
      <Link href={homeHref(base)} className="mt-auto flex h-[52px] items-center justify-center rounded-full bg-white text-[15px] font-semibold text-black no-underline">
        Back to Home
      </Link>
    </main>
  );
}
