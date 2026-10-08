import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveAppOrigin } from "@/lib/app-origin";
import { loadSupabasePublicConfig } from "@/lib/supabase/public-config";

/**
 * Refreshes the Supabase session cookie once per navigation (refresh tokens are single-use) and
 * makes an optimistic redirect to /login for signed-out visitors. Real authorization happens in
 * lib/auth/dal.ts and in database RLS — this is only a convenience layer.
 */

const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/error"];

export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const config = loadSupabasePublicConfig();
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Responses that set auth cookies must never be cached by a CDN.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Must run before any redirect decision: it refreshes an expired access token.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

  if (!signedIn && !isPublic && !path.startsWith("/api/")) {
    const login = new URL("/login", resolveAppOrigin());
    login.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  return response;
}

export const config = {
  // Everything except static assets; API routes still get their session refreshed.
  matcher: ["/((?!_next/static|_next/image|monaco/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
