import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { SANDBOX_LAYOUT } from "../lib/execution/sandbox-provider";
import { loadVercelCredentials } from "../lib/execution/vercel-sandbox-provider";
import { loadToolchain, RUNNER_DIR } from "./toolchain";

/**
 * TRUSTED preparation stage (spec §65): builds the Java execution snapshot on Vercel Sandbox.
 *
 *   npm run runner:prepare
 *
 * Starts the pinned base image with network access limited to the toolchain hosts, installs the
 * checksum-verified JDK + JUnit and the root-owned harness, creates the unprivileged learner
 * user, locks the network down, snapshots, and records everything in runner/snapshot-manifest.json.
 * Re-run when the snapshot expires or runner/toolchain.json changes.
 */

const settingsSchema = z.object({
  SNAPSHOT_EXPIRATION_DAYS: z.coerce.number().int().positive().default(30),
  PREPARE_TIMEOUT_MINUTES: z.coerce.number().int().positive().max(45).default(15),
});

const STAGING_DIR = "/tmp/codequest-prepare";
const MS_PER_DAY = 86_400_000;

async function run(sandbox: Sandbox, cmd: string, args: string[], options: { sudo?: boolean; user?: string } = {}): Promise<string> {
  const target = options.user ? sandbox.asUser(options.user) : sandbox;
  const finished = await target.runCommand({ cmd, args, sudo: options.sudo ?? false });
  const output = await finished.output("both");
  if (finished.exitCode !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${finished.exitCode}:\n${output.slice(-4000)}`);
  }
  return output;
}

async function main(): Promise<void> {
  const settings = settingsSchema.parse(process.env);
  const toolchain = loadToolchain();
  const credentials = loadVercelCredentials(process.env);

  console.log(`Creating preparation sandbox from ${toolchain.baseImage} ...`);
  const sandbox = await Sandbox.create({
    ...(credentials ?? {}),
    image: toolchain.baseImage,
    networkPolicy: { allow: [...toolchain.prepareNetworkAllowlist] },
    persistent: false,
    timeout: settings.PREPARE_TIMEOUT_MINUTES * 60_000,
    resources: { vcpus: 2 },
    tags: { app: "codequest", purpose: "prepare-snapshot" },
  });

  let snapshotTaken = false;
  try {
    const harnessDir = join(RUNNER_DIR, "harness");
    await sandbox.writeFiles([
      { path: `${STAGING_DIR}/install-toolchain.sh`, content: readFileSync(join(harnessDir, "install-toolchain.sh")) },
      { path: `${STAGING_DIR}/run.sh`, content: readFileSync(join(harnessDir, "run.sh")) },
    ]);

    console.log("Installing pinned toolchain (checksums verified inside the sandbox) ...");
    const installLog = await run(
      sandbox,
      "bash",
      [`${STAGING_DIR}/install-toolchain.sh`, toolchain.jdk.url, toolchain.jdk.sha256, toolchain.junit.url, toolchain.junit.sha256, `${STAGING_DIR}/run.sh`],
      { sudo: true },
    );
    await run(sandbox, "rm", ["-rf", STAGING_DIR], { sudo: true });

    console.log(`Creating unprivileged user '${SANDBOX_LAYOUT.learnerUser}' ...`);
    await sandbox.createUser(SANDBOX_LAYOUT.learnerUser);

    const javaVersion = await run(sandbox, `${SANDBOX_LAYOUT.jdkHome}/bin/java`, ["-version"], { user: SANDBOX_LAYOUT.learnerUser });
    // The learner must not be able to modify the harness or toolchain.
    const writable = await sandbox.asUser(SANDBOX_LAYOUT.learnerUser).runCommand({ cmd: "test", args: ["-w", SANDBOX_LAYOUT.harnessPath] });
    if (writable.exitCode === 0) throw new Error("harness is writable by the learner user");
    const sudoProbe = await sandbox.asUser(SANDBOX_LAYOUT.learnerUser).runCommand({ cmd: "sudo", args: ["-n", "true"] });
    if (sudoProbe.exitCode === 0) throw new Error("learner user can sudo");
    const curlProbe = await sandbox.runCommand({ cmd: "bash", args: ["-c", "command -v curl"] });
    if (curlProbe.exitCode === 0) throw new Error("curl is still installed after preparation");

    await sandbox.update({ networkPolicy: "deny-all" });

    console.log("Taking snapshot ...");
    const snapshot = await sandbox.snapshot({ expiration: settings.SNAPSHOT_EXPIRATION_DAYS * MS_PER_DAY });
    snapshotTaken = true;

    const manifest = {
      snapshotId: snapshot.snapshotId,
      createdAt: snapshot.createdAt.toISOString(),
      expiresAt: snapshot.expiresAt?.toISOString() ?? null,
      sizeBytes: snapshot.sizeBytes,
      regions: snapshot.regions,
      baseImage: toolchain.baseImage,
      jdk: { release: toolchain.jdk.release, sha256: toolchain.jdk.sha256, license: toolchain.jdk.license },
      junit: { version: toolchain.junit.version, sha256: toolchain.junit.sha256, license: toolchain.junit.license },
      javaVersion: javaVersion.trim(),
      installLogTail: installLog.split("\n").slice(-15).join("\n"),
    };
    writeFileSync(join(RUNNER_DIR, "snapshot-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(`\nSnapshot ready: ${snapshot.snapshotId} (expires ${manifest.expiresAt ?? "never"})`);
    console.log("Next: set JAVA_SNAPSHOT_ID in .env.local (and in the Vercel project env), then run `npm run runner:check`.");
  } finally {
    if (!snapshotTaken) {
      await sandbox.stop().catch((error: unknown) => console.error("warning: failed to stop preparation sandbox", error));
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
