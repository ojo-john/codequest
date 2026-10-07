"use client";

import { Badge } from "@/components/ui";

export interface CaseView {
  readonly id: string;
  readonly visible: boolean;
  readonly passed: boolean;
  readonly steps?: ReadonlyArray<{ step: number; passed: boolean; call: string; expected?: unknown; actual?: unknown; note?: string }>;
}

export interface ExecutionView {
  readonly mode: "run" | "submit";
  readonly outcome: string;
  readonly detail: string;
  readonly cases?: readonly CaseView[];
  readonly compileOutput?: string;
  readonly testOutput?: string;
  readonly totalMs?: number;
}

export interface SubmissionExtras {
  readonly awardedXp: number;
  readonly skills: ReadonlyArray<{ skillId: string; dimension: string; state: string; reviewInDays: number }>;
}

const HEADLINES: Record<string, { tone: "success" | "danger" | "warning" | "info"; icon: string; text: string }> = {
  succeeded: { tone: "success", icon: "✓", text: "All checks passed" },
  "wrong-answer": { tone: "danger", icon: "✗", text: "Some checks failed" },
  "compile-error": { tone: "danger", icon: "✗", text: "Your code doesn't compile" },
  "runtime-error": { tone: "danger", icon: "!", text: "Your code crashed" },
  timeout: { tone: "warning", icon: "⏱", text: "Took too long" },
  cancelled: { tone: "info", icon: "–", text: "Cancelled" },
  "infrastructure-error": { tone: "info", icon: "↻", text: "Couldn't run your code — not your fault" },
};

const DETAILS: Record<string, string> = {
  output_limit: "It printed too much output; look for a loop that never ends.",
  test_deadline: "It ran out of time; look for a loop that never ends.",
  memory_limit: "It ran out of memory; look for something that keeps growing.",
  missing_member: "A class or method the checks need couldn't be found — check its name and parameter types.",
  uncaught_exception: "A check threw an exception your code didn't expect.",
  incomplete_results: "Your code stopped before every check finished (e.g. System.exit).",
};

function show(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value, null, 0);
}

export function ResultsPanel({ result, extras }: { result: ExecutionView; extras?: SubmissionExtras }) {
  const headline = HEADLINES[result.outcome] ?? { tone: "info" as const, icon: "?", text: result.outcome };
  const visible = result.cases?.filter((testCase) => testCase.visible) ?? [];
  const hidden = result.cases?.filter((testCase) => !testCase.visible) ?? [];
  const passedHidden = hidden.filter((testCase) => testCase.passed).length;

  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="results">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={headline.tone}>
          <span aria-hidden="true">{headline.icon}</span> {headline.text}
        </Badge>
        <span className="text-neutral-500">{result.mode === "run" ? "Run: visible samples only" : "Submit: all checks"}</span>
        {result.totalMs !== undefined && <span className="text-neutral-500">· {(result.totalMs / 1000).toFixed(1)} s</span>}
      </div>
      {DETAILS[result.detail] && <p>{DETAILS[result.detail]}</p>}
      {result.outcome === "infrastructure-error" && <p>Nothing was recorded against you. Try again in a moment.</p>}

      {result.outcome === "compile-error" && result.compileOutput && (
        <pre className="max-h-64 overflow-auto rounded-md bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-800">{result.compileOutput}</pre>
      )}

      {visible.map((testCase) => (
        <div key={testCase.id} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <p className="font-medium">
            {testCase.passed ? "✓" : "✗"} Sample: {testCase.id}
          </p>
          <ul className="mt-1 space-y-1 font-mono text-xs">
            {testCase.steps?.map((step) => (
              <li key={step.step}>
                <span>{step.passed ? "✓" : "✗"} {step.call}</span>
                {!step.passed && (
                  <span className="block pl-4 text-neutral-600 dark:text-neutral-400">
                    expected {show(step.expected)}
                    {step.note ? ` — ${step.note}` : ` — got ${show(step.actual)}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {hidden.length > 0 && (
        <div>
          <p className="font-medium">
            Hidden checks: {passedHidden} of {hidden.length} passed
          </p>
          <ul className="mt-1 grid gap-x-4 gap-y-0.5 font-mono text-xs sm:grid-cols-2">
            {hidden.map((testCase) => (
              <li key={testCase.id}>
                {testCase.passed ? "✓" : "✗"} {testCase.id}
              </li>
            ))}
          </ul>
        </div>
      )}

      {extras && result.mode === "submit" && (
        <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950/40">
          {extras.awardedXp > 0 && <p className="font-medium">+{extras.awardedXp} XP (if not already earned for this quest)</p>}
          {extras.skills.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {extras.skills.map((skill) => (
                <li key={`${skill.skillId}:${skill.dimension}`}>
                  {skill.skillId} ({skill.dimension}): {skill.state}, next review in {skill.reviewInDays} day{skill.reviewInDays === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result.testOutput && (
        <details>
          <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">Console output</summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-neutral-100 p-3 font-mono text-xs dark:bg-neutral-800">{result.testOutput}</pre>
        </details>
      )}
    </div>
  );
}
