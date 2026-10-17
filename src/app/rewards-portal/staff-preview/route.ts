import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BudgetAccessError, assertOrgMember, getBudgetActor, organizationForEntity } from "@/lib/budget/access";
import { getMemberAccess } from "@/lib/access/server";
import { canOpenModule } from "@/lib/access/modules";
import { isRewardsEntity } from "@/lib/rewards/run";
import { createStaffSession, SESSION_COOKIE, sessionCookieOptions, STAFF_SESSION_HOURS } from "@/lib/rewards/portal/session";
import { homeHref, portalBase } from "@/lib/rewards/portal/server";

/**
 * "View as Member" from Closebook: a signed-in staff user with the Rewards
 * module opens a read-only portal session for one member. With ?preview=1 the
 * member's 2026 preview points are counted as live, to check the portal
 * against real invoices before launch. Works on the Closebook host only (it
 * needs the staff login cookie).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const memberId = url.searchParams.get("member") ?? "";
  const includePreview = url.searchParams.get("preview") === "1";
  const admin = createAdminClient();
  try {
    const actor = await getBudgetActor();
    const { data: member } = await admin.from("rewards_members").select("id, entity_id").eq("id", memberId).maybeSingle();
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    assertOrgMember(actor, await organizationForEntity(admin, member.entity_id));
    const access = await getMemberAccess();
    if (access) {
      if (access.entityIds && !access.entityIds.includes(member.entity_id)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (!canOpenModule(access, "rewards")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!(await isRewardsEntity(admin, member.entity_id))) return NextResponse.json({ error: "Rewards is not set up for this entity" }, { status: 404 });

    const secret = await createStaffSession(admin, member.id, actor.userId, includePreview);
    if (!secret) return NextResponse.json({ error: "Could not start a preview session" }, { status: 500 });
    const base = await portalBase();
    const res = NextResponse.redirect(new URL(homeHref(base), url.origin));
    res.cookies.set(SESSION_COOKIE, secret, sessionCookieOptions(STAFF_SESSION_HOURS * 3600));
    return res;
  } catch (err) {
    if (err instanceof BudgetAccessError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Preview failed" }, { status: 500 });
  }
}
