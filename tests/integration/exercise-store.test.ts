import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadContent } from "@/lib/content/repository";
import { syncContent } from "@/lib/content/sync";
import { SupabaseExerciseStore, type ExerciseAttemptInput } from "@/lib/server/exercise-store";
import { SupabaseLearningStore } from "@/lib/server/learning-store";
import { closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

const CONTENT = join(import.meta.dirname, "..", "..", "content");
const SET = "java.maps-and-counting";
let alice: TestUser;
let bob: TestUser;
let store: SupabaseExerciseStore;
let setVersionId: string;

async function optIn(user: TestUser, value: boolean): Promise<void> {
  await sql()`update public.profiles set settings = jsonb_set(settings, '{show_unreviewed_content}', ${sql().json(value)}) where user_id = ${user.id}`;
}

function attempt(user: TestUser, overrides: Partial<ExerciseAttemptInput> = {}): ExerciseAttemptInput {
  return {
    userId: user.id,
    contentVersionId: setVersionId,
    requestKey: `key-${crypto.randomUUID()}`,
    response: { questionId: "get-or-default", answer: { choice: 1 } },
    activeSeconds: 12,
    outcome: "succeeded",
    evidence: [{ skill_id: "java.collections", dimension: "concept", outcome: "pass", independence: "independent", model_version: "rules-v1" }],
    skillStates: [{ skill_id: "java.collections", dimension: "concept", estimate: 0.25, evidence_count: 1, review_due_at: "2026-10-12T00:00:00Z", scheduler_version: "ladder-v1", model_version: "rules-v1" }],
    xp: [{ event_key: `exercise:${SET}:get-or-default`, delta: 5 }],
    ...overrides,
  };
}

beforeAll(async () => {
  await syncContent(sql(), loadContent(CONTENT));
  [alice, bob] = [await createTestUser("ex-alice"), await createTestUser("ex-bob")];
  store = new SupabaseExerciseStore(serviceClient());
  const [row] = await sql()`select id from public.content_versions where content_id = ${SET} order by version desc limit 1`;
  setVersionId = row.id;
});

beforeEach(async () => {
  await optIn(alice, true);
});

afterAll(async () => {
  await Promise.all([alice, bob].filter(Boolean).map(deleteTestUser));
  await closeSql();
});

describe("exercise sets", () => {
  it("sync_storesTheSetAsAQuestionItemTaggedWithItsSkills", async () => {
    const [item] = await sql()`select kind::text as kind from public.content_items where id = ${SET}`;
    const tags = await sql()`select skill_id || ':' || dimension::text as tag from public.content_skill_tags where content_version_id = ${setVersionId} order by 1`;

    expect([item.kind, tags.map((row) => row.tag)]).toEqual([
      "question",
      ["bigo.loops:complexity", "java.collections:complexity", "java.collections:concept", "java.collections:implementation", "java.strings:concept", "patterns.sliding-window:recognition"],
    ]);
  });

  it("listVisibleSets_withoutOptIn_hidesDrafts", async () => {
    await optIn(alice, false);

    expect(await store.listVisibleSets(alice.id)).toEqual([]);
  });

  it("listVisibleSets_afterOptIn_listsTheSetWithoutAnswers", async () => {
    const sets = await store.listVisibleSets(alice.id);

    expect([sets.map((set) => set.contentId), JSON.stringify(sets).includes("why")]).toEqual([[SET], false]);
  });

  it("listVisibleQuests_neverIncludesExerciseSets", async () => {
    const quests = await new SupabaseLearningStore(serviceClient()).listVisibleQuests(alice.id);

    expect(quests.some((quest) => quest.contentId === SET)).toBe(false);
  });

  it("getAnswers_returnsTheCanonicalAnswers", async () => {
    expect((await store.getAnswers(setVersionId))["get-or-default"]).toMatchObject({ type: "single_choice", answer: 1 });
  });

  it("getAnswers_asSignedInLearner_isDenied", async () => {
    const { error } = await alice.client.rpc("get_content_grading", { p_content_version_id: setVersionId });

    expect(error?.code).toBe("42501");
  });
});

describe("exercise attempts", () => {
  it("recordAttempt_sameRequestKeyTwice_recordsOnceAndAwardsXpOnce", async () => {
    const input = attempt(bob);

    const first = await store.recordAttempt(input);
    const second = await store.recordAttempt(input);

    const [row] = await sql()`select (select count(*)::int from public.attempts where user_id = ${bob.id}) as attempts,
      (select count(*)::int from public.mastery_evidence where user_id = ${bob.id}) as evidence`;
    expect([first.replayed, first.awardedXp, second.replayed, second.attemptId === first.attemptId, row]).toEqual([false, 5, true, true, { attempts: 1, evidence: 1 }]);
  });

  it("recordAttempt_concurrentSameKey_recordsOnce", async () => {
    const carol = await createTestUser("ex-carol");
    try {
      const input = attempt(carol);

      const results = await Promise.all(Array.from({ length: 5 }, () => store.recordAttempt(input)));

      const [row] = await sql()`select count(*)::int as n from public.attempts where user_id = ${carol.id}`;
      expect([row.n, results.filter((result) => !result.replayed).length]).toEqual([1, 1]);
    } finally {
      await deleteTestUser(carol);
    }
  });

  it("recordAttempt_secondCorrectAnswerToTheSameQuestion_earnsNoMoreXp", async () => {
    const dave = await createTestUser("ex-dave");
    try {
      await store.recordAttempt(attempt(dave));

      const again = await store.recordAttempt(attempt(dave));

      expect(again.awardedXp).toBe(0);
    } finally {
      await deleteTestUser(dave);
    }
  });

  it("bestOutcomes_keepsTheBestPerQuestionForThisLearnerOnly", async () => {
    const erin = await createTestUser("ex-erin");
    try {
      await store.recordAttempt(attempt(erin, { outcome: "wrong-answer", xp: [] }));
      await store.recordAttempt(attempt(erin, { outcome: "succeeded" }));
      await store.recordAttempt(attempt(erin, { outcome: "partial", response: { questionId: "fast-lookup", answer: { choices: [0] } }, xp: [] }));

      expect([Object.fromEntries(await store.bestOutcomes(erin.id, setVersionId)), (await store.bestOutcomes(alice.id, setVersionId)).size]).toEqual([
        { "get-or-default": "succeeded", "fast-lookup": "partial" },
        0,
      ]);
    } finally {
      await deleteTestUser(erin);
    }
  });

  it("recordExerciseAttempt_asSignedInLearner_isDenied", async () => {
    const { error } = await alice.client.rpc("record_exercise_attempt", {
      p_user_id: alice.id, p_content_version_id: setVersionId, p_request_key: "key-12345678", p_response: {}, p_active_seconds: 1,
      p_outcome: "succeeded", p_evidence: [], p_skill_states: [], p_xp: [{ event_key: "free-xp", delta: 1000 }],
    });

    expect(error?.code).toBe("42501");
  });
});
