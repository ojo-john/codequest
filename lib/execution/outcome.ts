/**
 * Execution outcomes and their classification (spec §13, §67).
 *
 * Educational outcomes (compile-error, wrong-answer, runtime-error, timeout) are kept strictly
 * separate from `infrastructure-error`, which must never count against the learner.
 */

export type ExecutionOutcome =
  | "succeeded"
  | "compile-error"
  | "wrong-answer"
  | "runtime-error"
  | "timeout"
  | "cancelled"
  | "infrastructure-error";

export type ExecutionStage = "provision" | "compile" | "test" | "report";

export interface TestSummary {
  readonly tests: number;
  readonly failures: number;
  readonly errors: number;
  readonly skipped: number;
  /** "ClassName#method()" of failed/errored tests, capped at {@link MAX_FAILED_TEST_NAMES}. */
  readonly failedTests: readonly string[];
}

export interface CommandResult {
  readonly exitCode: number;
  readonly output: string;
}

export interface Classification {
  readonly outcome: ExecutionOutcome;
  /** Stable machine-readable reason code; safe to show and to aggregate in metrics. */
  readonly detail: string;
}

/** `timeout --signal=KILL` and the provider's own SIGKILL both surface as 128 + 9. */
export const KILLED_EXIT_CODE = 137;
/** run.sh usage error — a bug on our side, never the learner's. */
export const HARNESS_USAGE_EXIT_CODE = 64;
/** run.sh could not verify that capabilities were dropped and refused to run (fail closed). */
export const HARNESS_PRIVILEGE_DROP_FAILED_EXIT_CODE = 65;
/** The JVM's exit status under -XX:+ExitOnOutOfMemoryError. */
export const JVM_OUT_OF_MEMORY_EXIT_CODE = 3;
export const MAX_FAILED_TEST_NAMES = 50;

export function classifyCompile(result: CommandResult, maxOutputBytes: number): Classification | undefined {
  if (result.exitCode === 0) return undefined;
  const harnessFailure = classifyHarnessFailure(result);
  if (harnessFailure !== undefined) return harnessFailure;
  if (result.exitCode === KILLED_EXIT_CODE) {
    return { outcome: "timeout", detail: outputFilled(result, maxOutputBytes) ? "output_limit" : "compile_deadline" };
  }
  return { outcome: "compile-error", detail: "javac_failed" };
}

export function classifyTest(
  result: CommandResult,
  summary: TestSummary | undefined,
  maxOutputBytes: number,
): Classification {
  const runFailure = classifyRunFailure(result, maxOutputBytes);
  if (runFailure !== undefined) return runFailure;
  // A missing report is learner-caused (System.exit/halt inside a test, deleting the reports
  // directory); provider failures surface as exceptions before we get here.
  if (summary === undefined) return { outcome: "runtime-error", detail: "no_test_report" };
  if (summary.tests === 0) return { outcome: "runtime-error", detail: "no_tests_found" };
  if (summary.errors > 0) return { outcome: "runtime-error", detail: "test_errors" };
  if (summary.failures > 0) return { outcome: "wrong-answer", detail: "test_failures" };
  // The report claims success but the JVM did not exit cleanly: never trust the report alone.
  if (result.exitCode !== 0) return { outcome: "runtime-error", detail: "exit_status_mismatch" };
  return { outcome: "succeeded", detail: "all_tests_passed" };
}

/**
 * Exit statuses that decide the outcome of a run (JUnit or contract) before any results are
 * read: harness failures, the deadline, and the JVM's out-of-memory exit.
 */
export function classifyRunFailure(result: CommandResult, maxOutputBytes: number): Classification | undefined {
  const harnessFailure = classifyHarnessFailure(result);
  if (harnessFailure !== undefined) return harnessFailure;
  if (result.exitCode === KILLED_EXIT_CODE) {
    return { outcome: "timeout", detail: outputFilled(result, maxOutputBytes) ? "output_limit" : "test_deadline" };
  }
  if (result.exitCode === JVM_OUT_OF_MEMORY_EXIT_CODE) {
    return { outcome: "runtime-error", detail: "memory_limit" };
  }
  return undefined;
}

/**
 * Harness-level failures are ours, never the learner's. run.sh remaps any compiler/JVM exit
 * status that collides with these codes, so learner code cannot fake an infrastructure error.
 */
function classifyHarnessFailure(result: CommandResult): Classification | undefined {
  if (result.exitCode === HARNESS_USAGE_EXIT_CODE) return { outcome: "infrastructure-error", detail: "harness_usage" };
  if (result.exitCode === HARNESS_PRIVILEGE_DROP_FAILED_EXIT_CODE) {
    return { outcome: "infrastructure-error", detail: "privilege_drop_failed" };
  }
  return undefined;
}

function outputFilled(result: CommandResult, maxOutputBytes: number): boolean {
  return Buffer.byteLength(result.output, "utf8") >= maxOutputBytes;
}

/**
 * Parses the legacy JUnit XML report written by the JUnit Platform console launcher.
 * Returns undefined for anything that isn't a recognisable report.
 *
 * This is a deliberately narrow, regex-based reader of one known format (no DTDs, no entities
 * beyond the five predefined ones) rather than a general XML parser.
 */
export function parseJUnitReport(xml: string): TestSummary | undefined {
  const suiteTag = /<testsuite\b([^>]*)>/.exec(xml);
  if (suiteTag === null) return undefined;
  const suite = parseAttributes(suiteTag[1]);

  const tests = parseCount(suite.tests);
  const failures = parseCount(suite.failures);
  const errors = parseCount(suite.errors);
  const skipped = parseCount(suite.skipped ?? "0");
  if (tests === undefined || failures === undefined || errors === undefined || skipped === undefined) {
    return undefined;
  }

  const failedTests: string[] = [];
  const testcasePattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const match of xml.matchAll(testcasePattern)) {
    const body = match[2] ?? "";
    if (!/<(failure|error)\b/.test(body)) continue;
    if (failedTests.length >= MAX_FAILED_TEST_NAMES) break;
    const attributes = parseAttributes(match[1]);
    failedTests.push(`${attributes.classname ?? "?"}#${attributes.name ?? "?"}`);
  }

  return { tests, failures, errors, skipped, failedTests };
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
  }
  return attributes;
}

function parseCount(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,9}$/.test(value)) return undefined;
  return Number(value);
}

const XML_ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&amp;": "&" };

function decodeXmlEntities(value: string): string {
  // Single pass so "&amp;lt;" decodes to "&lt;", not "<".
  return value.replace(/&(?:lt|gt|quot|apos|amp);/g, (entity) => XML_ENTITIES[entity]);
}
