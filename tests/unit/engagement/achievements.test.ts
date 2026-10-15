import { describe, expect, it } from "vitest";
import { evaluateAchievements, type AchievementCounts } from "@/lib/engagement/achievements";
import type { SkillState } from "@/lib/learning/mastery";

const NOW = new Date("2026-10-15T12:00:00Z");
const ZERO: AchievementCounts = { complexityPasses: 0, recognitionPasses: 0, bugsFixed: 0, designsCompleted: 0, fastMocks: 0 };
const mastered = (skillId: string, dimension: SkillState["dimension"]): SkillState => ({ skillId, dimension, estimate: 0.9, evidenceCount: 5, reviewDueAt: NOW });
const byId = (results: ReturnType<typeof evaluateAchievements>, id: string) => results.find((result) => result.id === id);

describe("evaluateAchievements", () => {
  it("evaluate_countJustBelowTarget_isNotEarned_atTargetIs", () => {
    const below = byId(evaluateAchievements({ ...ZERO, complexityPasses: 49 }, [], NOW), "complexity-detective");
    const at = byId(evaluateAchievements({ ...ZERO, complexityPasses: 50 }, [], NOW), "complexity-detective");

    expect([below?.earned, at?.earned]).toEqual([false, true]);
  });

  it("evaluate_progressIsCappedAtTheTarget", () => {
    expect(byId(evaluateAchievements({ ...ZERO, fastMocks: 3 }, [], NOW), "speedrunner")?.progress).toBe(1);
  });

  it("evaluate_masteryCountsOnlyTheImplementationDimension", () => {
    const conceptOnly = byId(evaluateAchievements(ZERO, [mastered("patterns.sliding-window", "concept")], NOW), "window-shopper");
    const implementation = byId(evaluateAchievements(ZERO, [mastered("patterns.sliding-window", "implementation")], NOW), "window-shopper");

    expect([conceptOnly?.earned, implementation?.earned]).toEqual([false, true]);
  });

  it("evaluate_masteryWithTooLittleEvidence_isNotEarned", () => {
    expect(byId(evaluateAchievements(ZERO, [{ ...mastered("ds.trees", "implementation"), evidenceCount: 2 }], NOW), "tree-hugger")?.earned).toBe(false);
  });

  it("evaluate_nothingDone_earnsNothing", () => {
    expect(evaluateAchievements(ZERO, [], NOW).some((result) => result.earned)).toBe(false);
  });
});
