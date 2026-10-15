import { describe, expect, it } from "vitest";
import { MOCK_DISCLAIMER, scoreMock, SUBMISSION_GRACE_MS, type MockPlan, type MockScoringInput, type MockSubmission } from "@/lib/interview/mock-scoring";

const START = new Date("2026-10-15T10:00:00Z");
const END = new Date("2026-10-15T10:45:00Z");
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);
const EMPTY_PLAN: MockPlan = { clarify: "", examples: "", bruteForce: "", optimized: "", complexity: "" };
const FULL_PLAN: MockPlan = {
  clarify: "Can the array be empty? Are values negative?",
  examples: "[2, 7, 11] target 9 gives indices 0 and 1",
  bruteForce: "Check every pair, O(n^2) time",
  optimized: "One pass with a hash map of seen values",
  complexity: "O(n) time and O(n) space",
};

function submission(minutes: number, passed: number, total = 4): MockSubmission {
  return { createdAt: at(minutes), outcome: passed === total ? "succeeded" : "wrong-answer", cases: Array.from({ length: total }, (_, index) => ({ passed: index < passed })) };
}

function input(overrides: Partial<MockScoringInput> = {}): MockScoringInput {
  return { plan: FULL_PLAN, startedAt: START, endsAt: END, finishedAt: END, submissions: [], ...overrides };
}

const status = (result: ReturnType<typeof scoreMock>, id: string) => result.dimensions.find((dimension) => dimension.id === id)?.status;

describe("scoreMock", () => {
  it("scoreMock_noSubmissions_codingWeakTestingNotAssessedAndNeedsWork", () => {
    const result = scoreMock(input());

    expect([status(result, "coding"), status(result, "testing"), result.overall, result.solved]).toEqual(["weak", "not_assessed", "needs_work", false]);
  });

  it("scoreMock_submissionsOutsideTheWindow_areIgnored", () => {
    const before = { ...submission(0, 4), createdAt: new Date(START.getTime() - 1) };
    const afterGrace = { ...submission(0, 4), createdAt: new Date(END.getTime() + SUBMISSION_GRACE_MS + 1) };

    expect(scoreMock(input({ submissions: [before, afterGrace] })).submissions).toBe(0);
  });

  it("scoreMock_submissionWithinGraceAfterTheDeadline_counts", () => {
    const late = { ...submission(0, 4), createdAt: new Date(END.getTime() + SUBMISSION_GRACE_MS) };

    expect(scoreMock(input({ submissions: [late], finishedAt: new Date(END.getTime() + 2 * SUBMISSION_GRACE_MS) })).solved).toBe(true);
  });

  it("scoreMock_submissionAfterFinishingEarly_doesNotCount", () => {
    expect(scoreMock(input({ finishedAt: at(10), submissions: [submission(12, 4)] })).solved).toBe(false);
  });

  it("scoreMock_solvedFirstTimeWithFullPlan_isStrongEverywhereButAlgorithmNotAssessed", () => {
    const result = scoreMock(input({ submissions: [submission(30, 4)] }));

    expect(result.dimensions.map((dimension) => dimension.status)).toEqual(["strong", "strong", "strong", "partial", "not_assessed"]);
  });

  it("scoreMock_solvedAfterTwoFailures_testingIsPartial", () => {
    expect(status(scoreMock(input({ submissions: [submission(30, 4), submission(10, 1), submission(20, 2)] })), "testing")).toBe("partial");
  });

  it("scoreMock_solvedAfterOneFailure_testingStillStrong", () => {
    expect(status(scoreMock(input({ submissions: [submission(10, 3), submission(20, 4)] })), "testing")).toBe("strong");
  });

  it("scoreMock_unsolvedHalfPassing_codingPartialAndMixed", () => {
    const result = scoreMock(input({ submissions: [submission(20, 2)] }));

    expect([status(result, "coding"), result.overall]).toEqual(["partial", "mixed"]);
  });

  it("scoreMock_planAnswersBelowTheMinimum_dontCountAsWritten", () => {
    const result = scoreMock(input({ plan: { ...EMPTY_PLAN, clarify: "too short here", examples: "x".repeat(15) }, submissions: [submission(5, 4)] }));

    expect([status(result, "communication"), status(result, "complexity")]).toEqual(["weak", "weak"]);
  });

  it("scoreMock_solvedButNoPlan_isMixedNotStrong", () => {
    expect(scoreMock(input({ plan: EMPTY_PLAN, submissions: [submission(5, 4)] })).overall).toBe("mixed");
  });

  it("scoreMock_minutesUsed_stopAtThePassingSubmission", () => {
    expect(scoreMock(input({ submissions: [submission(17, 4)] })).minutesUsed).toBe(17);
  });

  it("scoreMock_alwaysCarriesTheDisclaimerAndNextActionsForGaps", () => {
    const result = scoreMock(input({ plan: EMPTY_PLAN }));

    expect([result.disclaimer, result.nextActions.length]).toEqual([MOCK_DISCLAIMER, 3]);
  });
});
