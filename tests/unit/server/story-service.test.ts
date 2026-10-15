import { describe, expect, it } from "vitest";
import { MAX_STORIES, type Story, type StoryInput } from "@/lib/behavioral/stories";
import { ApiError } from "@/lib/server/http";
import { StoryService } from "@/lib/server/story-service";
import type { StoryStore } from "@/lib/server/story-store";

const USER = "11111111-1111-4111-8111-111111111111";
const INPUT: StoryInput = { title: "A story", competencies: ["conflict"], situation: "", task: "", action: "", result: "", learned: "" };

class FakeStoryStore implements StoryStore {
  stories: Story[] = [];
  async list() { return this.stories; }
  async get(_userId: string, id: string) { return this.stories.find((story) => story.id === id); }
  async count() { return this.stories.length; }
  async create(_userId: string, story: StoryInput) {
    const created = { ...story, id: `s${this.stories.length + 1}`, updatedAt: "2026-10-15T00:00:00.000Z" };
    this.stories.push(created);
    return created;
  }
  async update(_userId: string, id: string, story: StoryInput) {
    const index = this.stories.findIndex((existing) => existing.id === id);
    if (index < 0) return undefined;
    this.stories[index] = { ...this.stories[index], ...story };
    return this.stories[index];
  }
  async remove(_userId: string, id: string) {
    const before = this.stories.length;
    this.stories = this.stories.filter((story) => story.id !== id);
    return this.stories.length < before;
  }
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error(`expected ApiError, got ${String(error)}`);
  return error;
}

describe("StoryService", () => {
  it("create_atTheLimit_is409AndStoresNothing", async () => {
    const store = new FakeStoryStore();
    for (let i = 0; i < MAX_STORIES; i++) await store.create(USER, INPUT);

    const error = await apiError(new StoryService(store).create(USER, INPUT));

    expect([error.code, store.stories.length]).toEqual(["story_limit", MAX_STORIES]);
  });

  it("create_invalidInput_isRejectedBeforeStoring", async () => {
    const store = new FakeStoryStore();

    await expect(new StoryService(store).create(USER, { ...INPUT, competencies: ["heroics"] })).rejects.toThrow();
    expect(store.stories).toEqual([]);
  });

  it("create_returnsTheStoryWithItsChecks", async () => {
    const result = await new StoryService(new FakeStoryStore()).create(USER, INPUT);

    expect([result.story.title, result.checks.length > 0]).toEqual(["A story", true]);
  });

  it("update_unknownStory_is404", async () => {
    expect((await apiError(new StoryService(new FakeStoryStore()).update(USER, "missing", INPUT))).status).toBe(404);
  });

  it("remove_unknownStory_is404", async () => {
    expect((await apiError(new StoryService(new FakeStoryStore()).remove(USER, "missing"))).status).toBe(404);
  });

  it("overview_matchesQuestionsToTaggedStoriesWithoutDuplicates", async () => {
    const store = new FakeStoryStore();
    await store.create(USER, { ...INPUT, title: "Pushback", competencies: ["disagreement", "conflict"] });

    const { questions } = await new StoryService(store).overview(USER);

    const disagreement = questions.find((question) => question.prompt.includes("disagreed with your manager"));
    expect(disagreement?.stories.map((story) => story.title)).toEqual(["Pushback"]);
  });
});
