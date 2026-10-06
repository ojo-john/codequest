import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { fetchWithTimeout } from "@/lib/db/supabase-server";
import { loadSupabasePublicConfig } from "./public-config";

/** Explicit deadline for every auth/data request made on the user's behalf. */
const USER_REQUEST_TIMEOUT_MS = 5000;

/**
 * Supabase client acting AS the signed-in user (publishable key + session cookie), so RLS
 * applies. For Server Components, Server Actions and Route Handlers.
 */
export async function createUserClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const config = loadSupabasePublicConfig();
  return createServerClient(config.url, config.publishableKey, {
    global: { fetch: fetchWithTimeout(USER_REQUEST_TIMEOUT_MS) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies; the proxy refreshes the session for them.
        }
      },
    },
  });
}
