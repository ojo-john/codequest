import { describe, expect, it } from "vitest";
import { loadVercelSandboxConfig } from "@/lib/execution/vercel-sandbox-provider";

const IMAGE = `registry.example/java-runner@sha256:${"a".repeat(64)}`;

describe("loadVercelSandboxConfig", () => {
  it("loadVercelSandboxConfig_platformSetsProjectIdWithoutToken_usesOidc", () => {
    const config = loadVercelSandboxConfig({ JAVA_RUNNER_IMAGE: IMAGE, VERCEL_PROJECT_ID: "prj_1", VERCEL_TEAM_ID: "team_1" });

    expect(config).toEqual({ image: IMAGE });
  });

  it("loadVercelSandboxConfig_noVercelVariables_usesOidc", () => {
    const config = loadVercelSandboxConfig({ JAVA_RUNNER_IMAGE: IMAGE });

    expect(config).toEqual({ image: IMAGE });
  });

  it("loadVercelSandboxConfig_tokenWithTeamAndProject_usesTokenCredentials", () => {
    const config = loadVercelSandboxConfig({ JAVA_RUNNER_IMAGE: IMAGE, VERCEL_TOKEN: "t", VERCEL_TEAM_ID: "team_1", VERCEL_PROJECT_ID: "prj_1" });

    expect(config.credentials).toEqual({ token: "t", teamId: "team_1", projectId: "prj_1" });
  });

  it("loadVercelSandboxConfig_tokenWithoutProject_throws", () => {
    expect(() => loadVercelSandboxConfig({ JAVA_RUNNER_IMAGE: IMAGE, VERCEL_TOKEN: "t", VERCEL_TEAM_ID: "team_1" })).toThrow(/VERCEL_PROJECT_ID/);
  });

  it("loadVercelSandboxConfig_imageNotPinnedByDigest_throws", () => {
    expect(() => loadVercelSandboxConfig({ JAVA_RUNNER_IMAGE: "registry.example/java-runner:latest" })).toThrow(/digest/);
  });
});
