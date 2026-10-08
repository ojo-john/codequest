import { spawnSync } from "node:child_process";
import { DOCKER_RUNNER_IMAGE } from "../../lib/execution/docker-sandbox-provider";
import { ensureToolchainArtifacts } from "../fetch-toolchain";
import { loadToolchain, RUNNER_DIR } from "../toolchain";
import { DOCKERFILE_PATH, dockerBuildArgs } from "./image-inputs";

/** Builds the local execution image from the verified toolchain. Usage: npm run runner:docker-build */

async function main(): Promise<void> {
  await ensureToolchainArtifacts();
  const result = spawnSync(
    "docker",
    [
      "build",
      "--platform", "linux/amd64",
      "--tag", DOCKER_RUNNER_IMAGE,
      "--file", DOCKERFILE_PATH,
      ...dockerBuildArgs(loadToolchain()),
      RUNNER_DIR,
    ],
    { stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
