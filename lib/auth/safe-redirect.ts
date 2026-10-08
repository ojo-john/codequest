/**
 * Post-sign-in destinations come from the URL, so they're attacker-controllable. Only same-site
 * absolute paths are allowed; anything else (other origins, protocol-relative `//evil`,
 * backslash tricks, control characters) falls back to the home page.
 */
export const DEFAULT_AFTER_SIGN_IN = "/";

export function safeRedirectPath(candidate: string | null | undefined): string {
  if (candidate === null || candidate === undefined || candidate === "") return DEFAULT_AFTER_SIGN_IN;
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/\\")) return DEFAULT_AFTER_SIGN_IN;
  if (/[\u0000-\u001f\u007f\\]/.test(candidate)) return DEFAULT_AFTER_SIGN_IN;
  if (candidate.length > 512) return DEFAULT_AFTER_SIGN_IN;
  // Resolve against a dummy origin: anything that escapes it is rejected.
  const resolved = new URL(candidate, "https://codequest.invalid");
  if (resolved.origin !== "https://codequest.invalid") return DEFAULT_AFTER_SIGN_IN;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
