import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { storeCredential } from "@/lib/ads/credentials";
import { POSTMASTER_CREDENTIAL_KEY } from "@/lib/email-health/postmaster";

export const runtime = "nodejs";

// Google sends the user back here after consenting to postmaster.readonly.
// Exchange the code for a refresh token and keep it in
// ad_platform_credentials (platform google, key postmaster_refresh_token),
// then return to the Ads tab's email section with a status flag.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  let entityId = "";
  let userId: string | null = null;
  let nonce = "";
  try {
    const st = JSON.parse(Buffer.from(stateRaw || "", "base64url").toString()) as {
      nonce?: string;
      entityId?: string;
      userId?: string;
    };
    nonce = st.nonce || "";
    entityId = st.entityId || "";
    userId = st.userId || null;
  } catch {
    // fall through with empty state
  }
  const back = (flag: string, detail?: string) => {
    const dest = entityId ? `/${entityId}/inquiries/ads` : "/";
    const q = new URLSearchParams({ postmaster: flag, ...(detail ? { detail: detail.slice(0, 300) } : {}) });
    return NextResponse.redirect(`${url.origin}${dest}?${q}#email-health`);
  };

  if (oauthError) return back("denied", oauthError);
  const cookieStore = await cookies();
  const expected = cookieStore.get("pm_oauth_nonce")?.value;
  if (!code || !nonce || !expected || expected !== nonce) return back("failed", "state mismatch");

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return back("failed", "GOOGLE_ADS_CLIENT_ID / SECRET not set");

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${url.origin}/api/ads/postmaster-oauth/callback`,
      grant_type: "authorization_code",
    }),
  });
  const json = (await resp.json()) as {
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!resp.ok || !json.refresh_token) {
    return back("failed", json.error_description || json.error || `token exchange HTTP ${resp.status}`);
  }
  if (!(json.scope || "").includes("postmaster")) {
    return back("failed", `granted scope was "${json.scope}", not postmaster.readonly`);
  }

  try {
    await storeCredential("google", POSTMASTER_CREDENTIAL_KEY, json.refresh_token, {
      granted_scope: json.scope ?? null,
      connected_by: userId,
    });
  } catch (e) {
    return back("failed", e instanceof Error ? e.message : "could not store token");
  }
  const res = back("connected");
  res.cookies.set("pm_oauth_nonce", "", { path: "/api/ads/postmaster-oauth", maxAge: 0 });
  return res;
}
