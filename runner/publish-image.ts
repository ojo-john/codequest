import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DOCKERFILE_PATH, IMAGE_REPOSITORY, contentTag, dockerBuildArgs } from "./docker/image-inputs";
import { ensureToolchainArtifacts } from "./fetch-toolchain";
import { loadToolchain, RUNNER_DIR } from "./toolchain";

/**
 * TRUSTED publish step (spec §65): builds the runner image and pushes it to the linked Vercel
 * project's container registry, then records the immutable digest reference in
 * runner/image-manifest.json. Learner executions use that digest via JAVA_RUNNER_IMAGE.
 *
 *   npx vercel vcr login docker   # registry credentials, valid ~12 h
 *   npm run runner:publish
 */

const PROJECT_ROOT = join(RUNNER_DIR, "..");
const VERCEL_BIN = join(PROJECT_ROOT, "node_modules", ".bin", "vercel");

async function main(): Promise<void> {
  const toolchain = loadToolchain();
  console.log("Fetching and verifying toolchain artifacts on the host ...");
  await ensureToolchainArtifacts();

  const reference = `${IMAGE_REPOSITORY}:${contentTag()}`;
  console.log(`Building and pushing ${reference} ...`);
  const build = spawnSync(
    VERCEL_BIN,
    [
      "vcr", "build", "docker", relative(PROJECT_ROOT, RUNNER_DIR), reference, "--push",
      "--", "--file", relative(PROJECT_ROOT, DOCKERFILE_PATH), ...dockerBuildArgs(toolchain),
    ],
    { cwd: PROJECT_ROOT, encoding: "utf8", stdio: ["inherit", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 },
  );
  const output = `${build.stdout ?? ""}${build.stderr ?? ""}`;
  if (build.status !== 0) {
    console.error(output.slice(-4000));
    throw new Error(`vercel vcr build exited ${build.status}; if credentials expired run \`npx vercel vcr login docker\``);
  }

  const digest = /pushing manifest for \S+@(sha256:[0-9a-f]{64})/.exec(output)?.[1];
  if (digest === undefined) throw new Error("could not find the pushed manifest digest in the build output");

  const image = `${IMAGE_REPOSITORY}@${digest}`;
  const manifest = {
    image,
    tag: reference,
    publishedAt: new Date().toISOString(),
    baseImage: toolchain.baseImage,
    jdk: { release: toolchain.jdk.release, sha256: toolchain.jdk.sha256, license: toolchain.jdk.license },
    junit: { version: toolchain.junit.version, sha256: toolchain.junit.sha256, license: toolchain.junit.license },
  };
  writeFileSync(join(RUNNER_DIR, "image-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\nPublished ${image}`);
  console.log("Next: set JAVA_RUNNER_IMAGE to that value in the Vercel project env, `npx vercel env pull .env.local`, then `npm run runner:check`.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
