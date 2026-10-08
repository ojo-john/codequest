import { APIError, Sandbox, StreamError } from "@vercel/sandbox";
import { z } from "zod";
import {
  isAbortError,
  SANDBOX_LAYOUT,
  SandboxInfrastructureError,
  type CreateSessionOptions,
  type HarnessRunResult,
  type LearnerFile,
  type SandboxProvider,
  type SandboxSession,
  type SandboxUsage,
} from "./sandbox-provider";

/**
 * Vercel Sandbox implementation of {@link SandboxProvider} (spec §65 primary candidate).
 *
 * Every session boots the digest-pinned runner image (runner/docker/Dockerfile, published to
 * Vercel Container Registry by `npm run runner:publish`) with outbound network denied,
 * persistence off, no environment variables and no application credentials inside the VM.
 * The image's default user is the unprivileged `learner` and it contains no `sudo`, so every
 * command — including the SDK's file writes — runs without privilege.
 *
 * Measured 2026-10-03: image boot ~0.7 s vs ~8 s for a snapshot restore of any size.
 */

const credentialsSchema = z.object({
  // Access-token auth is optional; without it the SDK uses VERCEL_OIDC_TOKEN (`vercel env pull`
  // locally, managed automatically on Vercel).
  VERCEL_TOKEN: z.string().min(1).optional(),
  VERCEL_TEAM_ID: z.string().min(1).optional(),
  VERCEL_PROJECT_ID: z.string().min(1).optional(),
});

const imageSchema = z.object({
  JAVA_RUNNER_IMAGE: z
    .string()
    .regex(/@sha256:[0-9a-f]{64}$/, "JAVA_RUNNER_IMAGE must be pinned by digest (run `npm run runner:publish`)"),
});

export type VercelCredentials = Readonly<{ token: string; teamId: string; projectId: string }>;

export type VercelSandboxConfig = Readonly<{
  image: string;
  credentials?: VercelCredentials;
}>;

type Env = Readonly<Record<string, string | undefined>>;

/** Explicit access-token credentials, or undefined to let the SDK use the OIDC token. */
export function loadVercelCredentials(env: Env = process.env): VercelCredentials | undefined {
  const { VERCEL_TOKEN: token, VERCEL_TEAM_ID: teamId, VERCEL_PROJECT_ID: projectId } = credentialsSchema.parse(env);
  if (token === undefined && teamId === undefined && projectId === undefined) return undefined;
  if (token === undefined || teamId === undefined || projectId === undefined) {
    throw new Error("VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID must be set together");
  }
  return { token, teamId, projectId };
}

export function loadVercelSandboxConfig(env: Env = process.env): VercelSandboxConfig {
  const { JAVA_RUNNER_IMAGE: image } = imageSchema.parse(env);
  const credentials = loadVercelCredentials(env);
  return credentials === undefined ? { image } : { image, credentials };
}

export class VercelSandboxProvider implements SandboxProvider {
  constructor(private readonly config: VercelSandboxConfig) {}

  async createSession(options: CreateSessionOptions): Promise<SandboxSession> {
    const sandbox = await translateErrors("create", () =>
      Sandbox.create({
        ...(this.config.credentials ?? {}),
        image: this.config.image,
        networkPolicy: "deny-all",
        persistent: false,
        timeout: options.lifetimeMs,
        resources: { vcpus: options.vcpus },
        tags: { app: "codequest", purpose: "learner-execution" },
        signal: options.signal,
      }),
    );
    return new VercelSandboxSession(sandbox);
  }
}

class VercelSandboxSession implements SandboxSession {
  private stopped = false;

  constructor(private readonly sandbox: Sandbox) {}

  async writeLearnerFiles(files: readonly LearnerFile[], signal: AbortSignal): Promise<void> {
    // Absolute paths: the image's default user is `learner`, so these files are learner-owned.
    await translateErrors("write_files", () =>
      this.sandbox.writeFiles(
        files.map((file) => ({ path: `${SANDBOX_LAYOUT.learnerHome}/${file.path}`, content: Buffer.from(file.content, "utf8") })),
        { signal },
      ),
    );
  }

  async runHarness(args: readonly string[], options: { timeoutMs: number; signal: AbortSignal }): Promise<HarnessRunResult> {
    return translateErrors("run_harness", async () => {
      const finished = await this.sandbox.runCommand({
        cmd: SANDBOX_LAYOUT.harnessPath,
        args: [...args],
        cwd: SANDBOX_LAYOUT.jobDir,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
      const output = await finished.output("both", { signal: options.signal });
      return { exitCode: finished.exitCode, output };
    });
  }

  async readFileBounded(path: string, maxBytes: number, signal: AbortSignal): Promise<string | undefined> {
    // `head -c` bounds what crosses the wire even if learner code wrote a huge file.
    return translateErrors("read_file", async () => {
      const finished = await this.sandbox.runCommand({ cmd: "head", args: ["-c", String(maxBytes), "--", path], signal });
      if (finished.exitCode !== 0) return undefined;
      return finished.stdout({ signal });
    });
  }

  async stop(signal: AbortSignal): Promise<SandboxUsage> {
    if (this.stopped) return {};
    const final = await translateErrors("stop", () => this.sandbox.stop({ signal }));
    this.stopped = true;
    return { activeCpuMs: final.activeCpuDurationMs ?? undefined };
  }
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Maps provider failures onto typed, classified infrastructure errors. Aborts propagate
 * unchanged so the executor can tell cancellation/deadlines apart from platform faults.
 */
async function translateErrors<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof APIError) {
      const status = error.response.status;
      if (status === 401 || status === 403) {
        throw new SandboxInfrastructureError("provider_auth", false, `${operation}: sandbox auth failed (${status})`, { cause: error });
      }
      if (status === 402) {
        // Hobby quota exhausted: sandbox creation pauses rather than billing (spec §64).
        throw new SandboxInfrastructureError("provider_quota", false, `${operation}: sandbox quota exhausted`, { cause: error });
      }
      throw new SandboxInfrastructureError(
        `provider_http_${status}`,
        RETRYABLE_STATUS.has(status),
        `${operation}: sandbox API returned ${status}`,
        { cause: error },
      );
    }
    if (error instanceof StreamError) {
      throw new SandboxInfrastructureError("provider_stream", true, `${operation}: stream error ${error.code}`, { cause: error });
    }
    if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
      throw new SandboxInfrastructureError("provider_network", true, `${operation}: network error`, { cause: error });
    }
    throw error;
  }
}
