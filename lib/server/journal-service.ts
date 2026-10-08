import "server-only";
import { z } from "zod";
import { isRetrievalDue, reflectionAnswersSchema, reflectionBody, type ReflectionBody } from "@/lib/learning/reflection";
import { ApiError } from "./http";
import type { JournalStore, NoteRecord } from "./journal-store";
import type { LearningStore } from "./learning-store";

/**
 * Personal notes (spec §51) and the reflection card (spec §56). Both hold the learner's own words:
 * they are stored and shown back as written, never graded and never treated as canonical facts.
 */

export const MAX_NOTE_CHARS = 20_000;

export const saveNoteSchema = z.object({ body: z.string().max(MAX_NOTE_CHARS) });

export const saveReflectionSchema = z.object({ jobId: z.uuid(), answers: reflectionAnswersSchema });

export interface JournalServiceDeps {
  readonly store: JournalStore;
  readonly quests: Pick<LearningStore, "getVisibleQuest">;
  readonly clock?: () => Date;
}

export interface QuestJournal {
  readonly note: NoteRecord | undefined;
  readonly reflection: (ReflectionBody & { readonly createdAt: string; readonly retrievalDue: boolean }) | undefined;
}

export class JournalService {
  private readonly store: JournalStore;
  private readonly quests: JournalServiceDeps["quests"];
  private readonly clock: () => Date;

  constructor(deps: JournalServiceDeps) {
    this.store = deps.store;
    this.quests = deps.quests;
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Everything the quest page shows from the learner's journal. */
  async questJournal(userId: string, contentVersionId: string): Promise<QuestJournal> {
    const contentId = await this.requireContentId(userId, contentVersionId);
    const [note, reflection] = await Promise.all([this.store.getNote(userId, contentId), this.store.latestReflection(userId, contentId)]);
    return {
      note,
      reflection: reflection && { ...reflection.body, createdAt: reflection.createdAt, retrievalDue: isRetrievalDue(new Date(reflection.createdAt), this.clock()) },
    };
  }

  /** Saves the quest's note; an empty (or whitespace-only) body deletes it. */
  async saveNote(userId: string, contentVersionId: string, request: z.infer<typeof saveNoteSchema>): Promise<{ note: NoteRecord | null }> {
    const contentId = await this.requireContentId(userId, contentVersionId);
    if (request.body.trim() === "") {
      await this.store.deleteNotes(userId, contentId);
      return { note: null };
    }
    return { note: await this.store.saveNote(userId, contentId, request.body) };
  }

  async saveReflection(userId: string, request: z.infer<typeof saveReflectionSchema>): Promise<{ saved: true }> {
    const attempt = await this.store.attemptForJob(userId, request.jobId);
    if (attempt === undefined) throw new ApiError(404, "not_found", "There's no graded submission to reflect on.");
    await this.store.saveReflection(userId, attempt.attemptId, reflectionBody(request.answers));
    return { saved: true };
  }

  private async requireContentId(userId: string, contentVersionId: string): Promise<string> {
    const quest = await this.quests.getVisibleQuest(userId, contentVersionId);
    if (quest === undefined) throw new ApiError(404, "not_found", "That quest doesn't exist or isn't available to you.");
    return quest.contentId;
  }
}
