/**
 * Request helpers for member portal pages and actions (server-only).
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadProgram, todayLA } from "../run";
import { memberLedgerRows } from "../redemptions";
import { PORTAL_BASE_HEADER, PORTAL_PREFIX } from "./hosts";
import { getPortalSession, type PortalSession } from "./session";
import { buildMemberView, type MemberView, type ViewLedgerRow } from "./view";

/** "" on rewards.versatilestudios.com, "/rewards-portal" on the Closebook host. */
export async function portalBase(): Promise<string> {
  const h = await headers();
  const v = h.get(PORTAL_BASE_HEADER);
  return v === null ? PORTAL_PREFIX : v;
}

/** Home link: "/" on the portal domain, "/rewards-portal" elsewhere. */
export const homeHref = (base: string) => base || "/";

export async function portalOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "rewards.versatilestudios.com";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

export interface MemberContext {
  admin: ReturnType<typeof createAdminClient>;
  base: string;
  session: PortalSession;
  member: {
    id: string;
    entity_id: string;
    name: string;
    member_number: number;
    activated_at: string | null;
    current_tier_key: string | null;
    tier_effective_on: string | null;
  };
  settings: Awaited<ReturnType<typeof loadProgram>>["settings"];
  view: MemberView;
  tierName: (key: string | null | undefined) => string;
  today: string;
}

/** The signed-in member and everything the screens need, or a redirect to sign in. */
export async function requireMember(): Promise<MemberContext> {
  const admin = createAdminClient();
  const base = await portalBase();
  const session = await getPortalSession(admin);
  if (!session) redirect(`${base}/sign-in`);

  const [{ data: member }, program, rows] = await Promise.all([
    admin
      .from("rewards_members")
      .select("id, entity_id, name, member_number, activated_at, current_tier_key, tier_effective_on")
      .eq("id", session.memberId)
      .single(),
    loadProgram(admin, session.entityId),
    memberLedgerRows(admin, session.memberId),
  ]);
  if (!member) redirect(`${base}/sign-in`);

  const today = todayLA();
  const view = buildMemberView(rows as ViewLedgerRow[], program.tiers, program.settings, today, session.includePreview);
  const names = new Map(program.tiers.map((t) => [t.key, t.name]));
  return {
    admin,
    base,
    session,
    member,
    settings: program.settings,
    view,
    tierName: (key) => (key ? names.get(key) ?? key : ""),
    today,
  };
}
