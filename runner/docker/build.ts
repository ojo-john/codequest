import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { loadToolchain, RUNNER_DIR } from "../toolchain";
import { DOCKER_RUNNER_IMAGE } from "../../lib/execution/docker-sandbox-provider";

/** Builds the local execution image from the pinned toolchain. Usage: npm run runner:docker-build */

const toolchain = loadToolchain();
const result = spawnSync(
  "docker",
  [
    "build",
    "--platform", "linux/amd64",
    "--tag", DOCKER_RUNNER_IMAGE,
    "--file", join(RUNNER_DIR, "docker", "Dockerfile"),
    "--build-arg", `JDK_URL=${toolchain.jdk.url}`,
    "--build-arg", `JDK_SHA256=${toolchain.jdk.sha256}`,
    "--build-arg", `JUNIT_URL=${toolchain.junit.url}`,
    "--build-arg", `JUNIT_SHA256=${toolchain.junit.sha256}`,
    RUNNER_DIR,
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
