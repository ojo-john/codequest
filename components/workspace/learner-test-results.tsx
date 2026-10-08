"use client";

import { OutputBlock } from "@/components/ui";

/** Results of the learner's own tests (Run) and of grading them against planted bugs (Submit). */

export interface LearnerTestsView {
  readonly outcome: string;
  readonly detail: string;
  readonly tests?: number;
  readonly failedTests?: readonly string[];
  readonly output: string;
}

export interface TestQualityView {
  readonly status: string;
  readonly caught: ReadonlyArray<{ readonly id: string; readonly description: string }>;
  readonly missed: ReadonlyArray<{ readonly id: string; readonly description: string }>;
  readonly total: number;
  readonly failingOnReference?: readonly string[];
}

/** "shop.OrderLineParserTest#rejectsZero()" -> "rejectsZero()" */
function testName(qualified: string): string {
  return qualified.split("#").pop() ?? qualified;
}

export function learnerTestsHeadline(view: LearnerTestsView): string {
  if (view.outcome === "compile-error") return "Your tests don't compile.";
  if (view.detail === "no_tests_found") return "No @Test methods found in your test files.";
  if (view.outcome === "timeout") return "Your tests took too long (look for a loop that never ends).";
  const total = view.tests ?? 0;
  const failed = view.failedTests?.length ?? 0;
  if (view.outcome === "succeeded") return `Your tests: all ${total} passed.`;
  return failed > 0 ? `Your tests: ${failed} of ${total} failed.` : "Your tests didn't finish cleanly.";
}

export function LearnerTestResults({ view }: { view: LearnerTestsView }) {
  return (
    <section aria-label="Your tests" className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="font-medium">{learnerTestsHeadline(view)}</p>
      {view.failedTests && view.failedTests.length > 0 && (
        <ul className="mt-1 list-disc pl-5 font-mono text-xs">
          {view.failedTests.map((name) => (
            <li key={name}>{testName(name)}</li>
          ))}
        </ul>
      )}
      {view.output && (
        <details className="mt-1">
          <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">Test output</summary>
          <OutputBlock label="Test output" className="mt-1 max-h-64">{view.output}</OutputBlock>
        </details>
      )}
    </section>
  );
}

export function TestQualityResults({ view }: { view: TestQualityView }) {
  return (
    <section aria-label="How good are your tests" className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="font-medium">How good are your tests?</p>
      {view.status === "no_tests" && (
        <p className="mt-1">You haven&apos;t written any tests yet. Add one with ＋ Test file, then Submit again to see which planted bugs your tests catch.</p>
      )}
      {view.status === "incomplete" && <p className="mt-1">Checking your tests didn&apos;t finish this time. Nothing was recorded against you; Submit again to retry.</p>}
      {view.status === "invalid_tests" && (
        <div className="mt-1">
          <p>Some of your tests fail on a correct implementation, so they can&apos;t tell good code from bad yet. A test should pass when the code is right:</p>
          {view.failingOnReference && view.failingOnReference.length > 0 && (
            <ul className="mt-1 list-disc pl-5 font-mono text-xs">
              {view.failingOnReference.map((name) => (
                <li key={name}>{testName(name)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {view.status === "graded" && (
        <div className="mt-1">
          <p>
            We planted {view.total} bug{view.total === 1 ? "" : "s"} in a correct version of the code. Your tests caught {view.caught.length}.
          </p>
          <ul className="mt-1 space-y-0.5">
            {view.caught.map((mutant) => (
              <li key={mutant.id}>✓ Caught: {mutant.description}</li>
            ))}
            {view.missed.map((mutant) => (
              <li key={mutant.id}>✗ Missed: code that {mutant.description} still passed your tests</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
