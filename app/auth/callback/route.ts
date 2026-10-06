import { NextResponse, type NextRequest } from "next/server";
import { resolveAppOrigin } from "@/lib/app-origin";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { createLogger } from "@/lib/observability/log";
import { createUserClient } from "@/lib/supabase/server";

const logger = createLogger({ component: "auth" });

/** Magic-link return: exchanges the PKCE code for a session cookie, then continues to `next`. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Redirects use the configured origin, never the request's host: the host is client-influenced
  // (and the dev server reports it as localhost), and the session must land on the origin that
  // holds the PKCE verifier cookie.
  const origin = resolveAppOrigin();
  const code = request.nextUrl.searchParams.get("code");
  const next = safeRedirectPath(request.nextUrl.searchParams.get("next"));

  if (code === null) return NextResponse.redirect(new URL("/auth/error?reason=missing_code", origin));

  const supabase = await createUserClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Typical causes: link opened in another browser (no code verifier), expired or reused link.
    logger.log("warn", "auth.callback_failed", { code: error.code, status: error.status });
    logger.metric("auth.callback_failed", 1, { code: error.code ?? "unknown" });
    return NextResponse.redirect(new URL("/auth/error?reason=link_invalid", origin));
  }
  logger.log("info", "auth.signed_in");
  return NextResponse.redirect(new URL(next, origin));
}
