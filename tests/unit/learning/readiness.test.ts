import { describe, expect, it } from "vitest";
import type { SkillState } from "@/lib/learning/mastery";
import { computeReadiness } from "@/lib/learning/readiness";

const NOW = new Date("2026-10-10T12:00:00Z");
const SOON = new Date("2026-10-12T12:00:00Z");
const SKILLS = [
  { id: "java.a", category: "java", difficulty: 1 },
  { id: "java.b", category: "java", difficulty: 3 },
  { id: "bigo.a", category: "big-o", difficulty: 2 },
];

function state(skillId: string, estimate: number, evidenceCount = 3, reviewDueAt = SOON): SkillState {
  return { skillId, dimension: "implementation", estimate, evidenceCount, reviewDueAt };
}

const java = (states: SkillState[]) => computeReadiness(SKILLS, states, NOW).find((track) => track.id === "java")!;

describe("computeReadiness", () => {
  it("computeReadiness_noEvidence_isInsufficientNotZero", () => {
    const track = java([]);

    expect([track.status, track.skillsStillNeeded, "score" in track]).toEqual(["insufficient_evidence", 1, false]);
  });

  it("computeReadiness_tooFewPiecesOfEvidence_isInsufficient", () => {
    expect(java([state("java.a", 0.9, 2)]).status).toBe("insufficient_evidence");
  });

  it("computeReadiness_grindingTheEasySkill_cantMakeTheTrackStrong", () => {
    // Perfect on the difficulty-1 skill, nothing on the difficulty-3 one: (1 × 1 + 3 × 0) / 4.
    expect(java([state("java.a", 1, 20)])).toMatchObject({ status: "scored", score: 0.25, level: "building" });
  });

  it("computeReadiness_hardSkillsWeighMore", () => {
    expect(java([state("java.a", 0, 3), state("java.b", 1, 3)]).score).toBe(0.75);
  });

  it("computeReadiness_rustySkill_countsHalf", () => {
    const longOverdue = new Date("2026-08-01T00:00:00Z");

    expect(java([state("java.a", 1, 3), state("java.b", 1, 3, longOverdue)]).score).toBe(0.63);
  });

  it("computeReadiness_trackWithoutSkills_isInsufficient", () => {
    expect(computeReadiness(SKILLS, [], NOW).find((track) => track.id === "patterns")).toMatchObject({ skillCount: 0, status: "insufficient_evidence" });
  });

  it("computeReadiness_levels_followTheScore", () => {
    expect(java([state("java.a", 0.6, 3), state("java.b", 0.6, 3)]).level).toBe("developing");
  });
});
