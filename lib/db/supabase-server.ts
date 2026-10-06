import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Server-only Supabase client using the secret (service role) key. It bypasses RLS, so use it
 * only inside trusted server transactions (grading, ledger, content pipeline) — never with a
 * user id taken from the browser (spec §66). Never import this from client components.
 */

const serverConfigSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(20, "SUPABASE_SECRET_KEY is required (server-only)"),
  SUPABASE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type SupabaseServerConfig = Readonly<{ url: string; secretKey: string; requestTimeoutMs: number }>;

export function loadSupabaseServerConfig(env: Readonly<Record<string, string | undefined>> = process.env): SupabaseServerConfig {
  const parsed = serverConfigSchema.parse(env);
  return { url: parsed.SUPABASE_URL, secretKey: parsed.SUPABASE_SECRET_KEY, requestTimeoutMs: parsed.SUPABASE_REQUEST_TIMEOUT_MS };
}

/** Every request gets an explicit deadline in addition to any caller signal. */
export function fetchWithTimeout(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    return fetch(input, { ...init, signal });
  };
}

export function createServiceRoleClient(config: SupabaseServerConfig): SupabaseClient {
  return createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchWithTimeout(config.requestTimeoutMs) },
  });
}
