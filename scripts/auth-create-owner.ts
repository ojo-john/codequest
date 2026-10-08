import { parseArgs } from "node:util";
import { z } from "zod";
import { createServiceRoleClient, loadSupabaseServerConfig } from "../lib/db/supabase-server";

/**
 * Creates (idempotently) the single owner account. Sign-ups are disabled, so this admin call is
 * the only way an account comes into existence.
 *
 *   npm run auth:create-owner -- --email you@example.com      # uses SUPABASE_URL + SUPABASE_SECRET_KEY
 */

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { email: { type: "string" } } });
  const email = z.email().parse(values.email?.trim().toLowerCase());
  const admin = createServiceRoleClient(loadSupabaseServerConfig(process.env));

  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error === null) {
    console.log(`Owner account created for ${email} (${data.user.id}). Sign in at /login.`);
    return;
  }
  if (error.code === "email_exists") {
    console.log(`An account for ${email} already exists; nothing to do.`);
    return;
  }
  throw error;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
