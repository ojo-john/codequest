import type { SkillDimension } from "@/lib/learning/mastery";

/**
 * Code grading rubric (spec §14, §46). Executable checks decide correctness; objective follow-up
 * questions with canonical answers assess explanation and complexity; nothing here is judged by
 * AI. A criterion without evidence is reported as "not assessed" — never as zero — and the score
 * covers only the assessed share of the rubric.
 */

export const RUBRIC_VERSION = "rubric-v1";

/** Percent weights from spec §14. */
export const RUBRIC_WEIGHTS = Object.freeze({
  correctness: 40,
  algorithm_choice: 15,
  time_complexity: 10,
  space_complexity: 10,
  code_quality: 10,
  edge_cases: 5,
  explanation: 10,
});

export type Criterion = keyof typeof RUBRIC_WEIGHTS;
export type FollowUpCriterion = "explanation" | "time_complexity" | "space_complexity" | "algorithm_choice";

/** Mastery dimension a follow-up answer is evidence for. */
export function dimensionForCriterion(criterion: FollowUpCriterion): SkillDimension {
  switch (criterion) {
    case "explanation":
      return "explanation";
    case "time_complexity":
    case "space_complexity":
      return "complexity";
    case "algorithm_choice":
      return "recognition";
  }
}

export type NotAssessedReason =
  /** The quest asks no question for this criterion. */
  | "not_asked"
  /** The questions exist but haven't been answered yet. */
  | "unanswered"
  /** Needs reviewed reasoning (human or AI review), which v1 doesn't do. */
  | "needs_review";

export type CriterionResult =
  | { readonly criterion: Criterion; readonly weight: number; readonly assessed: true; readonly score: number; readonly passed: number; readonly total: number }
  | { readonly criterion: Criterion; readonly weight: number; readonly assessed: false; readonly reason: NotAssessedReason };

export interface RubricResult {
  readonly version: typeof RUBRIC_VERSION;
  readonly criteria: readonly CriterionResult[];
  /** Sum of the weights that were assessed (0–100). */
  readonly assessedWeight: number;
  /** Weighted score over the assessed criteria, 0–100; null when nothing was assessed. */
  readonly score: number | null;
}

export interface RubricInput {
  /** Per-check results of the submission; empty when the code never reached grading (didn't compile, crashed). */
  readonly cases: ReadonlyArray<{ readonly id: string; readonly passed: boolean }>;
  /** The contract's total number of checks. */
  readonly totalChecks: number;
  readonly edgeCaseIds: readonly string[];
  readonly followUps: ReadonlyArray<{ readonly id: string; readonly criterion: FollowUpCriterion }>;
  /** Follow-up id → answered correctly. Undefined until the learner answers. */
  readonly answers?: ReadonlyMap<string, boolean>;
}

const ORDER: readonly Criterion[] = ["correctness", "edge_cases", "explanation", "time_complexity", "space_complexity", "algorithm_choice", "code_quality"];

function scored(criterion: Criterion, passed: number, total: number): CriterionResult {
  return { criterion, weight: RUBRIC_WEIGHTS[criterion], assessed: true, score: total === 0 ? 0 : passed / total, passed, total };
}

function notAssessed(criterion: Criterion, reason: NotAssessedReason): CriterionResult {
  return { criterion, weight: RUBRIC_WEIGHTS[criterion], assessed: false, reason };
}

export function computeRubric(input: RubricInput): RubricResult {
  const passed = new Set(input.cases.filter((testCase) => testCase.passed).map((testCase) => testCase.id));

  const criteria = ORDER.map((criterion): CriterionResult => {
    switch (criterion) {
      case "correctness":
        // A check that never ran (compile error, crash before results) counts as not passed.
        return scored(criterion, passed.size, input.totalChecks);
      case "edge_cases":
        return input.edgeCaseIds.length === 0
          ? notAssessed(criterion, "not_asked")
          : scored(criterion, input.edgeCaseIds.filter((id) => passed.has(id)).length, input.edgeCaseIds.length);
      case "code_quality":
        return notAssessed(criterion, "needs_review");
      default: {
        const questions = input.followUps.filter((followUp) => followUp.criterion === criterion);
        if (questions.length === 0) return notAssessed(criterion, criterion === "algorithm_choice" ? "needs_review" : "not_asked");
        if (input.answers === undefined) return notAssessed(criterion, "unanswered");
        return scored(criterion, questions.filter((question) => input.answers?.get(question.id) === true).length, questions.length);
      }
    }
  });

  const assessed = criteria.filter((result): result is Extract<CriterionResult, { assessed: true }> => result.assessed);
  const assessedWeight = assessed.reduce((sum, result) => sum + result.weight, 0);
  const weighted = assessed.reduce((sum, result) => sum + result.weight * result.score, 0);
  return { version: RUBRIC_VERSION, criteria, assessedWeight, score: assessedWeight === 0 ? null : Math.round((weighted / assessedWeight) * 100) };
}
