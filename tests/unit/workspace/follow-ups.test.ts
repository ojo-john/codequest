import { describe, expect, it } from "vitest";
import { pendingFollowUps } from "@/components/workspace/results-panel";
import { computeRubric } from "@/lib/grading/rubric";

const QUESTIONS = [{ id: "why", prompt: "Why?", options: ["a", "b"] }];
const FOLLOW_UPS = [{ id: "why", criterion: "explanation" as const }];

describe("pendingFollowUps", () => {
  it("pendingFollowUps_unanswered_showsTheQuestions", () => {
    const rubric = computeRubric({ cases: [], totalChecks: 1, edgeCaseIds: [], followUps: FOLLOW_UPS });

    expect(pendingFollowUps({ rubric, followUps: QUESTIONS })).toEqual(QUESTIONS);
  });

  it("pendingFollowUps_alreadyAnswered_hidesThemOnReload", () => {
    const rubric = computeRubric({ cases: [], totalChecks: 1, edgeCaseIds: [], followUps: FOLLOW_UPS, answers: new Map([["why", true]]) });

    expect(pendingFollowUps({ rubric, followUps: QUESTIONS })).toEqual([]);
  });

  it("pendingFollowUps_noRubric_showsNothing", () => {
    expect(pendingFollowUps({ followUps: QUESTIONS })).toEqual([]);
  });
});
