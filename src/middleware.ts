import { updateSession } from "@/lib/supabase/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { isPortalHost, PORTAL_BASE_HEADER, PORTAL_PREFIX } from "@/lib/rewards/portal/hosts";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Versatile Rewards member portal. On its own domain every path is served
  // from /rewards-portal, so customers never reach a Closebook page. On the
  // Closebook host /rewards-portal is reachable for testing. Either way it
  // has its own sign-in and skips the staff session below. The base header is
  // always overwritten here, so a client can't set it.
  if (isPortalHost(request.headers.get("host"))) {
    const headers = new Headers(request.headers);
    headers.set(PORTAL_BASE_HEADER, "");
    const url = request.nextUrl.clone();
    url.pathname = PORTAL_PREFIX + (path === "/" ? "" : path);
    return NextResponse.rewrite(url, { request: { headers } });
  }
  if (path === PORTAL_PREFIX || path.startsWith(PORTAL_PREFIX + "/")) {
    const headers = new Headers(request.headers);
    headers.set(PORTAL_BASE_HEADER, PORTAL_PREFIX);
    return NextResponse.next({ request: { headers } });
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
