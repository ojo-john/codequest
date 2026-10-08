import { describe, expect, it } from "vitest";
import { contractDefinitionSchema } from "@/lib/execution/contract";
import { boundOutput, SandboxJavaExecutor, type GradingMode } from "@/lib/execution/java-executor";
import { DEFAULT_EXECUTION_LIMITS, type ExecutionLimits } from "@/lib/execution/limits";
import {
  SandboxInfrastructureError,
  type HarnessRunResult,
  type LearnerFile,
  type SandboxProvider,
  type SandboxSession,
  type SandboxUsage,
} from "@/lib/execution/sandbox-provider";
import { validateSourceFiles, type ValidatedSourceSet } from "@/lib/execution/source-files";
import { silentLogger } from "@/lib/observability/log";

const PASSING_REPORT = '<testsuite tests="2" failures="0" errors="0" skipped="0"></testsuite>';
const FAILING_REPORT =
  '<testsuite tests="2" failures="1" errors="0"><testcase name="t()" classname="C"><failure/></testcase></testsuite>';

type HarnessStep = HarnessRunResult | Error | "hang";

interface FakeSessionScript {
  compile?: HarnessStep;
  test?: HarnessStep;
  report?: string | undefined;
  writeError?: Error;
  stopError?: Error;
}

/** Scripted in-memory session; records what the executor asked it to do. */
class FakeSession implements SandboxSession {
  readonly writtenFiles: LearnerFile[] = [];
  readonly harnessCalls: string[][] = [];
  stopCalls = 0;

  constructor(private readonly script: FakeSessionScript) {}

  async writeLearnerFiles(files: readonly LearnerFile[]): Promise<void> {
    if (this.script.writeError) throw this.script.writeError;
    this.writtenFiles.push(...files);
  }

  async runHarness(args: readonly string[], options: { signal: AbortSignal }): Promise<HarnessRunResult> {
    this.harnessCalls.push([...args]);
    // Contract runs use the same scripted step as JUnit test runs.
    const step = args[0] === "compile" ? this.script.compile : this.script.test;
    if (step === undefined) return { exitCode: 0, output: "" };
    if (step === "hang") return hangUntilAborted(options.signal);
    if (step instanceof Error) throw step;
    return step;
  }

  async readFileBounded(): Promise<string | undefined> {
    return "report" in this.script ? this.script.report : PASSING_REPORT;
  }

  async stop(): Promise<SandboxUsage> {
    this.stopCalls += 1;
    if (this.script.stopError) throw this.script.stopError;
    return { activeCpuMs: 1234 };
  }
}

function hangUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

function providerFor(session: FakeSession | Error): SandboxProvider {
  return {
    async createSession() {
      if (session instanceof Error) throw session;
      return session;
    },
  };
}

function executor(provider: SandboxProvider, limits: Partial<ExecutionLimits> = {}): SandboxJavaExecutor {
  return new SandboxJavaExecutor({
    provider,
    limits: { ...DEFAULT_EXECUTION_LIMITS, ...limits },
    logger: silentLogger,
  });
}

function sources(): ValidatedSourceSet {
  const result = validateSourceFiles([{ path: "shop/Cart.java", content: "class Cart {}" }], DEFAULT_EXECUTION_LIMITS);
  if (!result.ok) throw new Error("fixture must be valid");
  return result.files;
}

const RUN = { requestId: "req-test" };

describe("SandboxJavaExecutor.execute", () => {
  it("execute_providerQuotaExhausted_returnsNonRetryableInfrastructureError", async () => {
    const quota = new SandboxInfrastructureError("provider_quota", false, "quota");

    const result = await executor(providerFor(quota)).execute(sources(), RUN);

    expect(result).toMatchObject({
      outcome: "infrastructure-error",
      stage: "provision",
      infrastructureErrorType: "provider_quota",
      retryable: false,
    });
  });

  it("execute_uploadFails_returnsInfrastructureErrorAndStopsSandbox", async () => {
    const session = new FakeSession({ writeError: new SandboxInfrastructureError("provider_stream", true, "x") });

    const result = await executor(providerFor(session)).execute(sources(), RUN);

    expect([result.outcome, result.retryable, session.stopCalls]).toEqual(["infrastructure-error", true, 1]);
  });

  it("execute_compileFails_returnsCompileErrorWithoutRunningTests", async () => {
    const session = new FakeSession({ compile: { exitCode: 1, output: "Cart.java:1: error" } });

    const result = await executor(providerFor(session)).execute(sources(), RUN);

    expect(result).toMatchObject({ outcome: "compile-error", stage: "compile", compileOutput: "Cart.java:1: error" });
    expect(session.harnessCalls.map((call) => call[0])).toEqual(["compile"]);
  });

  it("execute_infrastructureFailureDuringTests_isNotALearnerFailure", async () => {
    const session = new FakeSession({ test: new SandboxInfrastructureError("provider_http_503", true, "x") });

    const result = await executor(providerFor(session)).execute(sources(), RUN);

    expect([result.outcome, result.stage]).toEqual(["infrastructure-error", "test"]);
  });

  it("execute_learnerCodeOutlivesLifetime_returnsTimeoutAndStopsSandbox", async () => {
    const session = new FakeSession({ test: "hang" });

    const result = await executor(providerFor(session), { sandboxLifetimeSeconds: 1 }).execute(sources(), RUN);

    expect([result.outcome, result.detail, result.stage, session.stopCalls]).toEqual([
      "timeout",
      "lifetime_deadline",
      "test",
      1,
    ]);
  });

  it("execute_callerCancels_returnsCancelledAndStopsSandbox", async () => {
    const session = new FakeSession({ compile: "hang" });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    const result = await executor(providerFor(session)).execute(sources(), { ...RUN, signal: controller.signal });

    expect([result.outcome, session.stopCalls]).toEqual(["cancelled", 1]);
  });

  it("execute_providerReportsCpu_attachesActiveCpuToResult", async () => {
    const result = await executor(providerFor(new FakeSession({}))).execute(sources(), RUN);

    expect(result.activeCpuMs).toBe(1234);
  });

  it("execute_cleanupFails_stillReturnsTheLearnerOutcome", async () => {
    const session = new FakeSession({ stopError: new SandboxInfrastructureError("provider_http_500", true, "x") });

    const result = await executor(providerFor(session)).execute(sources(), RUN);

    expect(result.outcome).toBe("succeeded");
  });

  it("execute_unexpectedProgrammingError_propagatesInsteadOfMasquerading", async () => {
    const session = new FakeSession({ compile: new RangeError("bug") });

    await expect(executor(providerFor(session)).execute(sources(), RUN)).rejects.toBeInstanceOf(RangeError);
    expect(session.stopCalls).toBe(1);
  });

  it("execute_failingTests_returnsWrongAnswerWithSummary", async () => {
    const session = new FakeSession({ test: { exitCode: 1, output: "" }, report: FAILING_REPORT });

    const result = await executor(providerFor(session)).execute(sources(), RUN);

    expect(result).toMatchObject({ outcome: "wrong-answer", summary: { failures: 1, failedTests: ["C#t()"] } });
  });

  it("execute_oversizedHarnessOutput_isBoundedOnTheHost", async () => {
    const session = new FakeSession({ compile: { exitCode: 1, output: "x".repeat(100) } });

    const result = await executor(providerFor(session), { maxOutputBytes: 10 }).execute(sources(), RUN);

    expect(result.compileOutput).toHaveLength(10);
  });

  it("execute_validSources_uploadsUnderJobSrcAndPassesLimitsToHarness", async () => {
    const session = new FakeSession({});

    const result = await executor(providerFor(session)).execute(sources(), RUN);

    expect(result.outcome).toBe("succeeded");
    expect(session.writtenFiles).toEqual([{ path: "job/src/shop/Cart.java", content: "class Cart {}" }]);
    expect(session.harnessCalls).toEqual([
      ["compile", "/home/learner/job", "30", "65536", "256"],
      ["test", "/home/learner/job", "10", "65536", "256"],
    ]);
  });
});

describe("SandboxJavaExecutor.execute in contract mode", () => {
  const CONTRACT: GradingMode = {
    kind: "contract",
    contract: contractDefinitionSchema.parse({
      version: 1,
      cases: [{ id: "sum", steps: [{ call: "sum", static: "M", args: [[1, 2]], paramTypes: ["java.util.List"], expect: { value: 3 } }] }],
    }),
  };
  const PASSING_RESULTS = '{"case":"sum","step":0,"status":"returned","value":3}\n{"done":true}';

  it("execute_contractMode_uploadsSpecWithoutExpectedValues", async () => {
    const session = new FakeSession({ report: PASSING_RESULTS });

    await executor(providerFor(session)).execute(sources(), { ...RUN, grading: CONTRACT });

    const spec = session.writtenFiles.find((file) => file.path === "job/contract.json");
    expect([spec?.content.includes('"expect"'), spec?.content.includes('"sum"')]).toEqual([false, true]);
  });

  it("execute_contractRunKilled_returnsTimeoutWithoutGrading", async () => {
    const session = new FakeSession({ test: { exitCode: 137, output: "" }, report: PASSING_RESULTS });

    const result = await executor(providerFor(session)).execute(sources(), { ...RUN, grading: CONTRACT });

    expect([result.outcome, result.detail]).toEqual(["timeout", "test_deadline"]);
  });

  it("execute_contractResultsMissing_returnsIncompleteResults", async () => {
    const session = new FakeSession({ report: undefined });

    const result = await executor(providerFor(session)).execute(sources(), { ...RUN, grading: CONTRACT });

    expect(result.detail).toBe("incomplete_results");
  });

  it("execute_contractPasses_runsContractHarnessAndSucceeds", async () => {
    const session = new FakeSession({ report: PASSING_RESULTS });

    const result = await executor(providerFor(session)).execute(sources(), { ...RUN, grading: CONTRACT });

    expect([result.outcome, session.harnessCalls.map((call) => call[0])]).toEqual(["succeeded", ["compile", "contract"]]);
  });
});

describe("boundOutput", () => {
  it("boundOutput_cutInsideMultiByteCharacter_dropsWholeCharacter", () => {
    expect(boundOutput("aé", 2)).toBe("a");
  });

  it("boundOutput_cutInsideFourByteCharacter_staysWithinLimit", () => {
    expect(boundOutput("ab😀", 4)).toBe("ab");
  });

  it("boundOutput_cutOnCharacterBoundary_keepsWholePrefix", () => {
    expect(boundOutput("aéb", 3)).toBe("aé");
  });
});
