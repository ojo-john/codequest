/**
 * Narrow port over the sandbox platform, so the executor can be unit-tested without real
 * infrastructure and the provider (Vercel Sandbox today, a local runner as the §65 fallback) can
 * be swapped. Implementations must translate provider failures into
 * {@link SandboxInfrastructureError} and let AbortSignal aborts propagate unchanged.
 */

/** Filesystem layout baked into the execution snapshot by runner/prepare-snapshot.ts. */
export const SANDBOX_LAYOUT = Object.freeze({
  learnerUser: "learner",
  learnerHome: "/home/learner",
  /** Relative to the learner's home; the executor writes sources under `job/src/`. */
  jobDirRelative: "job",
  jobDir: "/home/learner/job",
  harnessPath: "/opt/codequest/run.sh",
  jdkHome: "/opt/codequest/jdk",
  junitJar: "/opt/codequest/lib/junit-platform-console-standalone.jar",
  reportFile: "/home/learner/job/reports/TEST-junit-jupiter.xml",
});

export interface LearnerFile {
  /** Path relative to the learner's home directory. */
  readonly path: string;
  readonly content: string;
}

export interface HarnessRunResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface SandboxUsage {
  readonly activeCpuMs?: number;
}

export interface SandboxSession {
  writeLearnerFiles(files: readonly LearnerFile[], signal: AbortSignal): Promise<void>;
  /** Runs the trusted harness as the unprivileged learner user with positional arguments. */
  runHarness(args: readonly string[], options: { timeoutMs: number; signal: AbortSignal }): Promise<HarnessRunResult>;
  /** Reads at most `maxBytes` of a file; undefined when it does not exist. */
  readFileBounded(path: string, maxBytes: number, signal: AbortSignal): Promise<string | undefined>;
  /** Stops and disposes the sandbox. Safe to call more than once. */
  stop(signal: AbortSignal): Promise<SandboxUsage>;
}

export interface CreateSessionOptions {
  readonly lifetimeMs: number;
  readonly vcpus: number;
  readonly signal: AbortSignal;
}

export interface SandboxProvider {
  createSession(options: CreateSessionOptions): Promise<SandboxSession>;
}

/** Provider/platform failure. Never a learner failure. */
export class SandboxInfrastructureError extends Error {
  readonly errorType: string;
  readonly retryable: boolean;

  constructor(errorType: string, retryable: boolean, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SandboxInfrastructureError";
    this.errorType = errorType;
    this.retryable = retryable;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}
