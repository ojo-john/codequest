import { execFile, type ExecFileException } from "node:child_process";
import {
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
 * Local Docker implementation of {@link SandboxProvider} — the spec §65 fallback runner and the
 * pre-flight check for the harness. Owner-local only: results from it are self-reported practice
 * evidence, never a trusted cloud grade, and it must never be exposed as a network service.
 *
 * Each session is a fresh container with networking disabled, all capabilities dropped,
 * no-new-privileges, and memory/CPU/PID caps; it is force-removed on stop. All docker
 * invocations use argument arrays, never a shell string.
 */

export const DOCKER_RUNNER_IMAGE = "codequest-runner:local";

const DOCKER_CLI_TIMEOUT_MS = 30_000;
const MEMORY_LIMIT = "2g";
const PIDS_LIMIT = "512";

interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function docker(
  args: readonly string[],
  options: { signal: AbortSignal; timeoutMs?: number; stdin?: string; maxBuffer?: number },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "docker",
      [...args],
      {
        signal: options.signal,
        timeout: options.timeoutMs ?? DOCKER_CLI_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
        encoding: "utf8",
      },
      (error: ExecFileException | null, stdout, stderr) => {
        if (error === null) return resolve({ exitCode: 0, stdout, stderr });
        if (error.name === "AbortError") return reject(error);
        if (typeof error.code === "number") return resolve({ exitCode: error.code, stdout, stderr });
        if (error.killed) {
          return reject(new SandboxInfrastructureError("docker_cli_timeout", true, `docker ${args[0]} timed out`, { cause: error }));
        }
        reject(new SandboxInfrastructureError("docker_unavailable", false, `docker ${args[0]} failed: ${error.message}`, { cause: error }));
      },
    );
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);
  });
}

export class DockerSandboxProvider implements SandboxProvider {
  constructor(private readonly image: string = DOCKER_RUNNER_IMAGE) {}

  async createSession(options: CreateSessionOptions): Promise<SandboxSession> {
    const lifetimeSeconds = Math.ceil(options.lifetimeMs / 1000);
    const run = await docker(
      [
        "run", "--detach", "--rm",
        "--platform", "linux/amd64",
        "--network", "none",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--memory", MEMORY_LIMIT,
        "--memory-swap", MEMORY_LIMIT,
        "--cpus", String(options.vcpus),
        "--pids-limit", PIDS_LIMIT,
        "--label", "app=codequest",
        this.image,
        // PID 1 bounds the container's life even if cleanup never runs.
        "sleep", String(lifetimeSeconds),
      ],
      { signal: options.signal },
    );
    if (run.exitCode !== 0) {
      throw new SandboxInfrastructureError("docker_run_failed", true, `docker run exited ${run.exitCode}: ${run.stderr.trim()}`);
    }
    return new DockerSandboxSession(run.stdout.trim());
  }
}

class DockerSandboxSession implements SandboxSession {
  private stopped = false;

  constructor(private readonly containerId: string) {}

  async writeLearnerFiles(files: readonly LearnerFile[], signal: AbortSignal): Promise<void> {
    for (const file of files) {
      // Paths were validated at the boundary; "$1" is passed positionally, not interpolated.
      const write = await docker(
        [
          "exec", "--interactive", "--user", SANDBOX_LAYOUT.learnerUser, this.containerId,
          "sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh",
          `${SANDBOX_LAYOUT.learnerHome}/${file.path}`,
        ],
        { signal, stdin: file.content },
      );
      if (write.exitCode !== 0) {
        throw new SandboxInfrastructureError("docker_write_failed", true, `writing ${file.path} exited ${write.exitCode}`);
      }
    }
  }

  async runHarness(args: readonly string[], options: { timeoutMs: number; signal: AbortSignal }): Promise<HarnessRunResult> {
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const result = await docker(
      [
        "exec", "--user", SANDBOX_LAYOUT.learnerUser, "--workdir", SANDBOX_LAYOUT.jobDir,
        this.containerId, SANDBOX_LAYOUT.harnessPath, ...args,
      ],
      { signal: AbortSignal.any([options.signal, timeout]), timeoutMs: options.timeoutMs },
    ).catch((error: unknown) => {
      // Our own per-command deadline: report it the way the remote provider's SIGKILL would.
      if (timeout.aborted && !options.signal.aborted) return { exitCode: 137, stdout: "", stderr: "" };
      throw error;
    });
    return { exitCode: result.exitCode, output: result.stdout + result.stderr };
  }

  async readFileBounded(path: string, maxBytes: number, signal: AbortSignal): Promise<string | undefined> {
    const read = await docker(["exec", this.containerId, "head", "-c", String(maxBytes), "--", path], { signal });
    return read.exitCode === 0 ? read.stdout : undefined;
  }

  async stop(signal: AbortSignal): Promise<SandboxUsage> {
    if (this.stopped) return {};
    const removed = await docker(["rm", "--force", this.containerId], { signal });
    if (removed.exitCode !== 0) {
      throw new SandboxInfrastructureError("docker_rm_failed", true, `docker rm exited ${removed.exitCode}`);
    }
    this.stopped = true;
    return {};
  }
}
