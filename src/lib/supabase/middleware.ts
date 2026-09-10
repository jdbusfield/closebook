import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canOpenModule, defaultHrefFor, moduleForPath } from "@/lib/access/modules";
import { parseAccessRow } from "@/lib/access/parse";
import {
  ACTOR_HEADER,
  ACTOR_HEADERS,
  ACTOR_IP_HEADER,
  ACTOR_UA_HEADER,
} from "@/lib/audit/headers";

type PendingCookie = {
  name: string;
  value: string;
  options?: Parameters<NextResponse["cookies"]["set"]>[2];
};

export async function updateSession(request: NextRequest) {
  // Headers forwarded to route handlers and server components. The actor
  // headers are stripped from whatever the client sent and re-stamped below
  // from the verified session, so they cannot be spoofed.
  const requestHeaders = new Headers(request.headers);
  for (const name of ACTOR_HEADERS) requestHeaders.delete(name);

  let pendingCookies: PendingCookie[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          pendingCookies = cookiesToSet as PendingCookie[];
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    requestHeaders.set(ACTOR_HEADER, user.id);
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "";
    if (ip) requestHeaders.set(ACTOR_IP_HEADER, ip);
    const ua = request.headers.get("user-agent") ?? "";
    if (ua) requestHeaders.set(ACTOR_UA_HEADER, ua.slice(0, 512));
  }

  function next() {
    // Refreshed auth cookies were written onto request.cookies above; make
    // sure the forwarded cookie header reflects them too.
    const cookieHeader = request.headers.get("cookie");
    if (cookieHeader) requestHeaders.set("cookie", cookieHeader);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    pendingCookies.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options)
    );
    return response;
  }

  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/signup") ||
    request.nextUrl.pathname.startsWith("/forgot-password") ||
    request.nextUrl.pathname.startsWith("/reset-password") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/invite");

  const isApiRoute = request.nextUrl.pathname.startsWith("/api");
  const isEmbedRoute = request.nextUrl.pathname.startsWith("/embed");

  // Redirect unauthenticated users to login (except auth, API, and embed routes)
  if (!user && !isAuthRoute && !isApiRoute && !isEmbedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages (except /welcome onboarding)
  const isWelcomePage = request.nextUrl.pathname.startsWith("/welcome");
  const isInvitePage = request.nextUrl.pathname.startsWith("/invite");
  if (user && isAuthRoute && !isWelcomePage && !isInvitePage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Module allowlist: a member restricted to certain modules is bounced off
  // any page outside them. Entity restrictions are enforced by RLS.
  if (user && !isAuthRoute && !isApiRoute && !isEmbedRoute) {
    const pathname = request.nextUrl.pathname;
    const moduleKey = moduleForPath(pathname);
    if (moduleKey) {
      const { data: row } = await supabase
        .from("organization_members")
        .select("*")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      if (row) {
        const access = parseAccessRow(row as Record<string, unknown>);
        if (!canOpenModule(access, moduleKey)) {
          let entityIds = access.entityIds ?? [];
          if (entityIds.length === 0) {
            const { data: entities } = await supabase
              .from("entities")
              .select("id")
              .eq("is_active", true)
              .order("name")
              .limit(1);
            entityIds = (entities ?? []).map((e) => e.id as string);
          }
          const target = defaultHrefFor(access, entityIds);
          if (target !== pathname) {
            const url = request.nextUrl.clone();
            url.pathname = target;
            url.search = "";
            return NextResponse.redirect(url);
          }
        }
      }
    }
  }

  return next();
}
