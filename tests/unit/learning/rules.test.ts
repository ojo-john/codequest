import { describe, expect, it } from "vitest";
import {
  evidenceFor,
  independenceFor,
  masteryState,
  updateSkillState,
  type EvidenceRow,
  type SkillState,
} from "@/lib/learning/mastery";
import { planSession, type QuestCandidate } from "@/lib/learning/session-planner";
import { XP, xpAwardsFor } from "@/lib/learning/xp";

const NOW = new Date("2026-10-07T12:00:00Z");
const DAY = 86_400_000;
const TAGS = [{ skill: "java.loops", dimension: "implementation" as const }];

function evidence(outcome: EvidenceRow["outcome"], independence: EvidenceRow["independence"] = "independent"): EvidenceRow {
  return { skillId: "java.loops", dimension: "implementation", outcome, independence, modelVersion: "rules-v1" };
}

function state(estimate: number, evidenceCount = 3, dueInDays = 0): SkillState {
  return { skillId: "java.loops", dimension: "implementation", estimate, evidenceCount, reviewDueAt: new Date(NOW.getTime() + dueInDays * DAY) };
}

describe("evidenceFor", () => {
  it.each(["infrastructure-error", "cancelled"] as const)("evidenceFor_%s_producesNoEvidence", (outcome) => {
    expect(evidenceFor(outcome, TAGS, "independent")).toEqual([]);
  });

  it.each(["wrong-answer", "compile-error", "runtime-error", "timeout"] as const)("evidenceFor_%s_isAFailure", (outcome) => {
    expect(evidenceFor(outcome, TAGS, "independent")[0].outcome).toBe("fail");
  });

  it("evidenceFor_success_isOneRowPerSkillTagWithIndependence", () => {
    expect(evidenceFor("succeeded", [...TAGS, { skill: "java.methods", dimension: "design" }], "hinted")).toMatchObject([
      { skillId: "java.loops", outcome: "pass", independence: "hinted" },
      { skillId: "java.methods", dimension: "design", outcome: "pass", independence: "hinted" },
    ]);
  });

  const WITH_TESTING = [...TAGS, { skill: "java.unit-testing", dimension: "testing" as const }];

  it("evidenceFor_testingTagWithTestQuality_usesTheTestQualityOutcome", () => {
    const rows = evidenceFor("succeeded", WITH_TESTING, "independent", { outcome: "partial" });

    expect(rows.map((row) => [row.dimension, row.outcome])).toEqual([["implementation", "pass"], ["testing", "partial"]]);
  });

  it("evidenceFor_testQualityNotJudged_dropsOnlyTheTestingRow", () => {
    const rows = evidenceFor("succeeded", WITH_TESTING, "independent", { outcome: undefined });

    expect(rows.map((row) => row.dimension)).toEqual(["implementation"]);
  });

  it("evidenceFor_testingTagWithoutTestQuality_followsTheCodeOutcome", () => {
    expect(evidenceFor("wrong-answer", WITH_TESTING, "independent").map((row) => row.outcome)).toEqual(["fail", "fail"]);
  });

  it("evidenceFor_infrastructureErrorWithTestQuality_producesNoEvidence", () => {
    expect(evidenceFor("infrastructure-error", WITH_TESTING, "independent", { outcome: "pass" })).toEqual([]);
  });
});

describe("independenceFor", () => {
  it.each([[0, "independent"], [1, "hinted"], [4, "hinted"], [5, "solution_revealed"]] as const)("independenceFor_tier %i_is %s", (tier, expected) => {
    expect(independenceFor(tier)).toBe(expected);
  });
});

describe("updateSkillState", () => {
  it("updateSkillState_failure_comesBackTomorrowRegardlessOfEstimate", () => {
    const update = updateSkillState(state(0.9), evidence("fail"), NOW);

    expect([update.intervalDays, update.reason, update.estimate]).toEqual([1, "failed_recently", 0.8]);
  });

  it("updateSkillState_hintedSuccess_isCappedAtThreeDays", () => {
    const update = updateSkillState(state(0.8), evidence("pass", "hinted"), NOW);

    expect([update.intervalDays, update.reason]).toEqual([3, "assisted_success"]);
  });

  it("updateSkillState_revealedSolution_doesNotRaiseTheEstimate", () => {
    expect(updateSkillState(state(0.5), evidence("pass", "solution_revealed"), NOW).estimate).toBe(0.5);
  });

  it("updateSkillState_firstIndependentPass_startsTheLadder", () => {
    const update = updateSkillState(undefined, evidence("pass"), NOW);

    expect([update.estimate, update.evidenceCount, update.intervalDays, update.reviewDueAt.toISOString()]).toEqual([
      0.25, 1, 3, new Date(NOW.getTime() + 3 * DAY).toISOString(),
    ]);
  });

  it("updateSkillState_estimate_isClampedToOne", () => {
    const update = updateSkillState(state(0.95), evidence("pass"), NOW);

    expect([update.estimate, update.intervalDays]).toEqual([1, 60]);
  });

  it("updateSkillState_estimate_isClampedToZero", () => {
    expect(updateSkillState(state(0.05), evidence("fail"), NOW).estimate).toBe(0);
  });
});

describe("masteryState", () => {
  it("masteryState_noEvidence_isNew", () => {
    expect(masteryState(undefined, NOW)).toBe("new");
  });

  it("masteryState_highEstimateButTooLittleEvidence_isNotMastered", () => {
    expect(masteryState(state(0.95, 2), NOW)).toBe("strong");
  });

  it("masteryState_highEstimateLongOverdue_isRusty", () => {
    expect(masteryState(state(0.9, 5, -20), NOW)).toBe("rusty");
  });

  it("masteryState_enoughIndependentEvidence_isMastered", () => {
    expect(masteryState(state(0.9, 3, 5), NOW)).toBe("mastered");
  });
});

describe("xpAwardsFor", () => {
  it.each(["wrong-answer", "infrastructure-error", "timeout"] as const)("xpAwardsFor_%s_awardsNothingAndDeductsNothing", (outcome) => {
    expect(xpAwardsFor("cart.q1", outcome, "independent")).toEqual([]);
  });

  it("xpAwardsFor_hintedPass_getsChallengeXpWithoutPenalty", () => {
    expect(xpAwardsFor("cart.q1", "succeeded", "hinted")).toEqual([{ eventKey: "quest-pass:cart.q1", delta: XP.codingChallenge }]);
  });

  it("xpAwardsFor_passWithTestsThatCaughtTheBugs_addsTheTestQualityAward", () => {
    expect(xpAwardsFor("cart.q8", "succeeded", "hinted", true)).toEqual([
      { eventKey: "quest-pass:cart.q8", delta: XP.codingChallenge },
      { eventKey: "quest-tests:cart.q8", delta: XP.testQuality },
    ]);
  });

  it("xpAwardsFor_failedCodeWithGoodTests_awardsNothing", () => {
    expect(xpAwardsFor("cart.q8", "wrong-answer", "independent", true)).toEqual([]);
  });

  it("xpAwardsFor_independentPass_addsTheNoHintBonusUnderItsOwnKey", () => {
    expect(xpAwardsFor("cart.q1", "succeeded", "independent").map((award) => award.eventKey)).toEqual(["quest-pass:cart.q1", "quest-independent:cart.q1"]);
  });
});

describe("planSession", () => {
  const quest = (order: number, completed: boolean, minutes = 30, skills = ["java.loops"]): QuestCandidate => ({
    contentVersionId: `cv-${order}`,
    contentId: `cart.q${order}`,
    title: `Quest ${order}`,
    campaignOrder: order,
    estimatedMinutes: minutes,
    completed,
    skills,
  });

  it("planSession_noContent_saysSo", () => {
    expect(planSession(15, [], [], NOW)).toMatchObject({ items: [], emptyReason: "no_content" });
  });

  it("planSession_everythingDoneNothingDue_saysCampaignComplete", () => {
    expect(planSession(15, [quest(1, true)], [], NOW).emptyReason).toBe("campaign_complete");
  });

  it("planSession_nextQuestLongerThanBudget_isStillOfferedAsASlice", () => {
    const plan = planSession(5, [quest(1, true), quest(2, false, 30)], [], NOW);

    expect(plan.items.map((item) => [item.contentVersionId, item.reasons.map((reason) => reason.code)])).toEqual([["cv-2", ["continue_campaign", "continues_later"]]]);
  });

  it("planSession_overdueSkill_revisitsAFinishedQuestFirst", () => {
    const plan = planSession(45, [quest(1, true, 20), quest(2, false)], [{ skillId: "java.loops", dueAt: new Date(NOW.getTime() - DAY), reason: "spaced_review" }], NOW);

    expect(plan.items.map((item) => [item.contentVersionId, item.estimatedMinutes, item.reasons[0].code])).toEqual([
      ["cv-1", 10, "review_due"],
      ["cv-2", 30, "continue_campaign"],
    ]);
  });

  it("planSession_reviewNotYetDue_isNotIncluded", () => {
    const plan = planSession(45, [quest(1, true), quest(2, false)], [{ skillId: "java.loops", dueAt: new Date(NOW.getTime() + DAY), reason: "spaced_review" }], NOW);

    expect(plan.items.map((item) => item.contentVersionId)).toEqual(["cv-2"]);
  });

  it("planSession_reviewThatDoesNotFitBudget_isSkipped", () => {
    const plan = planSession(5, [quest(1, true, 60), quest(2, false)], [{ skillId: "java.loops", dueAt: NOW, reason: "spaced_review" }], NOW);

    expect(plan.items.map((item) => item.contentVersionId)).toEqual(["cv-2"]);
  });

  it("planSession_campaignOrder_notInputOrder_decidesNext", () => {
    expect(planSession(30, [quest(3, false), quest(2, false), quest(1, true)], [], NOW).items[0].contentVersionId).toBe("cv-2");
  });
});
