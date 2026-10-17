"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { moveRedemption, requestRedemption } from "@/lib/rewards/redemptions";
import { sendSignInEmail } from "@/lib/rewards/portal/email";
import { clientIp, homeHref, portalBase, portalOrigin } from "@/lib/rewards/portal/server";
import {
  createSignInTokens,
  endPortalSession,
  getPortalSession,
  LINK_TTL_MINUTES,
  normalizeEmail,
  redeemSignInToken,
  SESSION_COOKIE,
  SESSION_DAYS,
  sessionCookieOptions,
} from "@/lib/rewards/portal/session";

/** Email a sign-in link. Same next screen whether or not the email is on file. */
export async function requestLinkAction(formData: FormData) {
  const base = await portalBase();
  const email = normalizeEmail(String(formData.get("email") ?? "")).slice(0, 254);
  if (!email) redirect(`${base}/sign-in?error=email`);

  const admin = createAdminClient();
  const targets = await createSignInTokens(admin, email, await clientIp());
  if (targets.length > 0) {
    const origin = await portalOrigin();
    const result = await sendSignInEmail({
      to: email,
      links: targets.map((t) => ({ memberName: t.memberName, url: `${origin}${base}/auth?token=${encodeURIComponent(t.token)}` })),
      assetBase: origin,
      minutes: LINK_TTL_MINUTES,
    });
    if (!result.ok) console.error("[rewards-portal] sign-in email failed", result.error);
  }
  redirect(`${base}/check-email?to=${encodeURIComponent(email)}`);
}

/** Trade the emailed token for a session. Runs on a button press, not on page load, so mail scanners can't use up the link. */
export async function signInAction(formData: FormData) {
  const base = await portalBase();
  const admin = createAdminClient();
  const secret = await redeemSignInToken(admin, String(formData.get("token") ?? ""));
  if (!secret) redirect(`${base}/sign-in?error=expired`);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, secret, sessionCookieOptions(SESSION_DAYS * 86400));
  redirect(homeHref(base));
}

export async function signOutAction() {
  const base = await portalBase();
  await endPortalSession(createAdminClient());
  redirect(`${base}/sign-in`);
}

async function customerSession() {
  const admin = createAdminClient();
  const base = await portalBase();
  const session = await getPortalSession(admin);
  if (!session) redirect(`${base}/sign-in`);
  return { admin, base, session };
}

export async function redeemAction(formData: FormData) {
  const { admin, base, session } = await customerSession();
  const itemId = String(formData.get("itemId") ?? "");
  if (session.readOnly) redirect(`${base}/rewards/${itemId}?error=${encodeURIComponent("Staff Preview Is Read Only")}`);
  const result = await requestRedemption(admin, {
    entityId: session.entityId,
    memberId: session.memberId,
    catalogItemId: itemId,
    note: String(formData.get("note") ?? "").slice(0, 500) || null,
    createdBy: null,
    contactId: session.contactId,
  });
  if (!result.ok) redirect(`${base}/rewards/${itemId}?error=${encodeURIComponent(result.error)}`);
  redirect(`${base}/redemptions/${result.id}`);
}

export async function cancelRedemptionAction(formData: FormData) {
  const { admin, base, session } = await customerSession();
  const id = String(formData.get("redemptionId") ?? "");
  if (session.readOnly) redirect(`${base}/redemptions/${id}`);
  const result = await moveRedemption(admin, {
    entityId: session.entityId,
    memberId: session.memberId,
    redemptionId: id,
    status: "cancelled",
    onlyFrom: ["requested"],
  });
  redirect(`${base}/redemptions/${id}${result.ok ? "" : `?error=${encodeURIComponent(result.error)}`}`);
}

export async function markTierSeenAction(formData: FormData) {
  const { admin, base, session } = await customerSession();
  const next = String(formData.get("next") ?? "");
  if (!session.readOnly) {
    await admin
      .from("rewards_tier_changes")
      .update({ customer_seen_at: new Date().toISOString() })
      .eq("member_id", session.memberId)
      .is("customer_seen_at", null);
  }
  redirect(next === "perks" || next === "tiers" ? `${base}/${next}` : homeHref(base));
}

export async function toggleStatementsAction(formData: FormData) {
  const { admin, base, session } = await customerSession();
  if (!session.readOnly && session.contactId) {
    await admin
      .from("rewards_contacts")
      .update({ receives_statements: formData.get("on") === "1" })
      .eq("id", session.contactId)
      .eq("member_id", session.memberId);
  }
  redirect(`${base}/account`);
}
