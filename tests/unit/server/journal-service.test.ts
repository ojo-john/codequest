import { describe, expect, it } from "vitest";
import type { ReflectionBody } from "@/lib/learning/reflection";
import { ApiError } from "@/lib/server/http";
import type { GradedAttemptRef, JournalStore, NoteRecord, ReflectionRecord } from "@/lib/server/journal-store";
import { JournalService } from "@/lib/server/journal-service";
import type { QuestRecord } from "@/lib/server/learning-store";

const USER = "11111111-1111-4111-8111-111111111111";
const QUEST_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-20T12:00:00Z");

/** In-memory journal keyed like the database: notes by content id, reflections by attempt. */
class FakeJournalStore implements JournalStore {
  notes = new Map<string, NoteRecord>();
  reflections = new Map<string, ReflectionBody>();
  attempts = new Map<string, GradedAttemptRef>();
  latest: ReflectionRecord | undefined;

  async getNote(_u: string, contentId: string) { return this.notes.get(contentId); }
  async saveNote(_u: string, contentId: string, body: string) {
    const note = { id: "note-1", body, updatedAt: NOW.toISOString() };
    this.notes.set(contentId, note);
    return note;
  }
  async deleteNotes(_u: string, contentId: string) { this.notes.delete(contentId); }
  async attemptForJob(_u: string, jobId: string) { return this.attempts.get(jobId); }
  async saveReflection(_u: string, attemptId: string, body: ReflectionBody) { if (!this.reflections.has(attemptId)) this.reflections.set(attemptId, body); }
  async latestReflection() { return this.latest; }
}

const quests = {
  async getVisibleQuest(_u: string, id: string) {
    return id === QUEST_ID ? ({ contentId: "cart.q1-checkout-totals" } as QuestRecord) : undefined;
  },
};

function service(store = new FakeJournalStore()) {
  return new JournalService({ store, quests, clock: () => NOW });
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected an ApiError");
}

describe("JournalService.saveNote", () => {
  it("saveNote_questNotVisible_is404AndSavesNothing", async () => {
    const store = new FakeJournalStore();

    const error = await apiError(service(store).saveNote(USER, crypto.randomUUID(), { body: "x" }));

    expect([error.status, store.notes.size]).toEqual([404, 0]);
  });

  it("saveNote_text_isStoredExactlyAsWritten", async () => {
    const store = new FakeJournalStore();

    await service(store).saveNote(USER, QUEST_ID, { body: "  Totals are in cents.\n" });

    expect(store.notes.get("cart.q1-checkout-totals")?.body).toBe("  Totals are in cents.\n");
  });

  it("saveNote_whitespaceOnly_deletesTheNote", async () => {
    const store = new FakeJournalStore();
    await service(store).saveNote(USER, QUEST_ID, { body: "first" });

    const response = await service(store).saveNote(USER, QUEST_ID, { body: "  \n" });

    expect([response.note, store.notes.size]).toEqual([null, 0]);
  });
});

describe("JournalService.saveReflection", () => {
  it("saveReflection_noGradedAttemptForJob_is404", async () => {
    const error = await apiError(service().saveReflection(USER, { jobId: JOB_ID, answers: { cue: "x" } }));

    expect([error.status, error.code]).toEqual([404, "not_found"]);
  });

  it("saveReflection_gradedAttempt_storesTheVersionedBodyOnThatAttempt", async () => {
    const store = new FakeJournalStore();
    store.attempts.set(JOB_ID, { attemptId: "attempt-1", contentId: "cart.q1-checkout-totals" });

    await service(store).saveReflection(USER, { jobId: JOB_ID, answers: { cue: "exact", mistake: "" } });

    expect(store.reflections.get("attempt-1")).toEqual({ version: "reflection-v1", answers: { cue: "exact" } });
  });
});

describe("JournalService.questJournal", () => {
  it("questJournal_nothingWritten_isEmpty", async () => {
    expect(await service().questJournal(USER, QUEST_ID)).toEqual({ note: undefined, reflection: undefined });
  });

  it("questJournal_reflectionEightDaysOld_isMarkedForRetrieval", async () => {
    const store = new FakeJournalStore();
    store.latest = { body: { version: "reflection-v1", answers: { cue: "c" } }, createdAt: "2026-10-12T12:00:00Z" };

    const journal = await service(store).questJournal(USER, QUEST_ID);

    expect(journal.reflection?.retrievalDue).toBe(true);
  });

  it("questJournal_questNotVisible_is404", async () => {
    expect((await apiError(service().questJournal(USER, crypto.randomUUID()))).status).toBe(404);
  });
});
