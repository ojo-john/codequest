import { describe, expect, it } from "vitest";
import { stageFor } from "@/lib/learning/endgame";
import type { TrackReadiness } from "@/lib/learning/readiness";
import { evaluateReadyCriteria, READY_DISCLAIMER, type ReadyInputs } from "@/lib/learning/ready-criteria";

const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

function track(id: string, score?: number): TrackReadiness {
  return score === undefined
    ? { id, name: id, skillCount: 4, evidencedSkills: 0, skillsStillNeeded: 2, status: "insufficient_evidence" }
    : { id, name: id, skillCount: 4, evidencedSkills: 4, skillsStillNeeded: 0, status: "scored", score, level: score >= 0.65 ? "strong" : score >= 0.35 ? "developing" : "building" };
}

function inputs(overrides: Partial<ReadyInputs> = {}): ReadyInputs {
  return {
    readiness: [track("data-structures", 0.9), track("patterns", 0.85), track("java", 0.9), track("system-design", 0.8), track("big-o", 0.9)],
    recognition: { passed: 18, total: 20 },
    complexity: { passed: 19, total: 20 },
    problems: { attempted: 10, solved: 8, independent: 7 },
    mocks: [{ finishedAt: daysAgo(1), overall: "strong" }, { finishedAt: daysAgo(5), overall: "mixed" }],
    now: NOW,
    ...overrides,
  };
}

const statusOf = (input: ReadyInputs, id: string) => evaluateReadyCriteria(input).criteria.find((criterion) => criterion.id === id)?.status;

describe("evaluateReadyCriteria", () => {
  it("evaluate_everyCriterionMet_isReadyWithTheDisclaimer", () => {
    const verdict = evaluateReadyCriteria(inputs());

    expect([verdict.ready, verdict.met, verdict.disclaimer]).toEqual([true, 8, READY_DISCLAIMER]);
  });

  it("evaluate_belowMinimumSample_isInsufficientEvidenceNotAFail", () => {
    expect(statusOf(inputs({ recognition: { passed: 19, total: 19 } }), "recognition")).toBe("insufficient_evidence");
  });

  it("evaluate_rateJustBelowThreshold_isNotMet_atThresholdIsMet", () => {
    expect([statusOf(inputs({ complexity: { passed: 17, total: 20 } }), "big-o"), statusOf(inputs({ complexity: { passed: 18, total: 20 } }), "big-o")]).toEqual(["not_met", "met"]);
  });

  it("evaluate_coreDsaUsesTheWeakerOfItsTracks", () => {
    expect(statusOf(inputs({ readiness: [track("data-structures", 0.95), track("patterns", 0.79), track("java", 0.9), track("system-design", 0.8)] }), "core-dsa")).toBe("not_met");
  });

  it("evaluate_unscoredTrack_isInsufficientEvidence", () => {
    expect(statusOf(inputs({ readiness: [track("data-structures", 0.9), track("patterns"), track("java", 0.9), track("system-design", 0.8)] }), "core-dsa")).toBe("insufficient_evidence");
  });

  it("evaluate_mocksOlderThanThirtyDays_dontCount", () => {
    expect(statusOf(inputs({ mocks: [{ finishedAt: daysAgo(1), overall: "strong" }, { finishedAt: daysAgo(31), overall: "strong" }] }), "mocks")).toBe("insufficient_evidence");
  });

  it("evaluate_latestMockNeedsWork_isNotMet", () => {
    expect(statusOf(inputs({ mocks: [{ finishedAt: daysAgo(1), overall: "needs_work" }, { finishedAt: daysAgo(2), overall: "strong" }, { finishedAt: daysAgo(3), overall: "strong" }] }), "mocks")).toBe("not_met");
  });

  it("evaluate_oneCriterionShort_isNotReady", () => {
    expect(evaluateReadyCriteria(inputs({ problems: { attempted: 10, solved: 8, independent: 5 } })).ready).toBe(false);
  });
});

describe("stageFor", () => {
  it("stageFor_fewerThanTwoCoreTracksScored_isEarly", () => {
    expect(stageFor([track("java", 0.9), track("big-o"), track("data-structures"), track("patterns")])).toBe("early");
  });

  it("stageFor_allCoreTracksStrong_isLate", () => {
    expect(stageFor([track("java", 0.7), track("big-o", 0.7), track("data-structures", 0.7), track("patterns", 0.7)])).toBe("late");
  });

  it("stageFor_coreScoredButOneNotStrong_isMiddle", () => {
    expect(stageFor([track("java", 0.7), track("big-o", 0.5), track("data-structures", 0.7), track("patterns", 0.7)])).toBe("middle");
  });

  it("stageFor_nonCoreTracksDontMatter", () => {
    expect(stageFor([track("java", 0.9), track("big-o", 0.9), track("system-design")])).toBe("middle");
  });
});
