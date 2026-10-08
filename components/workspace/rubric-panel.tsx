"use client";

import type { Criterion, NotAssessedReason, RubricResult } from "@/lib/grading/rubric";

const LABELS: Record<Criterion, string> = {
  correctness: "Correctness",
  edge_cases: "Edge cases",
  explanation: "Explanation",
  time_complexity: "Time complexity",
  space_complexity: "Space complexity",
  algorithm_choice: "Algorithm choice",
  code_quality: "Code quality",
};

const UNITS: Partial<Record<Criterion, string>> = { correctness: "checks", edge_cases: "edge-case checks" };

const REASONS: Record<NotAssessedReason, string> = {
  unanswered: "answer the questions below",
  not_asked: "not part of this quest",
  needs_review: "needs a reviewed explanation; not assessed yet",
};

/** The rubric (spec §14): what was assessed and how, and what wasn't — never shown as zero. */
export function RubricPanel({ rubric }: { rubric: RubricResult }) {
  return (
    <section aria-label="Rubric" className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <p className="font-medium">
        {rubric.score === null ? "Rubric: nothing assessed yet" : `Rubric score: ${rubric.score}%`}
        <span className="ml-2 font-normal text-neutral-600 dark:text-neutral-400">covers {rubric.assessedWeight}% of the rubric so far</span>
      </p>
      <table className="mt-2 w-full text-left text-xs">
        <thead className="sr-only">
          <tr>
            <th>Criterion</th>
            <th>Weight</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rubric.criteria.map((entry) => (
            <tr key={entry.criterion} className="border-t border-neutral-100 dark:border-neutral-800">
              <td className="py-1 pr-2 font-medium">{LABELS[entry.criterion]}</td>
              <td className="py-1 pr-2 text-neutral-500 dark:text-neutral-400">{entry.weight}%</td>
              <td className="py-1">
                {entry.assessed ? (
                  <span>
                    {Math.round(entry.score * 100)}% · {entry.passed} of {entry.total} {UNITS[entry.criterion] ?? (entry.total === 1 ? "question" : "questions")}
                  </span>
                ) : (
                  <span className="text-neutral-500 dark:text-neutral-400">Not assessed: {REASONS[entry.reason]}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
