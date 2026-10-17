import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortalSession } from "@/lib/rewards/portal/session";
import { homeHref, portalBase } from "@/lib/rewards/portal/server";
import { requestLinkAction } from "../actions";
import { Label, Logo, Notice, PillButton, WAREHOUSE_PHOTO } from "../_ui";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const base = await portalBase();
  if (await getPortalSession(createAdminClient())) redirect(homeHref(base));
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-col">
      <section className="relative h-[380px] flex-none overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={WAREHOUSE_PHOTO} alt="Versatile Studios Warehouse" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: "58% 40%" }} />
        <div aria-hidden="true" className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.1) 35%, #000 100%)" }} />
        <header className="relative flex h-16 items-center px-5">
          <Logo />
        </header>
        <div className="absolute bottom-2 left-5 right-5 flex flex-col gap-2">
          <Label>Versatile Studios</Label>
          <h1 className="text-[46px] font-semibold leading-[1.1]">Rewards Sign In</h1>
        </div>
      </section>

      <form action={requestLinkAction} className="flex flex-1 flex-col gap-3 px-5 pt-5">
        {error === "expired" && <Notice>Link Expired or Already Used. Request a New One.</Notice>}
        {error === "email" && <Notice>Enter Your Work Email.</Notice>}
        <label htmlFor="email" className="text-[13px] font-semibold text-[#BDBDBD]">
          Work Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@yourproduction.com"
          className="h-[52px] rounded-full border-2 border-white bg-transparent px-5 text-[16px] text-white placeholder:text-[#8C8C8C] focus:outline-none focus:ring-2 focus:ring-[#D2232A]"
        />
        <PillButton>Email Me a Sign-In Link</PillButton>
        <p className="text-[13.5px] text-[#9A9A9A]">No Password Required</p>
      </form>

      <footer className="flex items-center justify-between px-5 pb-7 pt-6 text-[13px] text-[#9A9A9A]">
        <span>Questions: 213.935.8124</span>
        <a href="tel:+12139358124" className="font-semibold text-white no-underline">
          Call
        </a>
      </footer>
    </main>
  );
}
