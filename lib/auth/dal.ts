import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Data Access Layer for identity (Next.js guidance: authorization lives next to the data, not in
 * the proxy). Identity comes from a verified JWT (`getClaims` checks the signature), never from
 * an unverified cookie read or a client-supplied id.
 */

export interface SessionUser {
  readonly userId: string;
  readonly email: string | undefined;
}

/** Memoised per request; undefined when signed out or the token doesn't verify. */
export const getSessionUser = cache(async (): Promise<SessionUser | undefined> => {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return undefined;
  const email = typeof data.claims.email === "string" ? data.claims.email : undefined;
  return { userId: data.claims.sub, email };
});

/** For pages and Server Actions: redirect to sign-in when there is no verified session. */
export async function requirePageUser(returnTo: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user === undefined) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user;
}
