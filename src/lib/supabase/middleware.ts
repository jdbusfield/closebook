import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { canOpenModule, defaultHrefFor, moduleForPath } from "@/lib/access/modules";
import { parseAccessRow } from "@/lib/access/parse";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

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
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

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

  return supabaseResponse;
}
