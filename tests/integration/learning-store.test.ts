import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadContent } from "@/lib/content/repository";
import { syncContent } from "@/lib/content/sync";
import { SupabaseLearningStore, type GradedAttemptInput } from "@/lib/server/learning-store";
import { closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

const CONTENT = join(import.meta.dirname, "..", "..", "content");
let alice: TestUser;
let bob: TestUser;
let store: SupabaseLearningStore;
let questId: string;

async function setShowUnreviewed(user: TestUser, value: boolean): Promise<void> {
  await sql()`update public.profiles set settings = jsonb_set(settings, '{show_unreviewed_content}', ${sql().json(value)}) where user_id = ${user.id}`;
}

async function newJob(user: TestUser): Promise<string> {
  const id = crypto.randomUUID();
  await sql()`insert into public.execution_jobs (id, user_id, reserved_cpu_seconds) values (${id}, ${user.id}, 60)`;
  return id;
}

function attempt(user: TestUser, jobId: string, overrides: Partial<GradedAttemptInput> = {}): GradedAttemptInput {
  return {
    userId: user.id,
    executionJobId: jobId,
    contentVersionId: questId,
    sessionItemId: null,
    response: { files: [] },
    hintLevel: 0,
    activeSeconds: 30,
    state: "graded",
    outcome: "succeeded",
    rubricVersion: null,
    evidence: [{ skill_id: "java.loops", dimension: "implementation", outcome: "pass", independence: "independent", model_version: "rules-v1" }],
    skillStates: [{ skill_id: "java.loops", dimension: "implementation", estimate: 0.25, evidence_count: 1, review_due_at: "2026-10-10T00:00:00Z", scheduler_version: "ladder-v1", model_version: "rules-v1" }],
    xp: [{ event_key: "quest-pass:cart.q1-checkout-totals", delta: 30 }],
    ...overrides,
  };
}

beforeAll(async () => {
  await syncContent(sql(), loadContent(CONTENT));
  [alice, bob] = [await createTestUser("store-alice"), await createTestUser("store-bob")];
  store = new SupabaseLearningStore(serviceClient());
  const [row] = await sql()`select id from public.content_versions where content_id = 'cart.q1-checkout-totals' order by version desc limit 1`;
  questId = row.id;
});

beforeEach(async () => {
  await setShowUnreviewed(alice, false);
});

afterAll(async () => {
  await Promise.all([alice, bob].filter(Boolean).map(deleteTestUser));
  await closeSql();
});

describe("content visibility", () => {
  it("listVisibleQuests_draftsWithoutOptIn_areHidden", async () => {
    expect(await store.listVisibleQuests(alice.id)).toEqual([]);
  });

  it("listVisibleQuests_afterOptIn_showsEveryCampaignQuestLabelledDraft", async () => {
    await setShowUnreviewed(alice, true);

    const quests = await store.listVisibleQuests(alice.id);

    expect([quests.length, new Set(quests.map((quest) => quest.status))]).toEqual([9, new Set(["draft"])]);
  });

  it("getVisibleQuest_draftWithoutOptIn_isUndefined", async () => {
    expect(await store.getVisibleQuest(alice.id, questId)).toBeUndefined();
  });

  it("contentVersions_rls_followsTheSameOptIn", async () => {
    const hidden = await alice.client.from("content_versions").select("id").eq("id", questId);
    await setShowUnreviewed(alice, true);
    const shown = await alice.client.from("content_versions").select("id").eq("id", questId);

    expect([hidden.data, shown.data]).toEqual([[], [{ id: questId }]]);
  });

  it("contentVersions_oneLearnersOptIn_doesNotShowDraftsToAnother", async () => {
    await setShowUnreviewed(alice, true);

    const { data } = await bob.client.from("content_versions").select("id").eq("id", questId);

    expect(data).toEqual([]);
  });

  it("getGrading_returnsContractWithVisibleSamplesAndHints", async () => {
    const grading = await store.getGrading(questId);

    expect([grading.contract.cases.some((testCase) => testCase.visible), grading.hints[0].tier]).toEqual([true, "direction"]);
  });

  it("getContentGrading_asSignedInLearner_isDenied", async () => {
    const { error } = await alice.client.rpc("get_content_grading", { p_content_version_id: questId });

    expect(error?.code).toBe("42501");
  });
});

describe("hints, sessions and attempts", () => {
  it("recordHint_escalatesAndStopsAtTheLastTier", async () => {
    const tiers = [];
    for (let i = 0; i < 6; i++) tiers.push(await store.recordHint(bob.id, questId, 4));

    expect([tiers, await store.hintLevel(bob.id, questId)]).toEqual([[1, 2, 3, 4, 4, 4], 4]);
  });

  it("createSession_sameRequestKey_returnsTheSameSession", async () => {
    const key = `key-${crypto.randomUUID()}`;
    const items = [{ contentVersionId: questId, estimatedMinutes: 15 }];

    const first = await store.createSession(alice.id, 15, key, "rules-v1", items);
    const second = await store.createSession(alice.id, 15, key, "rules-v1", items);

    expect(second).toBe(first);
    const session = await store.getSession(alice.id, first);
    expect(session?.items.map((item) => [item.title, item.estimatedMinutes])).toEqual([["Checkout totals", 15]]);
  });

  it("getSession_otherUsersSession_isUndefined", async () => {
    const id = await store.createSession(alice.id, 15, `key-${crypto.randomUUID()}`, "rules-v1", []);

    expect(await store.getSession(bob.id, id)).toBeUndefined();
  });

  it("recordGradedAttempt_sameJobTwice_recordsOnceIncludingXp", async () => {
    const jobId = await newJob(alice);

    const first = await store.recordGradedAttempt(attempt(alice, jobId));
    const second = await store.recordGradedAttempt(attempt(alice, jobId));

    const [counts] = await sql()`
      select (select count(*)::int from public.attempts where execution_job_id = ${jobId}) as attempts,
             (select count(*)::int from public.mastery_evidence where attempt_id = ${first}) as evidence,
             (select count(*)::int from public.xp_ledger where user_id = ${alice.id} and event_key = 'quest-pass:cart.q1-checkout-totals') as xp`;
    expect([second, counts]).toEqual([first, { attempts: 1, evidence: 1, xp: 1 }]);
  });

  it("recordGradedAttempt_samePassAgainOnANewJob_doesNotAwardXpTwice", async () => {
    await store.recordGradedAttempt(attempt(alice, await newJob(alice)));
    await store.recordGradedAttempt(attempt(alice, await newJob(alice)));

    expect(await store.xpTotal(alice.id)).toBe(30);
  });

  it("completedContentIds_afterSuccessfulAttempt_includesTheQuest", async () => {
    await store.recordGradedAttempt(attempt(bob, await newJob(bob)));

    expect((await store.completedContentIds(bob.id)).has("cart.q1-checkout-totals")).toBe(true);
  });

  it("completedContentIds_infrastructureErrorAttempt_doesNotComplete", async () => {
    const carol = await createTestUser("store-carol");
    try {
      await store.recordGradedAttempt(attempt(carol, await newJob(carol), { state: "infrastructure_error", outcome: "infrastructure-error", evidence: [], skillStates: [], xp: [] }));

      expect((await store.completedContentIds(carol.id)).size).toBe(0);
    } finally {
      await deleteTestUser(carol);
    }
  });

  it("getJob_otherUsersJob_isUndefined", async () => {
    const jobId = await newJob(alice);
    await store.updateJob(jobId, { state: "succeeded", result: { mode: "submit", outcome: "succeeded", detail: "d" } });

    expect([await store.getJob(bob.id, jobId), (await store.getJob(alice.id, jobId))?.result?.outcome]).toEqual([undefined, "succeeded"]);
  });
});
