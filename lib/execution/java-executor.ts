import type { Logger } from "../observability/log";
import type { ExecutionLimits } from "./limits";
import {
  classifyCompile,
  classifyTest,
  type Classification,
  type ExecutionStage,
  type TestSummary,
  parseJUnitReport,
} from "./outcome";
import {
  isAbortError,
  SANDBOX_LAYOUT,
  SandboxInfrastructureError,
  type SandboxProvider,
  type SandboxSession,
} from "./sandbox-provider";
import type { ValidatedSourceSet } from "./source-files";

export interface ExecutionResult extends Classification {
  /** Stage the job reached; for failures, the stage that failed. */
  readonly stage: ExecutionStage;
  readonly compileOutput?: string;
  readonly testOutput?: string;
  readonly summary?: TestSummary;
  readonly infrastructureErrorType?: string;
  readonly retryable?: boolean;
  readonly timingsMs: Readonly<Partial<Record<ExecutionStage | "total", number>>>;
}

export interface ExecuteOptions {
  readonly requestId: string;
  /** Caller cancellation (client disconnect, explicit cancel). */
  readonly signal?: AbortSignal;
}

export interface JavaExecutor {
  execute(sources: ValidatedSourceSet, options: ExecuteOptions): Promise<ExecutionResult>;
}

export interface SandboxJavaExecutorDeps {
  readonly provider: SandboxProvider;
  readonly limits: ExecutionLimits;
  readonly logger: Logger;
  readonly now?: () => number;
}

/**
 * Compiles and tests a validated source set inside a fresh, disposable sandbox (spec §13/§65).
 *
 * Deadlines are layered: the harness's inner `timeout`, a per-command SIGKILL from the provider,
 * an overall lifetime AbortSignal here, and the sandbox's own platform timeout. The sandbox is
 * always stopped in cleanup. The whole job is not retried automatically — the provider SDK
 * already retries individual API calls with backoff, and a failed job is reported as
 * `infrastructure-error` so the learner (or a later reconcile) can resubmit.
 */
export class SandboxJavaExecutor implements JavaExecutor {
  private readonly provider: SandboxProvider;
  private readonly limits: ExecutionLimits;
  private readonly logger: Logger;
  private readonly now: () => number;

  constructor(deps: SandboxJavaExecutorDeps) {
    this.provider = deps.provider;
    this.limits = deps.limits;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => performance.now());
  }

  async execute(sources: ValidatedSourceSet, options: ExecuteOptions): Promise<ExecutionResult> {
    const log = this.logger.child({ requestId: options.requestId, component: "java-executor" });
    const limits = this.limits;
    const lifetimeMs = limits.sandboxLifetimeSeconds * 1000;
    const lifetime = AbortSignal.timeout(lifetimeMs);
    const signal = options.signal ? AbortSignal.any([options.signal, lifetime]) : lifetime;

    const startedAt = this.now();
    const timings: Partial<Record<ExecutionStage | "total", number>> = {};
    let stageStartedAt = startedAt;
    // Asserted (not annotated) so TS does not narrow it: the closures below reassign it.
    let stage = "provision" as ExecutionStage;
    const enterStage = (next: ExecutionStage) => {
      timings[stage] = Math.round(this.now() - stageStartedAt);
      stage = next;
      stageStartedAt = this.now();
    };

    let session: SandboxSession | undefined;
    let compileOutput: string | undefined;
    let testOutput: string | undefined;
    log.log("info", "execution.started", { files: sources.length });

    const finish = (classification: Classification, extra: Partial<ExecutionResult> = {}): ExecutionResult => {
      timings[stage] = Math.round(this.now() - stageStartedAt);
      timings.total = Math.round(this.now() - startedAt);
      const result: ExecutionResult = {
        ...classification,
        stage,
        compileOutput,
        testOutput,
        timingsMs: { ...timings },
        ...extra,
      };
      log.log(result.outcome === "infrastructure-error" ? "error" : "info", "execution.finished", {
        outcome: result.outcome,
        detail: result.detail,
        stage,
        totalMs: timings.total,
      });
      log.metric("execution.duration_ms", timings.total, { outcome: result.outcome, detail: result.detail });
      return result;
    };

    try {
      session = await this.provider.createSession({ lifetimeMs, vcpus: limits.vcpus, signal });
      await session.writeLearnerFiles(
        sources.map((file) => ({ path: `${SANDBOX_LAYOUT.jobDirRelative}/src/${file.path}`, content: file.content })),
        signal,
      );

      enterStage("compile");
      const compile = await session.runHarness(
        this.harnessArgs("compile", limits.compileWallSeconds),
        { timeoutMs: (limits.compileWallSeconds + limits.commandGraceSeconds) * 1000, signal },
      );
      compileOutput = boundOutput(compile.output, limits.maxOutputBytes);
      const compileFailure = classifyCompile(compile, limits.maxOutputBytes);
      if (compileFailure !== undefined) return finish(compileFailure);

      enterStage("test");
      const test = await session.runHarness(
        this.harnessArgs("test", limits.testWallSeconds),
        { timeoutMs: (limits.testWallSeconds + limits.commandGraceSeconds) * 1000, signal },
      );
      testOutput = boundOutput(test.output, limits.maxOutputBytes);

      enterStage("report");
      const reportXml = await session.readFileBounded(SANDBOX_LAYOUT.reportFile, limits.maxReportBytes, signal);
      const summary = reportXml === undefined ? undefined : parseJUnitReport(reportXml);
      return finish(classifyTest(test, summary, limits.maxOutputBytes), { summary });
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        if (options.signal?.aborted) {
          return finish({ outcome: "cancelled", detail: "cancelled_by_caller" });
        }
        // The lifetime expired. While learner code was running that is the learner's timeout;
        // during provisioning/reporting it is ours.
        return stage === "compile" || stage === "test"
          ? finish({ outcome: "timeout", detail: "lifetime_deadline" })
          : finish(
              { outcome: "infrastructure-error", detail: "lifetime_deadline" },
              { infrastructureErrorType: "lifetime_deadline", retryable: true },
            );
      }
      if (error instanceof SandboxInfrastructureError) {
        log.metric("execution.infrastructure_error", 1, { errorType: error.errorType, stage });
        return finish(
          { outcome: "infrastructure-error", detail: error.errorType },
          { infrastructureErrorType: error.errorType, retryable: error.retryable },
        );
      }
      // Anything else is a bug in our code; never disguise it as a learner outcome.
      throw error;
    } finally {
      if (session !== undefined) await this.cleanup(session, log);
    }
  }

  private harnessArgs(mode: "compile" | "test", wallSeconds: number): string[] {
    return [
      mode,
      SANDBOX_LAYOUT.jobDir,
      String(wallSeconds),
      String(this.limits.maxOutputBytes),
      String(this.limits.heapMb),
    ];
  }

  /** Best-effort stop with its own deadline; failures are logged and metricked, never thrown. */
  private async cleanup(session: SandboxSession, log: Logger): Promise<void> {
    try {
      const usage = await session.stop(AbortSignal.timeout(this.limits.cleanupTimeoutSeconds * 1000));
      if (usage.activeCpuMs !== undefined) log.metric("execution.active_cpu_ms", usage.activeCpuMs);
    } catch (error) {
      const errorType = error instanceof SandboxInfrastructureError ? error.errorType : "unknown";
      log.log("warn", "execution.cleanup_failed", { errorType, message: (error as Error).message });
      log.metric("execution.cleanup_failed", 1, { errorType });
    }
  }
}

/** Defence in depth: the harness already truncates, but never trust a remote byte count. */
export function boundOutput(output: string, maxBytes: number): string {
  const bytes = Buffer.from(output, "utf8");
  if (bytes.length <= maxBytes) return output;
  // Step back over UTF-8 continuation bytes so the cut never splits a character (a split one
  // would decode to a 3-byte U+FFFD and overshoot the limit).
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}
