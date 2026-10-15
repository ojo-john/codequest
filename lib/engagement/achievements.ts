import { masteryState, type SkillState } from "@/lib/learning/mastery";

/**
 * Achievements (spec §38), tied to independent evidence: hint-free passes, mastery estimates,
 * solved mocks. Line counts and time spent never earn one. Once earned, an achievement stays.
 */

export interface AchievementCounts {
  readonly complexityPasses: number;
  readonly recognitionPasses: number;
  readonly bugsFixed: number;
  readonly designsCompleted: number;
  readonly fastMocks: number;
}

type Measure = { readonly kind: "count"; readonly of: keyof AchievementCounts; readonly target: number } | { readonly kind: "mastery"; readonly skill: string };

export const ACHIEVEMENTS: ReadonlyArray<{ readonly id: string; readonly name: string; readonly description: string; readonly measure: Measure }> = [
  { id: "complexity-detective", name: "Complexity Detective", description: "50 correct complexity analyses without hints.", measure: { kind: "count", of: "complexityPasses", target: 50 } },
  { id: "window-shopper", name: "Window Shopper", description: "Master sliding windows.", measure: { kind: "mastery", skill: "patterns.sliding-window" } },
  { id: "tree-hugger", name: "Tree Hugger", description: "Master trees and their traversals.", measure: { kind: "mastery", skill: "ds.trees" } },
  { id: "pathfinder", name: "Pathfinder", description: "Master graph search (BFS and DFS).", measure: { kind: "mastery", skill: "patterns.graph-search" } },
  { id: "exterminator", name: "Exterminator", description: "100 bugs fixed without hints.", measure: { kind: "count", of: "bugsFixed", target: 100 } },
  { id: "architect", name: "Architect", description: "10 design challenges completed.", measure: { kind: "count", of: "designsCompleted", target: 10 } },
  { id: "speedrunner", name: "Speedrunner", description: "Solve a mock interview problem in 25 minutes or less.", measure: { kind: "count", of: "fastMocks", target: 1 } },
  { id: "pattern-wizard", name: "Pattern Wizard", description: "100 correct pattern recognitions without hints.", measure: { kind: "count", of: "recognitionPasses", target: 100 } },
];

export interface AchievementProgress {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly progress: number;
  readonly target: number;
  readonly earned: boolean;
}

/** Mastery achievements are judged on doing the thing: the skill's implementation dimension. */
const MASTERY_DIMENSION = "implementation";

export function evaluateAchievements(counts: AchievementCounts, states: readonly SkillState[], now: Date): AchievementProgress[] {
  return ACHIEVEMENTS.map((achievement) => {
    const { measure } = achievement;
    const [progress, target] =
      measure.kind === "count" ? [Math.min(counts[measure.of], measure.target), measure.target] : [masteryState(states.find((state) => state.skillId === measure.skill && state.dimension === MASTERY_DIMENSION), now) === "mastered" ? 1 : 0, 1];
    return { id: achievement.id, name: achievement.name, description: achievement.description, progress, target, earned: progress >= target };
  });
}
