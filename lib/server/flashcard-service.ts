import "server-only";
import { flashcardInputSchema, flashcardReviewSchema, MAX_FLASHCARDS, nextReview } from "@/lib/learning/flashcards";
import type { ExerciseStore } from "./exercise-store";
import type { Flashcard, FlashcardStore } from "./flashcard-store";
import { ApiError } from "./http";
import type { LearningStore } from "./learning-store";

/** Flashcards the learner makes from their notes (spec §51), reviewed on a Leitner schedule. */

export interface FlashcardView extends Flashcard {
  /** Where the card came from: the problem or practice set, if still visible. */
  readonly context?: { readonly title: string; readonly href: string };
}

export interface FlashcardServiceDeps {
  readonly store: FlashcardStore;
  readonly quests: Pick<LearningStore, "listVisibleQuests" | "getVisibleQuest">;
  readonly sets: Pick<ExerciseStore, "listVisibleSets" | "getVisibleSet">;
  readonly clock?: () => Date;
}

export class FlashcardService {
  private readonly clock: () => Date;

  constructor(private readonly deps: FlashcardServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async overview(userId: string): Promise<{ due: FlashcardView[]; all: FlashcardView[] }> {
    const [cards, quests, sets] = await Promise.all([this.deps.store.list(userId), this.deps.quests.listVisibleQuests(userId), this.deps.sets.listVisibleSets(userId)]);
    const contexts = new Map<string, { title: string; href: string }>([
      ...quests.map((quest) => [quest.contentId, { title: quest.title, href: `/quests/${quest.contentVersionId}` }] as const),
      ...sets.map((set) => [set.contentId, { title: set.title, href: set.design ? `/design/${set.contentVersionId}` : `/practice/${set.contentVersionId}` }] as const),
    ]);
    const now = this.clock().getTime();
    const all = cards.map((card) => {
      const context = contexts.get(card.contentId);
      return context ? { ...card, context } : card;
    });
    return { due: all.filter((card) => Date.parse(card.dueAt) <= now), all };
  }

  dueCount(userId: string): Promise<number> {
    return this.deps.store.dueCount(userId, this.clock());
  }

  /** A card the learner chose to make; its content must be a problem or set they can see. */
  async create(userId: string, input: unknown): Promise<Flashcard> {
    const parsed = flashcardInputSchema.parse(input);
    const owner = (await this.deps.quests.getVisibleQuest(userId, parsed.contentVersionId)) ?? (await this.deps.sets.getVisibleSet(userId, parsed.contentVersionId));
    if (!owner) throw new ApiError(404, "not_found", "That problem or practice set doesn't exist or isn't available to you.");
    if ((await this.deps.store.count(userId)) >= MAX_FLASHCARDS) throw new ApiError(409, "flashcard_limit", `You can keep up to ${MAX_FLASHCARDS} flashcards. Delete some to add more.`);
    return this.deps.store.create(userId, { contentId: owner.contentId, front: parsed.front, back: parsed.back });
  }

  async review(userId: string, id: string, input: unknown): Promise<{ box: number; dueAt: string }> {
    const { knewIt } = flashcardReviewSchema.parse(input);
    const card = await this.deps.store.get(userId, id);
    if (!card) throw new ApiError(404, "not_found", "That flashcard doesn't exist.");
    const next = nextReview(card.box, knewIt, this.clock());
    if (!(await this.deps.store.schedule(userId, id, next.box, next.dueAt))) throw new ApiError(404, "not_found", "That flashcard doesn't exist.");
    return { box: next.box, dueAt: next.dueAt.toISOString() };
  }

  async remove(userId: string, id: string): Promise<{ deleted: true }> {
    if (!(await this.deps.store.remove(userId, id))) throw new ApiError(404, "not_found", "That flashcard doesn't exist.");
    return { deleted: true };
  }
}
