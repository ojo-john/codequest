import "server-only";
import { buildSkillTree, type SkillView, type WorldView } from "@/lib/learning/skill-tree";
import type { ExerciseStore } from "./exercise-store";
import type { LearningStore } from "./learning-store";
import type { SkillTreeStore } from "./skill-tree-store";

/** The skill tree (spec §2, §39): worlds, skills, the learner's evidence and what to do next. */

export interface SkillTreeServiceDeps {
  readonly store: SkillTreeStore;
  readonly learning: Pick<LearningStore, "skillStates" | "listVisibleQuests" | "completedContentIds">;
  readonly exercises: Pick<ExerciseStore, "listVisibleSets">;
  readonly clock?: () => Date;
}

export class SkillTreeService {
  private readonly clock: () => Date;

  constructor(private readonly deps: SkillTreeServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async tree(userId: string): Promise<WorldView[]> {
    const { store, learning, exercises } = this.deps;
    const [worlds, skills, edges, states, practice, quests, completed, sets] = await Promise.all([
      store.worlds(),
      store.skills(),
      store.edges(),
      learning.skillStates(userId),
      store.practice(userId),
      learning.listVisibleQuests(userId),
      learning.completedContentIds(userId),
      exercises.listVisibleSets(userId),
    ]);
    const setTags = await store.tags(sets.map((set) => set.contentVersionId));
    // One task per (skill, content) even when an item is tagged with several dimensions of a skill.
    const tasks = new Map<string, { skillId: string; kind: "quest" | "practice"; contentVersionId: string; title: string; completed: boolean }>();
    for (const quest of [...quests].sort((a, b) => a.campaign.order - b.campaign.order)) {
      for (const tag of quest.skills) {
        tasks.set(`${tag.skill}:${quest.contentVersionId}`, { skillId: tag.skill, kind: "quest", contentVersionId: quest.contentVersionId, title: quest.title, completed: completed.has(quest.contentId) });
      }
    }
    for (const tag of setTags) {
      const set = sets.find((candidate) => candidate.contentVersionId === tag.contentVersionId);
      if (set) tasks.set(`${tag.skillId}:${set.contentVersionId}`, { skillId: tag.skillId, kind: "practice", contentVersionId: set.contentVersionId, title: set.title, completed: false });
    }
    return buildSkillTree({ worlds, skills, edges, states, practice, tasks: [...tasks.values()] }, this.clock());
  }

  async skill(userId: string, skillId: string): Promise<{ world: Omit<WorldView, "skills">; skill: SkillView } | undefined> {
    for (const world of await this.tree(userId)) {
      const skill = world.skills.find((candidate) => candidate.id === skillId);
      if (skill) return { world: { id: world.id, number: world.number, name: world.name, summary: world.summary, available: world.available }, skill };
    }
    return undefined;
  }
}
