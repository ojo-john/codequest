import "server-only";
import { checkStory, coverage, MAX_STORIES, QUESTIONS, storyInputSchema, type Story, type StoryCheck } from "@/lib/behavioral/stories";
import { ApiError } from "./http";
import type { StoryStore } from "./story-store";

/** The behavioral story bank (spec §35): the learner's own stories, checked for structure only. */
export class StoryService {
  constructor(private readonly store: StoryStore) {}

  async overview(userId: string) {
    const stories = await this.store.list(userId);
    const byCompetency = coverage(stories);
    return {
      stories: stories.map((story) => ({ id: story.id, title: story.title, competencies: story.competencies, updatedAt: story.updatedAt, suggestions: checkStory(story).filter((c) => c.status === "suggestion").length })),
      coverage: byCompetency,
      questions: QUESTIONS.map((question) => ({
        prompt: question.prompt,
        competencies: question.competencies,
        stories: byCompetency.filter((entry) => question.competencies.includes(entry.id)).flatMap((entry) => entry.stories).filter((story, index, all) => all.findIndex((other) => other.id === story.id) === index),
      })),
      limit: MAX_STORIES,
    };
  }

  async get(userId: string, id: string): Promise<{ story: Story; checks: StoryCheck[] }> {
    const story = await this.store.get(userId, id);
    if (!story) throw new ApiError(404, "not_found", "That story doesn't exist.");
    return { story, checks: checkStory(story) };
  }

  async create(userId: string, input: unknown): Promise<{ story: Story; checks: StoryCheck[] }> {
    const parsed = storyInputSchema.parse(input);
    if ((await this.store.count(userId)) >= MAX_STORIES) throw new ApiError(409, "story_limit", `You can keep up to ${MAX_STORIES} stories. Delete one to add another.`);
    const story = await this.store.create(userId, parsed);
    return { story, checks: checkStory(story) };
  }

  async update(userId: string, id: string, input: unknown): Promise<{ story: Story; checks: StoryCheck[] }> {
    const story = await this.store.update(userId, id, storyInputSchema.parse(input));
    if (!story) throw new ApiError(404, "not_found", "That story doesn't exist.");
    return { story, checks: checkStory(story) };
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    if (!(await this.store.remove(userId, id))) throw new ApiError(404, "not_found", "That story doesn't exist.");
    return { deleted: true };
  }
}
