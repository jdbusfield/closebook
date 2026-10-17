/**
 * Member portal sign-in. Customers get a one-time link by email (no
 * passwords, no Supabase auth users). Link tokens and session cookies are
 * random 32-byte secrets; only their SHA-256 hashes are stored.
 *
 * Server-only: uses the service-role client and next/headers cookies.
 */

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export const SESSION_COOKIE = "vr_session";
export const LINK_TTL_MINUTES = 15;
export const SESSION_DAYS = 30;
export const STAFF_SESSION_HOURS = 8;
/** Sign-in links one contact can request per hour. */
export const MAX_LINKS_PER_HOUR = 5;

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface PortalSession {
  sessionId: string;
  memberId: string;
  entityId: string;
  contactId: string | null;
  contactEmail: string | null;
  contactName: string | null;
  staffUserId: string | null;
  includePreview: boolean;
  /** Staff "View as Member" sessions can look, not redeem or change settings. */
  readOnly: boolean;
}

export interface LinkTarget {
  token: string;
  contactId: string;
  memberId: string;
  memberName: string;
}

/**
 * Create sign-in tokens for every active member this email is a contact of.
 * Returns nothing for an unknown email, an inactive member or a contact over
 * the hourly limit; the caller shows the same screen either way so the form
 * can't be used to test which emails are on file.
 */
export async function createSignInTokens(admin: Admin, email: string, ip: string | null): Promise<LinkTarget[]> {
  const addr = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return [];
  const { data: contacts } = await admin
    .from("rewards_contacts")
    .select("id, member_id, rewards_members!inner(id, name, status)")
    .eq("email", addr);

  const since = new Date(Date.now() - 3600_000).toISOString();
  const out: LinkTarget[] = [];
  for (const c of contacts ?? []) {
    const member = c.rewards_members as unknown as { id: string; name: string; status: string } | null;
    if (!member || member.status !== "active") continue;
    const { count } = await admin
      .from("rewards_portal_tokens")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", c.id)
      .gte("created_at", since);
    if ((count ?? 0) >= MAX_LINKS_PER_HOUR) continue;
    const token = newSecret();
    const { error } = await admin.from("rewards_portal_tokens").insert({
      token_hash: hashSecret(token),
      contact_id: c.id,
      member_id: c.member_id,
      expires_at: new Date(Date.now() + LINK_TTL_MINUTES * 60_000).toISOString(),
      requested_ip: ip,
    });
    if (error) continue;
    out.push({ token, contactId: c.id, memberId: c.member_id, memberName: member.name });
  }
  return out;
}

/**
 * Trade a sign-in link token for a new session secret. The token works once
 * and only within its time limit. Returns null when it is unknown, used or
 * expired, or the member is no longer active.
 */
export async function redeemSignInToken(admin: Admin, token: string): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const now = new Date().toISOString();
  // Conditional on used_at being null, so a link can't be used twice.
  const { data: used } = await admin
    .from("rewards_portal_tokens")
    .update({ used_at: now })
    .eq("token_hash", hashSecret(token))
    .is("used_at", null)
    .gt("expires_at", now)
    .select("contact_id, member_id");
  const row = used?.[0];
  if (!row) return null;

  const { data: member } = await admin.from("rewards_members").select("status").eq("id", row.member_id).maybeSingle();
  if (member?.status !== "active") return null;

  const secret = newSecret();
  const { error } = await admin.from("rewards_portal_sessions").insert({
    session_hash: hashSecret(secret),
    member_id: row.member_id,
    contact_id: row.contact_id,
    expires_at: new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString(),
    last_seen_at: now,
  });
  if (error) return null;
  await admin.from("rewards_contacts").update({ last_signed_in_at: now }).eq("id", row.contact_id);
  return secret;
}

/** A read-only session for a Closebook staff member to see a member's portal. */
export async function createStaffSession(admin: Admin, memberId: string, staffUserId: string, includePreview: boolean): Promise<string | null> {
  const secret = newSecret();
  const { error } = await admin.from("rewards_portal_sessions").insert({
    session_hash: hashSecret(secret),
    member_id: memberId,
    staff_user_id: staffUserId,
    include_preview: includePreview,
    expires_at: new Date(Date.now() + STAFF_SESSION_HOURS * 3600_000).toISOString(),
  });
  return error ? null : secret;
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** The signed-in member for this request, or null. */
export async function getPortalSession(admin: Admin): Promise<PortalSession | null> {
  const jar = await cookies();
  const secret = jar.get(SESSION_COOKIE)?.value;
  if (!secret) return null;
  const { data: s } = await admin
    .from("rewards_portal_sessions")
    .select("id, member_id, contact_id, staff_user_id, include_preview, expires_at, last_seen_at, rewards_members!inner(entity_id, status), rewards_contacts(email, name)")
    .eq("session_hash", hashSecret(secret))
    .maybeSingle();
  if (!s || s.expires_at <= new Date().toISOString()) return null;
  const member = s.rewards_members as unknown as { entity_id: string; status: string };
  const contact = s.rewards_contacts as unknown as { email: string; name: string | null } | null;
  const isStaff = !!s.staff_user_id;
  // A customer loses access when the member is deactivated or opted out.
  if (!isStaff && member.status !== "active") return null;

  // Touch last_seen_at at most every 10 minutes.
  if (!s.last_seen_at || Date.now() - Date.parse(s.last_seen_at) > 600_000) {
    await admin.from("rewards_portal_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", s.id);
  }
  return {
    sessionId: s.id,
    memberId: s.member_id,
    entityId: member.entity_id,
    contactId: s.contact_id,
    contactEmail: contact?.email ?? null,
    contactName: contact?.name ?? null,
    staffUserId: s.staff_user_id,
    includePreview: isStaff && s.include_preview,
    readOnly: isStaff,
  };
}

export async function endPortalSession(admin: Admin): Promise<void> {
  const jar = await cookies();
  const secret = jar.get(SESSION_COOKIE)?.value;
  if (secret) await admin.from("rewards_portal_sessions").delete().eq("session_hash", hashSecret(secret));
  jar.delete(SESSION_COOKIE);
}
