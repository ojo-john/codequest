"use server";

import { redirect } from "next/navigation";
import { createUserClient } from "@/lib/supabase/server";

/** A Server Action rather than a route, so Next.js's built-in origin check blocks cross-site sign-out. */
export async function signOut(): Promise<never> {
  const supabase = await createUserClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
