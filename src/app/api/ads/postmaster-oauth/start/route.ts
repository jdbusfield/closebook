import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { POSTMASTER_SCOPE } from "@/lib/email-health/postmaster";

export const runtime = "nodejs";

// "Connect Postmaster Tools" on the Ads tab. Same OAuth client as Google Ads
// (GOOGLE_ADS_CLIENT_ID / SECRET), different scope: postmaster.readonly. The
// Google account that consents must own the sending domain in
// postmaster.google.com, or every read comes back forbidden.
//
// The redirect URI (<origin>/api/ads/postmaster-oauth/callback) must be
// listed on the OAuth client in Google Cloud Console, and the Gmail
// Postmaster Tools API must be enabled on that project.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId") || "";
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json({ error: "GOOGLE_ADS_CLIENT_ID is not set" }, { status: 500 });
  }
  const redirectUri = `${url.origin}/api/ads/postmaster-oauth/callback`;
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ nonce, entityId, userId: user.id })).toString("base64url");

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", POSTMASTER_SCOPE);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("state", state);

  const res = NextResponse.redirect(auth.toString());
  res.cookies.set("pm_oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/ads/postmaster-oauth",
    maxAge: 600,
  });
  return res;
}
