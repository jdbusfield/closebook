import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// "Connect Google Ads" on the Ads tab. Sends a signed-in Closebook user to
// Google's consent screen for the Google Ads API (adwords) scope using the
// OAuth client Closebook already holds (GOOGLE_ADS_CLIENT_ID / SECRET). The
// callback stores the refresh token server-side; nobody copies a token.
//
// The redirect URI (<origin>/api/ads/google-oauth/callback) must be listed on
// the OAuth client in Google Cloud Console.
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
  const redirectUri = `${url.origin}/api/ads/google-oauth/callback`;
  const nonce = crypto.randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ nonce, entityId, userId: user.id })).toString("base64url");

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "https://www.googleapis.com/auth/adwords");
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("include_granted_scopes", "true");
  auth.searchParams.set("state", state);

  const res = NextResponse.redirect(auth.toString());
  res.cookies.set("gads_oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/ads/google-oauth",
    maxAge: 600,
  });
  return res;
}
