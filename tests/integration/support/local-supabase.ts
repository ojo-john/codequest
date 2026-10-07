import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { fetchWithTimeout } from "@/lib/db/supabase-server";

/**
 * Access to the LOCAL Supabase stack (`npx supabase start`). Refuses to run against anything
 * that isn't a loopback address, so integration tests can never touch a cloud project.
 */

interface LocalEnv {
  readonly API_URL: string;
  readonly DB_URL: string;
  readonly ANON_KEY: string;
  readonly SERVICE_ROLE_KEY: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
let cached: LocalEnv | undefined;

export function localEnv(): LocalEnv {
  if (cached) return cached;
  const raw = execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "ignore"] });
  const parsed = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, string>;
  for (const key of ["API_URL", "DB_URL"] as const) {
    const host = new URL(parsed[key]).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`refusing non-local ${key}: ${host}`);
  }
  cached = { API_URL: parsed.API_URL, DB_URL: parsed.DB_URL, ANON_KEY: parsed.ANON_KEY, SERVICE_ROLE_KEY: parsed.SERVICE_ROLE_KEY };
  return cached;
}

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: fetchWithTimeout(REQUEST_TIMEOUT_MS) },
};

export function serviceClient(): SupabaseClient {
  return createClient(localEnv().API_URL, localEnv().SERVICE_ROLE_KEY, clientOptions);
}

export function anonClient(): SupabaseClient {
  return createClient(localEnv().API_URL, localEnv().ANON_KEY, clientOptions);
}

let sqlHandle: postgres.Sql | undefined;

/** Superuser SQL for test setup/teardown and for asserting on things the API can't see. */
export function sql(): postgres.Sql {
  sqlHandle ??= postgres(localEnv().DB_URL, { max: 4, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });
  return sqlHandle;
}

export async function closeSql(): Promise<void> {
  await sqlHandle?.end({ timeout: 5 });
  sqlHandle = undefined;
}

export interface TestUser {
  readonly id: string;
  readonly client: SupabaseClient;
}

/** Creates a confirmed user and returns a client signed in as them. */
export async function createTestUser(label: string): Promise<TestUser> {
  const email = `${label}-${crypto.randomUUID()}@codequest.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const admin = serviceClient();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;

  const client = anonClient();
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { id: created.data.user.id, client };
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  const { error } = await serviceClient().auth.admin.deleteUser(user.id);
  if (error) throw error;
}
