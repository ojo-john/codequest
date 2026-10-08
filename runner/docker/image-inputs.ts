import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { RUNNER_DIR, type Toolchain } from "../toolchain";

/** Inputs shared by the local image build and the Vercel Container Registry publish. */

export const DOCKERFILE_PATH = join(RUNNER_DIR, "docker", "Dockerfile");
export const IMAGE_REPOSITORY = "codequest-runner";

const CONTENT_INPUT_FILES = [
  "toolchain.json",
  "docker/Dockerfile",
  "harness/install-toolchain.sh",
  "harness/run.sh",
  "harness/build-contract-runner.sh",
];
const CONTENT_INPUT_DIRS = ["harness/contract-runner"];

function contentInputs(): string[] {
  const fromDirs = CONTENT_INPUT_DIRS.flatMap((dir) =>
    readdirSync(join(RUNNER_DIR, dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(RUNNER_DIR, join(entry.parentPath, entry.name)).split("\\").join("/")),
  );
  return [...CONTENT_INPUT_FILES, ...fromDirs].sort();
}

export function dockerBuildArgs(toolchain: Toolchain): string[] {
  return [
    "--build-arg", `BASE_IMAGE=${toolchain.baseImage}`,
    "--build-arg", `JDK_SHA256=${toolchain.jdk.sha256}`,
    "--build-arg", `JUNIT_SHA256=${toolchain.junit.sha256}`,
  ];
}

/** Tag derived from every file that shapes the image, so the same inputs give the same tag. */
export function contentTag(): string {
  const hash = createHash("sha256");
  for (const input of contentInputs()) {
    hash.update(input).update("\0").update(readFileSync(join(RUNNER_DIR, input))).update("\0");
  }
  return `inputs-${hash.digest("hex").slice(0, 16)}`;
}
