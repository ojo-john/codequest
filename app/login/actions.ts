"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveAppOrigin } from "@/lib/app-origin";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { createLogger } from "@/lib/observability/log";
import { createUserClient } from "@/lib/supabase/server";

export type SignInState =
  | { readonly status: "idle" }
  | { readonly status: "sent"; readonly email: string }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "error"; readonly message: string };

const emailSchema = z.email().max(254);
const logger = createLogger({ component: "auth" });

/**
 * Emails a sign-in link (PKCE). Never creates accounts: CodeQuest is single-owner and sign-ups
 * are disabled. The response is the same whether or not the address has an account, so the form
 * can't be used to discover who has access.
 */
export async function requestSignInLink(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const requestId = randomUUID();
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { status: "invalid", message: "Enter a valid email address." };

  const next = safeRedirectPath(String(formData.get("next") ?? ""));
  const callback = new URL("/auth/callback", resolveAppOrigin());
  callback.searchParams.set("next", next);

  const supabase = await createUserClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: { shouldCreateUser: false, emailRedirectTo: callback.toString() },
  });

  if (error === null) {
    logger.log("info", "auth.sign_in_link_sent", { requestId });
    return { status: "sent", email: parsed.data };
  }
  // Unknown address: report success anyway (no account enumeration).
  if (error.code === "otp_disabled" || error.code === "signup_disabled" || error.code === "user_not_found") {
    logger.log("info", "auth.sign_in_link_unknown_address", { requestId });
    return { status: "sent", email: parsed.data };
  }
  if (error.code === "over_email_send_rate_limit" || error.status === 429) {
    logger.metric("auth.sign_in_rate_limited", 1);
    return { status: "error", message: "Too many sign-in emails were requested. Wait a few minutes and try again." };
  }
  logger.log("error", "auth.sign_in_link_failed", { requestId, code: error.code, status: error.status });
  logger.metric("auth.sign_in_link_failed", 1, { code: error.code ?? "unknown" });
  return { status: "error", message: "Couldn't send the sign-in email right now. Please try again." };
}
