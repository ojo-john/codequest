import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_SIGN_IN, safeRedirectPath } from "@/lib/auth/safe-redirect";
import { LOCAL_DEV_ORIGIN, resolveAppOrigin } from "@/lib/app-origin";

describe("safeRedirectPath", () => {
  it.each([
    ["https://evil.example/phish", "absolute URL"],
    ["//evil.example/phish", "protocol-relative URL"],
    ["/\\evil.example", "backslash after slash"],
    ["/%5C%5Cevil.example", "encoded backslashes stay a path"],
    ["javascript:alert(1)", "javascript scheme"],
    ["/ok\u0000/x", "NUL byte"],
    ["/ok\nLocation: https://evil.example", "header injection attempt"],
    ["relative/path", "relative path"],
    [`/${"a".repeat(600)}`, "overlong path"],
  ])("safeRedirectPath_%j (%s)_staysOnSite", (candidate) => {
    const result = safeRedirectPath(candidate);

    expect(new URL(result, "https://codequest.invalid").origin).toBe("https://codequest.invalid");
  });

  it.each([null, undefined, ""])("safeRedirectPath_missing %j_returnsHome", (candidate) => {
    expect(safeRedirectPath(candidate)).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it("safeRedirectPath_protocolRelative_returnsHome", () => {
    expect(safeRedirectPath("//evil.example")).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it("safeRedirectPath_samePathWithQueryAndHash_isPreserved", () => {
    expect(safeRedirectPath("/sessions/42?tab=code#editor")).toBe("/sessions/42?tab=code#editor");
  });

  it("safeRedirectPath_dotSegments_areNormalisedWithinSite", () => {
    expect(safeRedirectPath("/a/../../b")).toBe("/b");
  });
});

describe("resolveAppOrigin", () => {
  it("resolveAppOrigin_explicitOrigin_wins", () => {
    expect(resolveAppOrigin({ APP_ORIGIN: "https://codequest.example", VERCEL_URL: "x.vercel.app" })).toBe("https://codequest.example");
  });

  it("resolveAppOrigin_originWithPath_isRejected", () => {
    expect(() => resolveAppOrigin({ APP_ORIGIN: "https://codequest.example/app" })).toThrow();
  });

  it("resolveAppOrigin_vercelProduction_usesProductionDomain", () => {
    expect(resolveAppOrigin({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "codequest.vercel.app", VERCEL_URL: "codequest-abc.vercel.app" })).toBe(
      "https://codequest.vercel.app",
    );
  });

  it("resolveAppOrigin_vercelPreview_usesDeploymentUrl", () => {
    expect(resolveAppOrigin({ VERCEL_ENV: "preview", VERCEL_URL: "codequest-abc.vercel.app" })).toBe("https://codequest-abc.vercel.app");
  });

  it("resolveAppOrigin_productionOutsideVercelWithoutOrigin_throws", () => {
    expect(() => resolveAppOrigin({ NODE_ENV: "production" })).toThrow(/APP_ORIGIN/);
  });

  it("resolveAppOrigin_localDevelopment_usesLocalServer", () => {
    expect(resolveAppOrigin({ NODE_ENV: "development" })).toBe(LOCAL_DEV_ORIGIN);
  });
});
