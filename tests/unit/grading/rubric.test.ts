import { describe, expect, it } from "vitest";
import { computeRubric, dimensionForCriterion, RUBRIC_WEIGHTS, type RubricInput } from "@/lib/grading/rubric";

const CASES = [
  { id: "a", passed: true },
  { id: "b", passed: true },
  { id: "edge-1", passed: true },
  { id: "edge-2", passed: false },
];
const FOLLOW_UPS = [
  { id: "why", criterion: "explanation" as const },
  { id: "time", criterion: "time_complexity" as const },
];

function input(overrides: Partial<RubricInput> = {}): RubricInput {
  return { cases: CASES, totalChecks: 4, edgeCaseIds: ["edge-1", "edge-2"], followUps: FOLLOW_UPS, ...overrides };
}

function criterion(result: ReturnType<typeof computeRubric>, name: string) {
  return result.criteria.find((entry) => entry.criterion === name);
}

describe("computeRubric", () => {
  it("weights_matchTheSpecAndSumTo100", () => {
    expect(Object.values(RUBRIC_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it("computeRubric_beforeFollowUps_scoresOnlyCorrectnessAndEdgeCases", () => {
    const result = computeRubric(input());

    // correctness 3/4 × 40 = 30, edge cases 1/2 × 5 = 2.5 → 32.5 / 45 = 72 %.
    expect([result.assessedWeight, result.score]).toEqual([45, 72]);
  });

  it("computeRubric_followUpsUnanswered_areNotAssessedRatherThanZero", () => {
    expect(criterion(computeRubric(input()), "explanation")).toMatchObject({ assessed: false, reason: "unanswered" });
  });

  it("computeRubric_answeredFollowUps_addTheirCriteria", () => {
    const result = computeRubric(input({ answers: new Map([["why", true], ["time", false]]) }));

    expect([criterion(result, "explanation"), criterion(result, "time_complexity"), result.assessedWeight]).toMatchObject([
      { assessed: true, score: 1 },
      { assessed: true, score: 0 },
      65,
    ]);
  });

  it("computeRubric_codeQualityAndAlgorithmChoice_needReviewInV1", () => {
    const result = computeRubric(input());

    expect([criterion(result, "code_quality"), criterion(result, "algorithm_choice")]).toMatchObject([
      { assessed: false, reason: "needs_review" },
      { assessed: false, reason: "needs_review" },
    ]);
  });

  it("computeRubric_questWithoutEdgeCasesOrQuestions_marksThemNotAsked", () => {
    const result = computeRubric(input({ edgeCaseIds: [], followUps: [] }));

    expect([criterion(result, "edge_cases"), criterion(result, "space_complexity")]).toMatchObject([
      { assessed: false, reason: "not_asked" },
      { assessed: false, reason: "not_asked" },
    ]);
  });

  it("computeRubric_compileError_scoresCorrectnessZeroNotUnassessed", () => {
    const result = computeRubric(input({ cases: [] }));

    expect([criterion(result, "correctness"), result.score]).toMatchObject([{ assessed: true, score: 0, passed: 0, total: 4 }, 0]);
  });

  it("computeRubric_edgeCaseMissingFromResults_countsAsNotPassed", () => {
    const result = computeRubric(input({ cases: [{ id: "edge-1", passed: true }] }));

    expect(criterion(result, "edge_cases")).toMatchObject({ passed: 1, total: 2 });
  });
});

describe("dimensionForCriterion", () => {
  it("dimensionForCriterion_mapsComplexityCriteriaToTheComplexityDimension", () => {
    expect([dimensionForCriterion("explanation"), dimensionForCriterion("time_complexity"), dimensionForCriterion("space_complexity"), dimensionForCriterion("algorithm_choice")]).toEqual([
      "explanation",
      "complexity",
      "complexity",
      "recognition",
    ]);
  });
});
