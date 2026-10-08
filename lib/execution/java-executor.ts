import type { Logger } from "../observability/log";
import { gradeContract, parseContractResults, publicContractSpec, type CaseResult, type ContractDefinition } from "./contract";
import type { ExecutionLimits } from "./limits";
import {
  classifyCompile,
  classifyRunFailure,
  classifyTest,
  type Classification,
  type ExecutionStage,
  KILLED_EXIT_CODE,
  type TestSummary,
  parseJUnitReport,
} from "./outcome";
import {
  isAbortError,
  SANDBOX_LAYOUT,
  SandboxInfrastructureError,
  type SandboxProvider,
  type SandboxSession,
  type SandboxUsage,
} from "./sandbox-provider";
import type { ValidatedSourceSet } from "./source-files";
import { hasLearnerTests, scoreTestQuality, type TestQualityReport, type TestQualitySpec, type VariantVerdict } from "./test-quality";

export interface ExecutionResult extends Classification {
  /** Stage the job reached; for failures, the stage that failed. */
  readonly stage: ExecutionStage;
  readonly compileOutput?: string;
  readonly testOutput?: string;
  readonly summary?: TestSummary;
  readonly infrastructureErrorType?: string;
  readonly retryable?: boolean;
  readonly timingsMs: Readonly<Partial<Record<ExecutionStage | "total", number>>>;
  /** Provider-measured active CPU for the whole sandbox; undefined when the provider can't tell. */
  readonly activeCpuMs?: number;
  /** Contract mode only: per-case results (details only for visible samples). */
  readonly caseResults?: readonly CaseResult[];
  /** The learner's own JUnit tests run on their own code (shown to them; never decides the outcome). */
  readonly learnerTests?: LearnerTestRun;
  /** How well the learner's tests catch bugs (submit with a test-quality spec only). */
  readonly testQuality?: TestQualityReport;
}

export interface LearnerTestRun extends Classification {
  readonly summary?: TestSummary;
  readonly output: string;
}

/**
 * How correctness is decided. `contract` keeps every expected value on the server and is the
 * mode to use for hidden grading; `junit` runs JUnit tests that are part of the sources (learner-
 * written tests and visible samples), whose assertions share the JVM with learner code.
 */
export type GradingMode = { readonly kind: "junit" } | { readonly kind: "contract"; readonly contract: ContractDefinition };

export interface ExecuteOptions {
  readonly requestId: string;
  /** Defaults to JUnit. */
  readonly grading?: GradingMode;
  /** Caller cancellation (client disconnect, explicit cancel). */
  readonly signal?: AbortSignal;
  /** Contract mode: also run the learner's JUnit tests (under src/test/java) on their own code. */
  readonly runLearnerTests?: boolean;
  /** Contract mode: grade the learner's tests against the reference and its mutants. */
  readonly testQuality?: TestQualitySpec;
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
    const started: { session?: SandboxSession } = {};
    let usage: SandboxUsage = {};
    let result: ExecutionResult;
    try {
      result = await this.runJob(sources, options, started, log);
    } finally {
      if (started.session !== undefined) usage = await this.cleanup(started.session, log);
    }
    return usage.activeCpuMs === undefined ? result : { ...result, activeCpuMs: usage.activeCpuMs };
  }

  private async runJob(
    sources: ValidatedSourceSet,
    options: ExecuteOptions,
    started: { session?: SandboxSession },
    log: Logger,
  ): Promise<ExecutionResult> {
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
      const session = await this.provider.createSession({ lifetimeMs, vcpus: limits.vcpus, signal });
      started.session = session;
      const grading: GradingMode = options.grading ?? { kind: "junit" };
      const files = sources.map((file) => ({ path: `${SANDBOX_LAYOUT.jobDirRelative}/src/${file.path}`, content: file.content }));
      if (grading.kind === "contract") {
        // Only the public scenario goes in; expected values never leave the server.
        files.push({ path: SANDBOX_LAYOUT.contractFileRelative, content: JSON.stringify(publicContractSpec(grading.contract)) });
      }
      await session.writeLearnerFiles(files, signal);

      enterStage("compile");
      const compile = await session.runHarness(
        this.harnessArgs("compile", limits.compileWallSeconds),
        { timeoutMs: (limits.compileWallSeconds + limits.commandGraceSeconds) * 1000, signal },
      );
      compileOutput = boundOutput(compile.output, limits.maxOutputBytes);
      const compileFailure = classifyCompile(compile, limits.maxOutputBytes);
      if (compileFailure !== undefined) return finish(compileFailure);

      enterStage("test");
      if (grading.kind === "contract") {
        const run = await session.runHarness(this.harnessArgs("contract", limits.testWallSeconds), {
          timeoutMs: (limits.testWallSeconds + limits.commandGraceSeconds) * 1000,
          signal,
        });
        testOutput = boundOutput(run.output, limits.maxOutputBytes);
        const runFailure = classifyRunFailure(run, limits.maxOutputBytes);
        if (runFailure !== undefined) return finish(runFailure);

        enterStage("report");
        const resultsText = await session.readFileBounded(SANDBOX_LAYOUT.contractResultsFile, limits.maxReportBytes, signal);
        const grade = gradeContract(grading.contract, parseContractResults(resultsText ?? ""), run.exitCode);
        const extras = await this.learnerTestExtras(session, sources, options, signal, startedAt + lifetimeMs, log);
        return finish(grade, { summary: grade.summary, caseResults: grade.cases, ...extras });
      }
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
    }
  }

  /**
   * After contract grading: the learner's own tests, and the test-quality variants. These never
   * change the contract outcome, so a time-budget or infrastructure problem here degrades to
   * "no extra result" instead of failing a job that was already graded. Caller cancellation
   * still propagates.
   */
  private async learnerTestExtras(
    session: SandboxSession,
    sources: ValidatedSourceSet,
    options: ExecuteOptions,
    signal: AbortSignal,
    lifetimeEndsAt: number,
    log: Logger,
  ): Promise<Pick<ExecutionResult, "learnerTests" | "testQuality">> {
    if (!options.runLearnerTests && options.testQuality === undefined) return {};
    if (!hasLearnerTests(sources)) {
      return options.testQuality ? { testQuality: { status: "no_tests", caught: [], missed: [], total: options.testQuality.mutants.length } } : {};
    }
    const deadline = lifetimeEndsAt - EXTRAS_SAFETY_MS;
    const extras: { learnerTests?: LearnerTestRun; testQuality?: TestQualityReport } = {};
    try {
      if (options.runLearnerTests) extras.learnerTests = await this.runLearnerTests(session, signal, deadline);
      if (options.testQuality) extras.testQuality = await this.gradeLearnerTests(session, options.testQuality, signal, deadline);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (!(error instanceof SandboxInfrastructureError) && !isAbortError(error) && !signal.aborted) throw error;
      const errorType = error instanceof SandboxInfrastructureError ? error.errorType : "lifetime_deadline";
      log.log("warn", "execution.learner_tests_incomplete", { errorType });
      log.metric("execution.learner_tests_incomplete", 1, { errorType });
      if (options.testQuality && extras.testQuality === undefined) {
        extras.testQuality = { status: "incomplete", caught: [], missed: [], total: options.testQuality.mutants.length };
      }
    }
    return extras;
  }

  private async runLearnerTests(session: SandboxSession, signal: AbortSignal, deadline: number): Promise<LearnerTestRun | undefined> {
    const wall = this.wallWithin(this.limits.testWallSeconds, deadline);
    if (wall === undefined) return undefined;
    const test = await session.runHarness(this.harnessArgs("test", wall), { timeoutMs: (wall + this.limits.commandGraceSeconds) * 1000, signal });
    const reportXml = await session.readFileBounded(SANDBOX_LAYOUT.reportFile, this.limits.maxReportBytes, signal);
    const summary = reportXml === undefined ? undefined : parseJUnitReport(reportXml);
    return { ...classifyTest(test, summary, this.limits.maxOutputBytes), summary, output: boundOutput(test.output, this.limits.maxOutputBytes) };
  }

  /**
   * Runs the learner's tests against the reference (overlay 0) and then each mutant, in one
   * harness call. Each overlay is a single replacement file compiled on top of the already
   * compiled project, so a variant costs one small javac and one test run.
   */
  private async gradeLearnerTests(session: SandboxSession, spec: TestQualitySpec, signal: AbortSignal, deadline: number): Promise<TestQualityReport> {
    const variants = [spec.baseline, ...spec.mutants.map((mutant) => mutant.content)];
    await session.writeLearnerFiles(
      variants.map((content, index) => ({ path: `${SANDBOX_LAYOUT.jobDirRelative}/${OVERLAYS_DIR}/o${index}/src/${spec.target}`, content })),
      signal,
    );
    // Whole milliseconds: the clock is fractional and AbortSignal.timeout rejects non-integers.
    const budgetMs = Math.floor(deadline - this.now());
    const stepWall = this.wallWithin(this.limits.testWallSeconds, deadline);
    if (stepWall === undefined) return scoreTestQuality(spec, { kind: "not_run" }, []);
    // The loop as a whole is bounded by the remaining budget; overlays it didn't reach count as not run.
    await session.runHarness(this.harnessArgs("overlays", stepWall), { timeoutMs: budgetMs, signal });

    const results = parseOverlayResults((await session.readFileBounded(`${SANDBOX_LAYOUT.jobDir}/${OVERLAYS_DIR}/results.txt`, OVERLAY_RESULTS_MAX_BYTES, signal)) ?? "");
    let baseline = results.get(0) ?? { kind: "not_run" };
    if (baseline.kind === "tests_failed") {
      const reportXml = await session.readFileBounded(`${SANDBOX_LAYOUT.jobDir}/${OVERLAYS_DIR}/o0/reports/TEST-junit-jupiter.xml`, this.limits.maxReportBytes, signal);
      baseline = { kind: "tests_failed", failedTests: (reportXml === undefined ? undefined : parseJUnitReport(reportXml))?.failedTests ?? [] };
    }
    const mutants: VariantVerdict[] = [];
    for (let index = 1; index < variants.length; index++) {
      const verdict = results.get(index);
      if (verdict === undefined || verdict.kind === "not_run") break;
      mutants.push(verdict);
    }
    return scoreTestQuality(spec, baseline, mutants);
  }

  /** The wall-clock seconds a command may use without crossing `deadline`, or undefined if too little is left. */
  private wallWithin(limitSeconds: number, deadline: number): number | undefined {
    const available = Math.floor((deadline - this.now()) / 1000) - this.limits.commandGraceSeconds;
    if (available < MIN_TEST_WALL_SECONDS) return undefined;
    return Math.min(limitSeconds, available);
  }

  private harnessArgs(mode: "compile" | "test" | "contract" | "overlays", wallSeconds: number): string[] {
    return [
      mode,
      SANDBOX_LAYOUT.jobDir,
      String(wallSeconds),
      String(this.limits.maxOutputBytes),
      String(this.limits.heapMb),
    ];
  }

  /** Best-effort stop with its own deadline; failures are logged and metricked, never thrown. */
  private async cleanup(session: SandboxSession, log: Logger): Promise<SandboxUsage> {
    try {
      const usage = await session.stop(AbortSignal.timeout(this.limits.cleanupTimeoutSeconds * 1000));
      if (usage.activeCpuMs !== undefined) log.metric("execution.active_cpu_ms", usage.activeCpuMs);
      return usage;
    } catch (error) {
      const errorType = error instanceof SandboxInfrastructureError ? error.errorType : "unknown";
      log.log("warn", "execution.cleanup_failed", { errorType, message: (error as Error).message });
      log.metric("execution.cleanup_failed", 1, { errorType });
      return {};
    }
  }
}

/** Test-quality overlays, under the job directory (the harness accepts o0–o9). */
const OVERLAYS_DIR = "overlays";
const OVERLAY_RESULTS_MAX_BYTES = 1024;
/** Inside the overlays loop the harness records `timeout`'s raw 124 (or 137 for an outer SIGKILL). */
const DEADLINE_STATUSES = new Set([124, KILLED_EXIT_CODE]);
/** Time kept back at the end of the sandbox lifetime for reading results and cleanup. */
const EXTRAS_SAFETY_MS = 5000;
/** Don't start a compile or test command with less wall time than this. */
const MIN_TEST_WALL_SECONDS = 3;

/**
 * Parses the harness's overlays/results.txt: "<index> <compile_status> <test_status|->" per line.
 * A compile killed by the deadline is "not run"; a test run killed by the deadline counts as the
 * tests failing (they hung on that variant). Malformed lines are ignored.
 */
export function parseOverlayResults(text: string): Map<number, VariantVerdict> {
  const verdicts = new Map<number, VariantVerdict>();
  for (const line of text.split("\n")) {
    const match = /^(\d) (\d{1,3}) (\d{1,3}|-)$/.exec(line.trim());
    if (match === null) continue;
    const [, index, compileStatus, testStatus] = match;
    let verdict: VariantVerdict;
    if (compileStatus !== "0") verdict = DEADLINE_STATUSES.has(Number(compileStatus)) ? { kind: "not_run" } : { kind: "compile_error" };
    else if (testStatus === "0") verdict = { kind: "tests_passed" };
    else verdict = { kind: "tests_failed", failedTests: [] };
    verdicts.set(Number(index), verdict);
  }
  return verdicts;
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
