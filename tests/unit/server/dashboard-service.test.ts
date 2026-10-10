import { describe, expect, it } from "vitest";
import type { SkillState } from "@/lib/learning/mastery";
import { DashboardService, type DashboardStats } from "@/lib/server/dashboard-service";
import type { QuestRecord } from "@/lib/server/learning-store";

const NOW = new Date("2026-10-10T12:00:00Z");
const DUE = new Date("2026-10-12T12:00:00Z");

const STATS: DashboardStats = {
  evidence_by_dimension: { recognition: { total: 4, passed: 3 }, implementation: { total: 2, passed: 2 } },
  problems_attempted: 4,
  problems_solved: 3,
  solved_content_ids: ["problems.lower-bound", "memory.lower-bound", "problems.pair-sum"],
  independent_solves: 1,
  first_attempt_passes: 2,
  median_solve_seconds: 420,
  solve_time_sample: 3,
  recent_evidence: [{ skill_id: "java.loops", dimension: "implementation", outcome: "pass", independence: "hinted", created_at: "2026-10-10T11:00:00Z" }],
};

const SKILLS = ["a", "b", "c", "d", "e"].map((id, index) => ({ id: `java.${id}`, name: `Skill ${id}`, category: "java", definition: "d", difficulty: 1, worldId: "w", index }));

const QUESTS = [
  { contentId: "problems.lower-bound", family: "lower-bound" },
  { contentId: "memory.lower-bound", family: "lower-bound" },
] as unknown as QuestRecord[];

function service(states: SkillState[]) {
  return new DashboardService({
    store: { stats: async () => STATS },
    skills: { skills: async () => SKILLS },
    learning: { skillStates: async () => states, listVisibleQuests: async () => QUESTS },
    clock: () => NOW,
  });
}

const state = (skillId: string, estimate: number, evidenceCount = 3): SkillState => ({ skillId, dimension: "implementation", estimate, evidenceCount, reviewDueAt: DUE });

describe("DashboardService", () => {
  it("dashboard_ratiosCarryTheirSampleSizes", async () => {
    const view = await service([]).dashboard("u");

    expect([view.recognition, view.complexity, view.problems.firstAttempt, view.medianSolveSeconds]).toEqual([
      { count: 3, outOf: 4 },
      { count: 0, outOf: 0 },
      { count: 2, outOf: 4 },
      { value: 420, sample: 3 },
    ]);
  });

  it("dashboard_skillsWithLittleEvidence_areNotRankedWeakestOrStrongest", async () => {
    const view = await service([state("java.a", 0.1, 1), state("java.b", 0.5)]).dashboard("u");

    expect([view.weakest.map((skill) => skill.skillId), view.strongest]).toEqual([["java.b"], []]);
  });

  it("dashboard_manySkills_weakestAndStrongestDontOverlap", async () => {
    const view = await service([state("java.a", 0.1), state("java.b", 0.2), state("java.c", 0.3), state("java.d", 0.8), state("java.e", 0.9)]).dashboard("u");

    expect([view.weakest.map((skill) => skill.skillId), view.strongest.map((skill) => skill.skillId)]).toEqual([
      ["java.a", "java.b", "java.c"],
      ["java.e", "java.d"],
    ]);
  });

  it("dashboard_recentEvidence_usesSkillNamesWhenKnown", async () => {
    expect((await service([]).dashboard("u")).recent[0]).toMatchObject({ skill: "java.loops", independence: "hinted" });
  });

  it("dashboard_variantsOfOneProblemFamily_countOnce", async () => {
    // Two lower-bound variants share a family; pair sum isn't visible any more and counts as its own.
    expect((await service([]).dashboard("u")).problems).toMatchObject({ solved: 3, families: 2 });
  });

  it("dashboard_listsTheTracksThatArentAvailableYet", async () => {
    expect((await service([]).dashboard("u")).unavailableTracks).toContain("Behavioral");
  });
});
