import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { loadToolchain, RUNNER_DIR } from "./toolchain";

/**
 * Downloads the pinned toolchain artifacts once into runner/.cache (git-ignored), verifying
 * SHA-256 against runner/toolchain.json. The runner image — both the one published to Vercel and
 * the local Docker build — installs from these verified files, so no build step downloads
 * anything or needs a package manager.
 */

export const CACHE_DIR = join(RUNNER_DIR, ".cache");
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export interface ToolchainArtifacts {
  readonly jdkTarball: string;
  readonly junitJar: string;
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function ensureArtifact(url: string, expectedSha256: string, fileName: string): Promise<string> {
  const target = join(CACHE_DIR, fileName);
  if (existsSync(target) && (await sha256Of(target)) === expectedSha256) return target;

  const partial = `${target}.partial`;
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: "follow" });
  if (!response.ok || response.body === null) {
    throw new Error(`download failed: ${url} -> HTTP ${response.status}`);
  }
  const hash = createHash("sha256");
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), hashing, createWriteStream(partial));

  const actual = hash.digest("hex");
  if (actual !== expectedSha256) {
    rmSync(partial, { force: true });
    throw new Error(`checksum mismatch for ${url}: expected ${expectedSha256}, got ${actual}`);
  }
  renameSync(partial, target);
  return target;
}

export async function ensureToolchainArtifacts(): Promise<ToolchainArtifacts> {
  const toolchain = loadToolchain();
  mkdirSync(CACHE_DIR, { recursive: true });
  const [jdkTarball, junitJar] = await Promise.all([
    ensureArtifact(toolchain.jdk.url, toolchain.jdk.sha256, "jdk.tar.gz"),
    ensureArtifact(toolchain.junit.url, toolchain.junit.sha256, "junit-platform-console-standalone.jar"),
  ]);
  return { jdkTarball, junitJar };
}
