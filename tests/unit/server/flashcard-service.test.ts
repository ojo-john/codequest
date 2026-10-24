import { describe, expect, it } from "vitest";
import { MAX_FLASHCARDS } from "@/lib/learning/flashcards";
import type { ExerciseSetRecord } from "@/lib/server/exercise-store";
import { FlashcardService } from "@/lib/server/flashcard-service";
import type { Flashcard, FlashcardStore } from "@/lib/server/flashcard-store";
import { ApiError } from "@/lib/server/http";
import type { QuestRecord } from "@/lib/server/learning-store";

const USER = "11111111-1111-4111-8111-111111111111";
const QUEST_CV = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-24T12:00:00Z");
const QUEST = { contentVersionId: QUEST_CV, contentId: "problems.ds-int-stack", title: "Build a stack" } as unknown as QuestRecord;

class FakeFlashcardStore implements FlashcardStore {
  cards: Flashcard[] = [];
  async list() { return this.cards; }
  async get(_userId: string, id: string) { return this.cards.find((card) => card.id === id); }
  async count() { return this.cards.length; }
  async dueCount(_userId: string, now: Date) { return this.cards.filter((card) => Date.parse(card.dueAt) <= now.getTime()).length; }
  async create(_userId: string, card: { contentId: string; front: string; back: string }) {
    const created = { ...card, id: `c${this.cards.length + 1}`, box: 1, dueAt: NOW.toISOString() };
    this.cards.push(created);
    return created;
  }
  async schedule(_userId: string, id: string, box: number, dueAt: Date) {
    const index = this.cards.findIndex((card) => card.id === id);
    if (index < 0) return false;
    this.cards[index] = { ...this.cards[index], box, dueAt: dueAt.toISOString() };
    return true;
  }
  async remove(_userId: string, id: string) {
    const before = this.cards.length;
    this.cards = this.cards.filter((card) => card.id !== id);
    return this.cards.length < before;
  }
}

function service(store = new FakeFlashcardStore()) {
  return new FlashcardService({
    store,
    quests: { listVisibleQuests: async () => [QUEST], getVisibleQuest: async (_userId, id) => (id === QUEST_CV ? QUEST : undefined) },
    sets: { listVisibleSets: async () => [] as ExerciseSetRecord[], getVisibleSet: async () => undefined },
    clock: () => NOW,
  });
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error(`expected ApiError, got ${String(error)}`);
  return error;
}

describe("FlashcardService", () => {
  it("create_forContentTheLearnerCantSee_is404", async () => {
    expect((await apiError(service().create(USER, { contentVersionId: "33333333-3333-4333-8333-333333333333", front: "Q", back: "A" }))).status).toBe(404);
  });

  it("create_atTheLimit_is409AndStoresNothing", async () => {
    const store = new FakeFlashcardStore();
    for (let i = 0; i < MAX_FLASHCARDS; i++) await store.create(USER, { contentId: "x", front: "Q", back: "A" });

    const error = await apiError(service(store).create(USER, { contentVersionId: QUEST_CV, front: "Q", back: "A" }));

    expect([error.code, store.cards.length]).toEqual(["flashcard_limit", MAX_FLASHCARDS]);
  });

  it("create_blankFront_isRejected", async () => {
    await expect(service().create(USER, { contentVersionId: QUEST_CV, front: "   ", back: "A" })).rejects.toThrow();
  });

  it("create_keepsTheLearnersWordsAndLinksTheContent", async () => {
    const card = await service().create(USER, { contentVersionId: QUEST_CV, front: "Why double?", back: "Amortized O(1) push." });

    expect(card).toMatchObject({ contentId: "problems.ds-int-stack", front: "Why double?", back: "Amortized O(1) push." });
  });

  it("review_unknownCard_is404", async () => {
    expect((await apiError(service().review(USER, "missing", { knewIt: true }))).status).toBe(404);
  });

  it("overview_splitsDueCardsAndAddsTheirContext", async () => {
    const store = new FakeFlashcardStore();
    const learning = service(store);
    await learning.create(USER, { contentVersionId: QUEST_CV, front: "Q1", back: "A1" });
    const second = await learning.create(USER, { contentVersionId: QUEST_CV, front: "Q2", back: "A2" });
    await learning.review(USER, second.id, { knewIt: true });

    const { due, all } = await learning.overview(USER);

    expect([due.map((card) => card.front), all.length, all[0].context]).toEqual([["Q1"], 2, { title: "Build a stack", href: `/quests/${QUEST_CV}` }]);
  });
});
