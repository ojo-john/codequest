import type { SourceFile } from "./source-files";

/**
 * Grading the learner's own tests (spec §19): do they pass on a correct implementation, and do
 * they catch plausible bugs? Each "mutant" is the reference implementation of one file with one
 * deliberate bug (accepts 0, forgets to trim, ...). A good test suite passes on the reference and
 * fails on each mutant. Nothing about the variants (source or output) is shown to the learner,
 * only which described bugs their tests caught.
 */

/** Where learner-written JUnit tests live in a project. */
export const LEARNER_TEST_ROOT = "src/test/java/";

export interface Mutant {
  readonly id: string;
  /** Learner-facing description of the bug, e.g. "accepts a quantity of 0". */
  readonly description: string;
  /** Full replacement content for the target file. */
  readonly content: string;
}

export interface TestQualitySpec {
  /** Project path of the file under test, e.g. src/main/java/shop/OrderLineParser.java. */
  readonly target: string;
  /** The reference implementation of the target file. */
  readonly baseline: string;
  readonly mutants: readonly Mutant[];
  /** Share of mutants that must be caught for a pass (the rest is partial credit). */
  readonly passRatio: number;
}

export type TestQualityStatus =
  /** No learner test files. */
  | "no_tests"
  /** The tests don't compile or don't pass against a correct implementation. */
  | "invalid_tests"
  | "graded"
  /** Ran out of time or infrastructure failed before every variant ran; not evidence either way. */
  | "incomplete";

export interface TestQualityReport {
  readonly status: TestQualityStatus;
  readonly caught: readonly string[];
  readonly missed: ReadonlyArray<{ readonly id: string; readonly description: string }>;
  /** Mutants that count toward the score (excludes any that couldn't be judged). */
  readonly total: number;
  /** Tests that failed against the correct implementation (invalid_tests only). */
  readonly failingOnReference?: readonly string[];
}

/** What one variant run told us. */
export type VariantVerdict =
  /** Every learner test passed. */
  | { readonly kind: "tests_passed" }
  /** At least one learner test failed or the tests crashed or timed out. */
  | { readonly kind: "tests_failed"; readonly failedTests: readonly string[] }
  /** The variant (learner tests + this implementation) didn't compile. */
  | { readonly kind: "compile_error" }
  /** No verdict: time budget or infrastructure. */
  | { readonly kind: "not_run" };

export function isLearnerTest(path: string): boolean {
  return path.startsWith(LEARNER_TEST_ROOT);
}

export function hasLearnerTests(files: readonly SourceFile[]): boolean {
  return files.some((file) => isLearnerTest(file.path));
}

/**
 * Scores the variant verdicts. `baseline` is the run against the reference; `mutants[i]` the run
 * against spec.mutants[i] (shorter if the run stopped early).
 */
export function scoreTestQuality(spec: TestQualitySpec, baseline: VariantVerdict, mutants: readonly VariantVerdict[]): TestQualityReport {
  const empty = { caught: [], missed: [], total: spec.mutants.length };
  if (baseline.kind === "not_run") return { status: "incomplete", ...empty };
  if (baseline.kind === "compile_error") return { status: "invalid_tests", ...empty };
  if (baseline.kind === "tests_failed") return { status: "invalid_tests", ...empty, failingOnReference: baseline.failedTests };

  const caught: string[] = [];
  const missed: Array<{ id: string; description: string }> = [];
  let judged = 0;
  for (const [index, mutant] of spec.mutants.entries()) {
    const verdict = mutants[index] ?? { kind: "not_run" };
    if (verdict.kind === "not_run") return { status: "incomplete", caught, missed, total: spec.mutants.length };
    // A mutant that doesn't compile with these tests can't be judged; the content gate makes
    // sure every mutant compiles with the reference tests, so this only drops it from the score.
    if (verdict.kind === "compile_error") continue;
    judged += 1;
    if (verdict.kind === "tests_failed") caught.push(mutant.id);
    else missed.push({ id: mutant.id, description: mutant.description });
  }
  return { status: "graded", caught, missed, total: judged };
}

/**
 * Evidence for "testing"-dimension skills. undefined = no evidence (couldn't judge); writing no
 * tests when the quest asks for them, or tests that fail on correct code, is a fail.
 */
export function testingOutcome(report: TestQualityReport, passRatio: number): "pass" | "partial" | "fail" | undefined {
  if (report.status === "incomplete") return undefined;
  if (report.status !== "graded" || report.total === 0) return report.status === "graded" ? undefined : "fail";
  const ratio = report.caught.length / report.total;
  if (ratio >= passRatio) return "pass";
  return report.caught.length > 0 ? "partial" : "fail";
}
