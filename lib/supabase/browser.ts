"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSupabasePublicConfig } from "./public-config";

let client: SupabaseClient | undefined;

/** The signed-in learner's client in the browser (publishable key; RLS applies). */
export function browserClient(): SupabaseClient {
  if (client) return client;
  const config = loadSupabasePublicConfig();
  client = createBrowserClient(config.url, config.publishableKey);
  return client;
}
