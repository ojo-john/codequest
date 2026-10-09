import { masteryState, type MasteryState, type SkillDimension, type SkillState } from "./mastery";

/**
 * The skill tree (spec §39) as plain data: per world, each skill with per-dimension estimates,
 * practice history, prerequisites (strict vs recommended) and a few recommended tasks. Pure, so
 * the shape is tested without a database.
 */

export interface TreeInput {
  readonly worlds: ReadonlyArray<{ id: string; number: number; name: string; summary: string; available: boolean }>;
  readonly skills: ReadonlyArray<{ id: string; name: string; definition: string; difficulty: number; worldId: string | null }>;
  readonly edges: ReadonlyArray<{ skillId: string; prerequisiteId: string; kind: "strict" | "recommended" }>;
  readonly states: readonly SkillState[];
  readonly practice: ReadonlyArray<{ skillId: string; dimension: SkillDimension; evidenceCount: number; lastPracticedAt: Date }>;
  /** Visible content that exercises each skill; completed items are recommended last. */
  readonly tasks: ReadonlyArray<{ skillId: string; kind: "quest" | "practice"; contentVersionId: string; title: string; completed: boolean }>;
}

export interface DimensionView {
  readonly dimension: SkillDimension;
  readonly state: MasteryState;
  readonly estimate: number;
  readonly evidenceCount: number;
  readonly lastPracticedAt: string | null;
  readonly nextReviewAt: string | null;
}

export interface SkillView {
  readonly id: string;
  readonly name: string;
  readonly definition: string;
  readonly difficulty: number;
  readonly dimensions: readonly DimensionView[];
  readonly evidenceCount: number;
  readonly lastPracticedAt: string | null;
  readonly nextReviewAt: string | null;
  readonly prerequisites: ReadonlyArray<{ id: string; name: string; kind: "strict" | "recommended" }>;
  readonly unlocks: ReadonlyArray<{ id: string; name: string; kind: "strict" | "recommended" }>;
  readonly recommended: ReadonlyArray<{ kind: "quest" | "practice"; contentVersionId: string; title: string; completed: boolean }>;
}

export interface WorldView {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  readonly summary: string;
  readonly available: boolean;
  readonly skills: readonly SkillView[];
}

export const MAX_RECOMMENDED_TASKS = 3;

function latest(dates: readonly Date[]): string | null {
  return dates.length === 0 ? null : new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function earliest(dates: readonly Date[]): string | null {
  return dates.length === 0 ? null : new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString();
}

export function buildSkillTree(input: TreeInput, now: Date): WorldView[] {
  const names = new Map(input.skills.map((skill) => [skill.id, skill.name]));
  const view = (skill: TreeInput["skills"][number]): SkillView => {
    const states = input.states.filter((state) => state.skillId === skill.id);
    const practice = input.practice.filter((entry) => entry.skillId === skill.id);
    const dimensions = states
      .map((state): DimensionView => {
        const entry = practice.find((candidate) => candidate.dimension === state.dimension);
        return {
          dimension: state.dimension,
          state: masteryState(state, now),
          estimate: state.estimate,
          evidenceCount: state.evidenceCount,
          lastPracticedAt: entry ? entry.lastPracticedAt.toISOString() : null,
          nextReviewAt: state.reviewDueAt.toISOString(),
        };
      })
      .sort((a, b) => a.dimension.localeCompare(b.dimension));
    return {
      id: skill.id,
      name: skill.name,
      definition: skill.definition,
      difficulty: skill.difficulty,
      dimensions,
      evidenceCount: states.reduce((sum, state) => sum + state.evidenceCount, 0),
      lastPracticedAt: latest(practice.map((entry) => entry.lastPracticedAt)),
      nextReviewAt: earliest(states.map((state) => state.reviewDueAt)),
      prerequisites: input.edges
        .filter((edge) => edge.skillId === skill.id)
        .map((edge) => ({ id: edge.prerequisiteId, name: names.get(edge.prerequisiteId) ?? edge.prerequisiteId, kind: edge.kind }))
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "strict" ? -1 : 1)),
      unlocks: input.edges
        .filter((edge) => edge.prerequisiteId === skill.id)
        .map((edge) => ({ id: edge.skillId, name: names.get(edge.skillId) ?? edge.skillId, kind: edge.kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      recommended: input.tasks
        .filter((task) => task.skillId === skill.id)
        .sort((a, b) => Number(a.completed) - Number(b.completed))
        .slice(0, MAX_RECOMMENDED_TASKS)
        .map(({ kind, contentVersionId, title, completed }) => ({ kind, contentVersionId, title, completed })),
    };
  };
  return [...input.worlds]
    .sort((a, b) => a.number - b.number)
    .map((world) => ({ ...world, skills: input.skills.filter((skill) => skill.worldId === world.id).map(view) }));
}
