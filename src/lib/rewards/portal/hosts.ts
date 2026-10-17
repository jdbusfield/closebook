/**
 * Where the member portal lives. Edge-safe (no Node or next/headers imports):
 * the middleware uses it.
 *
 * On rewards.versatilestudios.com every path is rewritten into /rewards-portal,
 * so customers see clean URLs and never reach a Closebook page. On the
 * Closebook host the portal is also served at /rewards-portal for testing.
 */

export const PORTAL_PREFIX = "/rewards-portal";
/** Set by the middleware: "" on the portal domain, PORTAL_PREFIX elsewhere. */
export const PORTAL_BASE_HEADER = "x-rewards-portal-base";

export function portalHosts(): string[] {
  return (process.env.REWARDS_PORTAL_HOSTS ?? "rewards.versatilestudios.com")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isPortalHost(host: string | null | undefined): boolean {
  const h = (host ?? "").toLowerCase().split(":")[0];
  return !!h && portalHosts().includes(h);
}

/** The address used in emails sent without a request (invites, statements). */
export function publicPortalUrl(): string {
  return (process.env.REWARDS_PORTAL_URL ?? "https://rewards.versatilestudios.com").replace(/\/+$/, "");
}
