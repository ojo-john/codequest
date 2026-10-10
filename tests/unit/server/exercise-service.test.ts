import { describe, expect, it } from "vitest";
import type { PrivateAnswer } from "@/lib/exercises/schema";
import type { SkillState } from "@/lib/learning/mastery";
import type { ExerciseAttemptInput, ExerciseSetRecord, ExerciseStore, RecordedExerciseAttempt } from "@/lib/server/exercise-store";
import { ExerciseService } from "@/lib/server/exercise-service";
import { ApiError } from "@/lib/server/http";

const USER = "11111111-1111-4111-8111-111111111111";
const SET_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-09T12:00:00Z");

const SET: ExerciseSetRecord = {
  kind: "exercise-set",
  contentVersionId: SET_ID,
  contentId: "java.maps-1",
  version: 1,
  status: "draft",
  title: "Maps",
  summary: "Map basics.",
  world: { id: "world-1", order: 1 },
  estimatedMinutes: 5,
  questions: [{ id: "get-or-default", type: "single_choice", prompt: "What does getOrDefault return?", options: ["null", "the default"] }],
};
const ANSWERS: Record<string, PrivateAnswer> = {
  "get-or-default": { type: "single_choice", answer: 1, why: "A missing key gives the default.", skill: "java.collections", dimension: "concept" },
};

/** In-memory store; request keys behave like the database's unique index. */
class FakeExerciseStore implements ExerciseStore {
  sets = [SET];
  answers = ANSWERS;
  recorded: ExerciseAttemptInput[] = [];
  private readonly keys = new Set<string>();
  async listVisibleSets() { return this.sets; }
  async getVisibleSet(_u: string, id: string) { return this.sets.find((set) => set.contentVersionId === id); }
  async getAnswers() { return this.answers; }
  async bestOutcomes() { return new Map([["get-or-default", "succeeded"]]); }
  async passedQuestions() { return new Map<string, Set<string>>(); }
  async answeredSince() { return new Set<string>(); }
  async skillsOf() { return new Map<string, string[]>(); }
  async recordAttempt(input: ExerciseAttemptInput): Promise<RecordedExerciseAttempt> {
    if (this.keys.has(input.requestKey)) return { attemptId: "a1", awardedXp: 0, replayed: true };
    this.keys.add(input.requestKey);
    this.recorded.push(input);
    return { attemptId: "a1", awardedXp: input.xp.reduce((sum, award) => sum + award.delta, 0), replayed: false };
  }
}

function service(store = new FakeExerciseStore(), states: SkillState[] = []) {
  return new ExerciseService({ store, skills: { skillStates: async () => states }, clock: () => NOW });
}

function request(answer: unknown, overrides: Record<string, unknown> = {}) {
  return { requestKey: `key-${crypto.randomUUID()}`, contentVersionId: SET_ID, questionId: "get-or-default", answer, activeSeconds: 20, ...overrides };
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

describe("ExerciseService.answer", () => {
  it("answer_setNotVisible_is404AndRecordsNothing", async () => {
    const store = new FakeExerciseStore();

    const error = await apiError(service(store).answer(USER, request({ choice: 1 }, { contentVersionId: crypto.randomUUID() })));

    expect([error.status, store.recorded.length]).toEqual([404, 0]);
  });

  it("answer_unknownQuestion_is404", async () => {
    expect((await apiError(service().answer(USER, request({ choice: 1 }, { questionId: "nope" })))).status).toBe(404);
  });

  it("answer_malformedAnswer_is400AndRecordsNothing", async () => {
    const store = new FakeExerciseStore();

    const error = await apiError(service(store).answer(USER, request({ text: "the default" })));

    expect([error.status, error.code, store.recorded.length]).toEqual([400, "invalid_answer", 0]);
  });

  it("answer_questionWithoutAnswerKey_isAServerBugNotALearnerError", async () => {
    const store = new FakeExerciseStore();
    store.answers = {};

    await expect(service(store).answer(USER, request({ choice: 1 }))).rejects.toThrow(/has no answer/);
  });

  it("answer_correct_recordsPassEvidenceAndKeyedXp", async () => {
    const store = new FakeExerciseStore();

    const result = await service(store).answer(USER, request({ choice: 1 }));

    expect([result.outcome, result.awardedXp, result.why]).toEqual(["pass", 5, "A missing key gives the default."]);
    expect(store.recorded[0]).toMatchObject({ outcome: "succeeded", evidence: [{ skill_id: "java.collections", dimension: "concept", outcome: "pass" }], xp: [{ event_key: "exercise:java.maps-1:get-or-default" }] });
  });

  it("answer_wrong_recordsFailEvidenceWithoutXpAndShowsTheAnswer", async () => {
    const store = new FakeExerciseStore();

    const result = await service(store).answer(USER, request({ choice: 0 }));

    expect([result.outcome, result.correct, store.recorded[0].xp, store.recorded[0].outcome]).toEqual(["fail", { type: "choice", indices: [1] }, [], "wrong-answer"]);
  });

  it("answer_sameRequestKeyTwice_gradesAgainButRecordsOnce", async () => {
    const store = new FakeExerciseStore();
    const same = request({ choice: 1 });
    await service(store).answer(USER, same);

    const replay = await service(store).answer(USER, same);

    expect([replay.outcome, replay.awardedXp, replay.skill, store.recorded.length]).toEqual(["pass", 0, null, 1]);
  });
});

describe("ExerciseService reads", () => {
  it("listSets_summarisesWithoutQuestions", async () => {
    expect(await service().listSets(USER)).toEqual([
      { contentVersionId: SET_ID, title: "Maps", summary: "Map basics.", world: { id: "world-1", order: 1 }, estimatedMinutes: 5, status: "draft", questionCount: 1 },
    ]);
  });

  it("getSet_neverIncludesAnswers", async () => {
    const view = await service().getSet(USER, SET_ID);

    expect([JSON.stringify(view).includes("A missing key"), view.best]).toEqual([false, { "get-or-default": "succeeded" }]);
  });
});

describe("ExerciseService diagnostic", () => {
  const DIAGNOSTIC: ExerciseSetRecord = {
    ...SET,
    contentVersionId: "33333333-3333-4333-8333-333333333333",
    contentId: "diagnostic.base-camp",
    world: { id: "world.base-camp", order: 1 },
    sections: [{ id: "java", name: "Java", world: "world.java-awakening", questions: ["get-or-default"] }],
  };
  const PRACTICE: ExerciseSetRecord = { ...SET, world: { id: "world.java-awakening", order: 2 } };

  function diagnosticStore(): FakeExerciseStore {
    const store = new FakeExerciseStore();
    store.sets = [DIAGNOSTIC, PRACTICE];
    return store;
  }

  it("answer_diagnosticQuestion_earnsNoXpAndMovesTheEstimateHalfAsFar", async () => {
    const store = diagnosticStore();

    await service(store).answer(USER, request({ choice: 1 }, { contentVersionId: DIAGNOSTIC.contentVersionId }));

    expect([store.recorded[0].xp, store.recorded[0].skillStates[0].estimate]).toEqual([[], 0.125]);
  });

  it("listSets_neverListsTheDiagnostic", async () => {
    expect((await service(diagnosticStore()).listSets(USER)).map((set) => set.contentVersionId)).toEqual([SET_ID]);
  });

  it("placement_mapsBestOutcomesToSectionsAndSuggestsTheWorldsFirstSet", async () => {
    const placement = await service(diagnosticStore()).placement(USER);

    expect(placement).toMatchObject({
      taken: true,
      sections: [{ sectionId: "java", asked: 1, correct: 1, placement: "start_here", startWith: { contentVersionId: SET_ID, title: "Maps" } }],
    });
  });

  it("placement_noDiagnosticVisible_isUndefined", async () => {
    expect(await service().placement(USER)).toBeUndefined();
  });
});

describe("ExerciseService.mixed", () => {
  it("mixed_excludesTheDiagnosticAndKeepsEachQuestionsSet", async () => {
    const store = new FakeExerciseStore();
    store.sets = [SET, { ...SET, contentVersionId: "44444444-4444-4444-8444-444444444444", world: { id: "world.base-camp", order: 1 } }];

    const items = await new ExerciseService({ store, skills: { skillStates: async () => [] }, random: () => 0.5 }).mixed(USER);

    expect(items.map((item) => [item.contentVersionId, item.question.id])).toEqual([[SET_ID, "get-or-default"]]);
  });
});
