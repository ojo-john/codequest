import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MIN_EVIDENCE_FOR_MASTERY } from "@/lib/learning/mastery";
import { computeReadiness, UNAVAILABLE_TRACKS, type TrackReadiness } from "@/lib/learning/readiness";
import { StoreError, type LearningStore } from "./learning-store";
import type { SkillTreeStore } from "./skill-tree-store";

/**
 * The progress dashboard (spec §40, §41): readiness per track (separate from XP), and the
 * learner's numbers, each with its sample size so nothing looks more certain than it is.
 */

const dashboardSchema = z.object({
  evidence_by_dimension: z.record(z.string(), z.object({ total: z.coerce.number(), passed: z.coerce.number() })),
  problems_attempted: z.coerce.number(),
  problems_solved: z.coerce.number(),
  independent_solves: z.coerce.number(),
  first_attempt_passes: z.coerce.number(),
  median_solve_seconds: z.coerce.number().nullable(),
  solve_time_sample: z.coerce.number(),
  recent_evidence: z.array(z.object({ skill_id: z.string(), dimension: z.string(), outcome: z.string(), independence: z.string(), created_at: z.string() })),
});

export type DashboardStats = z.infer<typeof dashboardSchema>;

export interface DashboardStore {
  stats(userId: string): Promise<DashboardStats>;
}

export class SupabaseDashboardStore implements DashboardStore {
  constructor(private readonly db: SupabaseClient) {}

  async stats(userId: string): Promise<DashboardStats> {
    const { data, error } = await this.db.rpc("learning_dashboard", { p_user_id: userId });
    if (error) throw new StoreError("learning_dashboard", error.message, { cause: error });
    return dashboardSchema.parse(data);
  }
}

export interface Ratio {
  readonly count: number;
  readonly outOf: number;
}

export interface DashboardView {
  readonly readiness: readonly TrackReadiness[];
  readonly unavailableTracks: readonly string[];
  readonly problems: { readonly attempted: number; readonly solved: number; readonly independent: number; readonly firstAttempt: Ratio };
  readonly medianSolveSeconds: { readonly value: number | null; readonly sample: number };
  readonly recognition: Ratio;
  readonly complexity: Ratio;
  readonly weakest: ReadonlyArray<{ readonly skillId: string; readonly name: string; readonly estimate: number; readonly evidence: number }>;
  readonly strongest: ReadonlyArray<{ readonly skillId: string; readonly name: string; readonly estimate: number; readonly evidence: number }>;
  readonly recent: ReadonlyArray<{ readonly skill: string; readonly dimension: string; readonly outcome: string; readonly independence: string; readonly at: string }>;
}

export interface DashboardServiceDeps {
  readonly store: DashboardStore;
  readonly skills: Pick<SkillTreeStore, "skills">;
  readonly learning: Pick<LearningStore, "skillStates">;
  readonly clock?: () => Date;
}

/** How many skills to name as weakest / strongest. */
const EXTREMES = 3;

export class DashboardService {
  private readonly clock: () => Date;

  constructor(private readonly deps: DashboardServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async dashboard(userId: string): Promise<DashboardView> {
    const [stats, skills, states] = await Promise.all([this.deps.store.stats(userId), this.deps.skills.skills(), this.deps.learning.skillStates(userId)]);
    const names = new Map(skills.map((skill) => [skill.id, skill.name]));
    // Rank skills only once they have enough evidence to mean something.
    const perSkill = [...new Set(states.map((state) => state.skillId))]
      .map((skillId) => {
        const own = states.filter((state) => state.skillId === skillId);
        return {
          skillId,
          name: names.get(skillId) ?? skillId,
          estimate: own.reduce((sum, state) => sum + state.estimate, 0) / own.length,
          evidence: own.reduce((sum, state) => sum + state.evidenceCount, 0),
        };
      })
      .filter((entry) => entry.evidence >= MIN_EVIDENCE_FOR_MASTERY)
      .sort((a, b) => a.estimate - b.estimate || a.name.localeCompare(b.name));
    const weakest = perSkill.slice(0, EXTREMES);
    // Only name "strongest" skills that aren't already among the weakest.
    const strongest = perSkill.slice(EXTREMES).slice(-EXTREMES).reverse();
    const dimension = (name: string): Ratio => ({ count: stats.evidence_by_dimension[name]?.passed ?? 0, outOf: stats.evidence_by_dimension[name]?.total ?? 0 });

    return {
      readiness: computeReadiness(skills, states, this.clock()),
      unavailableTracks: UNAVAILABLE_TRACKS,
      problems: {
        attempted: stats.problems_attempted,
        solved: stats.problems_solved,
        independent: stats.independent_solves,
        firstAttempt: { count: stats.first_attempt_passes, outOf: stats.problems_attempted },
      },
      medianSolveSeconds: { value: stats.median_solve_seconds, sample: stats.solve_time_sample },
      recognition: dimension("recognition"),
      complexity: dimension("complexity"),
      weakest,
      strongest,
      recent: stats.recent_evidence.map((row) => ({ skill: names.get(row.skill_id) ?? row.skill_id, dimension: row.dimension, outcome: row.outcome, independence: row.independence, at: row.created_at })),
    };
  }
}
