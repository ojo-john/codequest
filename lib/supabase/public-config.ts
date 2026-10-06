import { z } from "zod";

/**
 * Browser-safe Supabase settings (publishable key only). Validated once; a missing value fails
 * at startup rather than as a confusing auth error later.
 */
const publicConfigSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

export type SupabasePublicConfig = Readonly<{ url: string; publishableKey: string }>;

export function loadSupabasePublicConfig(): SupabasePublicConfig {
  // Referenced individually so Next.js can inline NEXT_PUBLIC_* values at build time.
  const parsed = publicConfigSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return { url: parsed.NEXT_PUBLIC_SUPABASE_URL, publishableKey: parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
}
