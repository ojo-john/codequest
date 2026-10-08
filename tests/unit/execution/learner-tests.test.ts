import { describe, expect, it } from "vitest";
import { contractDefinitionSchema } from "@/lib/execution/contract";
import { parseOverlayResults, SandboxJavaExecutor, type ExecuteOptions } from "@/lib/execution/java-executor";
import { DEFAULT_EXECUTION_LIMITS } from "@/lib/execution/limits";
import {
  SANDBOX_LAYOUT,
  SandboxInfrastructureError,
  type HarnessRunResult,
  type LearnerFile,
  type SandboxSession,
  type SandboxUsage,
} from "@/lib/execution/sandbox-provider";
import { validateSourceFiles, type SourceFile } from "@/lib/execution/source-files";
import type { TestQualitySpec } from "@/lib/execution/test-quality";
import { silentLogger } from "@/lib/observability/log";

const TARGET = "src/main/java/shop/Parser.java";
const TEST_FILE = { path: "src/test/java/shop/ParserTest.java", content: "class ParserTest {}" };
const PASSING = '<testsuite tests="3" failures="0" errors="0"></testsuite>';
const FAILING = '<testsuite tests="3" failures="1" errors="0"><testcase name="rejectsZero()" classname="shop.ParserTest"><failure/></testcase></testsuite>';
const CONTRACT_RESULTS = '{"case":"c","step":0,"status":"returned","value":1}\n{"done":true}';
const RESULTS_FILE = `${SANDBOX_LAYOUT.jobDir}/overlays/results.txt`;
const BASELINE_REPORT = `${SANDBOX_LAYOUT.jobDir}/overlays/o0/reports/TEST-junit-jupiter.xml`;

const SPEC: TestQualitySpec = {
  target: TARGET,
  baseline: "// reference",
  mutants: [
    { id: "accepts-zero", description: "accepts a quantity of 0", content: "// m1" },
    { id: "no-trim", description: "doesn't trim spaces", content: "// m2" },
  ],
  passRatio: 1,
};

const GRADING: ExecuteOptions["grading"] = {
  kind: "contract",
  contract: contractDefinitionSchema.parse({
    version: 1,
    cases: [{ id: "c", steps: [{ call: "f", static: "shop.Parser", paramTypes: [], expect: { value: 1 } }] }],
  }),
};

interface Script {
  /** JUnit run of the learner's tests in the job directory. */
  learnerTest?: HarnessRunResult;
  learnerReport?: string;
  overlays?: HarnessRunResult | Error;
  results?: string;
  baselineReport?: string;
}

/** Fake sandbox; the clock advances by `stepMs` per harness command. */
class FakeSession implements SandboxSession {
  readonly written: LearnerFile[] = [];
  readonly modes: string[] = [];
  readonly timeouts: number[] = [];

  constructor(
    private readonly script: Script,
    private readonly clock: { t: number; stepMs: number },
  ) {}

  async writeLearnerFiles(files: readonly LearnerFile[]): Promise<void> {
    this.written.push(...files);
  }

  async runHarness(args: readonly string[], options: { timeoutMs: number }): Promise<HarnessRunResult> {
    this.modes.push(args[0]);
    this.timeouts.push(options.timeoutMs);
    this.clock.t += this.clock.stepMs;
    if (args[0] === "test") return this.script.learnerTest ?? { exitCode: 0, output: "" };
    if (args[0] === "overlays") {
      if (this.script.overlays instanceof Error) throw this.script.overlays;
      return this.script.overlays ?? { exitCode: 0, output: "" };
    }
    return { exitCode: 0, output: "" };
  }

  async readFileBounded(path: string): Promise<string | undefined> {
    if (path === SANDBOX_LAYOUT.contractResultsFile) return CONTRACT_RESULTS;
    if (path === SANDBOX_LAYOUT.reportFile) return this.script.learnerReport ?? PASSING;
    if (path === RESULTS_FILE) return this.script.results;
    if (path === BASELINE_REPORT) return this.script.baselineReport;
    return undefined;
  }

  async stop(): Promise<SandboxUsage> {
    return {};
  }
}

function setup(script: Script = {}, stepMs = 1000) {
  const clock = { t: 0, stepMs };
  return { session: new FakeSession(script, clock), clock };
}

function run(session: FakeSession, clock: { t: number }, options: Partial<ExecuteOptions>, files: SourceFile[] = [{ path: TARGET, content: "// learner" }, TEST_FILE]) {
  const validated = validateSourceFiles(files, DEFAULT_EXECUTION_LIMITS);
  if (!validated.ok) throw new Error("fixture must be valid");
  const executor = new SandboxJavaExecutor({
    provider: { createSession: async () => session },
    limits: DEFAULT_EXECUTION_LIMITS,
    logger: silentLogger,
    now: () => clock.t,
  });
  return executor.execute(validated.files, { requestId: "r", grading: GRADING, ...options });
}

describe("learner tests on Run", () => {
  it("execute_runLearnerTests_reportsTheirResultSeparatelyFromTheContract", async () => {
    const { session, clock } = setup({ learnerTest: { exitCode: 1, output: "1 failed" }, learnerReport: FAILING });

    const result = await run(session, clock, { runLearnerTests: true });

    expect([result.outcome, result.learnerTests?.outcome, result.learnerTests?.summary?.failedTests]).toEqual(["succeeded", "wrong-answer", ["shop.ParserTest#rejectsZero()"]]);
  });

  it("execute_runLearnerTestsWithoutTestFiles_runsNoJUnit", async () => {
    const { session, clock } = setup();

    const result = await run(session, clock, { runLearnerTests: true }, [{ path: TARGET, content: "// learner" }]);

    expect([result.learnerTests, session.modes]).toEqual([undefined, ["compile", "contract"]]);
  });
});

describe("test quality on Submit", () => {
  it("execute_noLearnerTests_reportsNoTestsWithoutRunningOverlays", async () => {
    const { session, clock } = setup();

    const result = await run(session, clock, { testQuality: SPEC }, [{ path: TARGET, content: "// learner" }]);

    expect([result.testQuality?.status, session.modes]).toEqual(["no_tests", ["compile", "contract"]]);
  });

  it("execute_overlays_uploadOneTargetFilePerVariantInOrder", async () => {
    const { session, clock } = setup({ results: "0 0 0\n1 0 1\n2 0 1\n" });

    await run(session, clock, { testQuality: SPEC });

    const overlays = session.written.filter((file) => file.path.startsWith("job/overlays/"));
    expect(overlays.map((file) => [file.path, file.content])).toEqual([
      [`job/overlays/o0/src/${TARGET}`, "// reference"],
      [`job/overlays/o1/src/${TARGET}`, "// m1"],
      [`job/overlays/o2/src/${TARGET}`, "// m2"],
    ]);
  });

  it("execute_testsCatchOneOfTwoMutants_reportsCaughtAndMissed", async () => {
    const { session, clock } = setup({ results: "0 0 0\n1 0 1\n2 0 0\n" });

    const result = await run(session, clock, { testQuality: SPEC });

    expect(result.testQuality).toEqual({ status: "graded", caught: ["accepts-zero"], missed: [{ id: "no-trim", description: "doesn't trim spaces" }], total: 2 });
  });

  it("execute_testsFailOnReference_reportsInvalidTestsWithTheFailingNames", async () => {
    const { session, clock } = setup({ results: "0 0 1\n", baselineReport: FAILING });

    const result = await run(session, clock, { testQuality: SPEC });

    expect([result.testQuality?.status, result.testQuality?.failingOnReference, result.outcome]).toEqual(["invalid_tests", ["shop.ParserTest#rejectsZero()"], "succeeded"]);
  });

  it("execute_loopCutShortByTheBudget_reportsIncompleteAndKeepsTheContractResult", async () => {
    const { session, clock } = setup({ overlays: { exitCode: 137, output: "" }, results: "0 0 0\n1 0 1\n" });

    const result = await run(session, clock, { testQuality: SPEC });

    expect([result.outcome, result.testQuality?.status]).toEqual(["succeeded", "incomplete"]);
  });

  it("execute_overlaysGetOnlyTheRemainingLifetime", async () => {
    // compile + contract take 20 s each of the 60 s lifetime; 5 s is kept back for cleanup.
    const { session, clock } = setup({ results: "0 0 0\n1 0 1\n2 0 1\n" }, 20_000);

    await run(session, clock, { testQuality: SPEC });

    expect(session.timeouts.at(-1)).toBe(15_000);
  });

  it("execute_fractionalClock_givesTheOverlaysAWholeMillisecondTimeout", async () => {
    const { session, clock } = setup({ results: "0 0 0\n1 0 1\n2 0 1\n" }, 1000.37);

    await run(session, clock, { testQuality: SPEC });

    expect(Number.isInteger(session.timeouts.at(-1))).toBe(true);
  });

  it("execute_noTimeLeftForOverlays_reportsIncompleteWithoutRunningThem", async () => {
    const { session, clock } = setup({}, 27_000);

    const result = await run(session, clock, { testQuality: SPEC });

    expect([result.testQuality?.status, session.modes.includes("overlays")]).toEqual(["incomplete", false]);
  });

  it("execute_sandboxFailsDuringOverlays_reportsIncompleteAndKeepsTheContractResult", async () => {
    const { session, clock } = setup({ overlays: new SandboxInfrastructureError("provider_stream", true, "x") });

    const result = await run(session, clock, { testQuality: SPEC });

    expect([result.outcome, result.testQuality?.status]).toEqual(["succeeded", "incomplete"]);
  });

  it("execute_mutantDoesNotCompileWithTheseTests_isLeftOutOfTheScore", async () => {
    const { session, clock } = setup({ results: "0 0 0\n1 0 1\n2 1 -\n" });

    const result = await run(session, clock, { testQuality: SPEC });

    expect([result.testQuality?.caught, result.testQuality?.total]).toEqual([["accepts-zero"], 1]);
  });
});

describe("parseOverlayResults", () => {
  it("parseOverlayResults_compileKilledByDeadline_isNotRun", () => {
    expect(parseOverlayResults("1 124 -").get(1)).toEqual({ kind: "not_run" });
  });

  it("parseOverlayResults_testsKilledByDeadline_countAsFailing", () => {
    expect(parseOverlayResults("1 0 124").get(1)).toEqual({ kind: "tests_failed", failedTests: [] });
  });

  it("parseOverlayResults_malformedAndForeignLines_areIgnored", () => {
    expect([...parseOverlayResults("garbage\n12 0 0\n0 0 0 extra\n0 0 0").keys()]).toEqual([0]);
  });

  it("parseOverlayResults_empty_isEmpty", () => {
    expect(parseOverlayResults("").size).toBe(0);
  });
});
