import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadContent } from "@/lib/content/repository";
import { syncContent } from "@/lib/content/sync";
import { scoreMock } from "@/lib/interview/mock-scoring";
import { SupabaseLearningStore } from "@/lib/server/learning-store";
import { SupabaseMockStore } from "@/lib/server/mock-store";
import { closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

const CONTENT = join(import.meta.dirname, "..", "..", "content");
const START = new Date("2026-10-15T10:00:00Z");
const END = new Date("2026-10-15T10:45:00Z");

let alice: TestUser;
let bob: TestUser;
let store: SupabaseMockStore;
let questId: string;

function newMock(user: TestUser, requestKey = `key-${crypto.randomUUID()}`) {
  return store.insert({ userId: user.id, durationMinutes: 45, contentVersionId: questId, requestKey, startedAt: START, endsAt: END });
}

const RESULT = scoreMock({ plan: { clarify: "", examples: "", bruteForce: "", optimized: "", complexity: "" }, startedAt: START, endsAt: END, finishedAt: END, submissions: [] });

beforeAll(async () => {
  await syncContent(sql(), loadContent(CONTENT));
  [alice, bob] = [await createTestUser("mock-alice"), await createTestUser("mock-bob")];
  store = new SupabaseMockStore(serviceClient());
  const [row] = await sql()`select id from public.content_versions where content_id = 'problems.pattern-lower-bound' order by version desc limit 1`;
  questId = row.id;
});

afterAll(async () => {
  await Promise.all([alice, bob].filter(Boolean).map(deleteTestUser));
  await closeSql();
});

describe("SupabaseMockStore", () => {
  it("insert_secondUnfinishedMock_isAConflict", async () => {
    const first = await newMock(alice);

    const second = await newMock(alice);

    expect([typeof first === "object", second]).toEqual([true, "conflict"]);
    if (typeof first === "object") await store.finish(alice.id, first.id, END, RESULT);
  });

  it("insert_repeatedRequestKey_isAConflictEvenAfterFinishing", async () => {
    const first = await newMock(alice, "repeat-key-1");
    if (typeof first === "object") await store.finish(alice.id, first.id, END, RESULT);

    expect(await newMock(alice, "repeat-key-1")).toBe("conflict");
  });

  it("finish_secondTime_changesNothing", async () => {
    const mock = await newMock(alice);
    if (mock === "conflict") throw new Error("unexpected conflict");
    await store.finish(alice.id, mock.id, END, RESULT);

    const again = await store.finish(alice.id, mock.id, START, { ...RESULT, overall: "strong" });

    expect([again, (await store.get(alice.id, mock.id))?.result?.overall]).toEqual([false, RESULT.overall]);
  });

  it("savePlan_finishedMock_isRefused", async () => {
    const mock = await newMock(alice);
    if (mock === "conflict") throw new Error("unexpected conflict");
    await store.finish(alice.id, mock.id, END, RESULT);

    expect(await store.savePlan(alice.id, mock.id, { clarify: "x", examples: "", bruteForce: "", optimized: "", complexity: "" })).toBe(false);
  });

  it("get_anotherLearnersMock_isAbsent", async () => {
    const mock = await newMock(bob);
    if (mock === "conflict") throw new Error("unexpected conflict");

    expect(await store.get(alice.id, mock.id)).toBeUndefined();
    await store.finish(bob.id, mock.id, END, RESULT);
  });

  it("rls_learnerReadsOwnMocksOnly_andCannotWriteDirectly", async () => {
    const own = await alice.client.from("mock_interviews").select("user_id");
    const insert = await alice.client.from("mock_interviews").insert({ user_id: alice.id, kind: "coding", duration_minutes: 45, content_version_id: questId, request_key: "direct-write", ends_at: END.toISOString() });
    const update = await alice.client.from("mock_interviews").update({ result: { overall: "strong" } }).eq("user_id", alice.id).select("id");

    expect([own.data!.length > 0 && own.data!.every((row) => row.user_id === alice.id), insert.error?.code, update.data ?? []]).toEqual([true, "42501", []]);
  });

  it("attemptedContentIds_includesAnyGradedOrFailedAttempt", async () => {
    const jobId = crypto.randomUUID();
    await sql()`insert into public.execution_jobs (id, user_id, reserved_cpu_seconds) values (${jobId}, ${alice.id}, 60)`;
    await new SupabaseLearningStore(serviceClient()).recordGradedAttempt({
      userId: alice.id, executionJobId: jobId, contentVersionId: questId, sessionItemId: null, response: {}, hintLevel: 0, activeSeconds: 10,
      state: "graded", outcome: "wrong-answer", rubricVersion: null, evidence: [], skillStates: [], xp: [],
    });

    expect(await store.attemptedContentIds(alice.id)).toEqual(new Set(["problems.pattern-lower-bound"]));
  });

  it("submissionsFor_returnsGradedAttemptsSinceTheStart", async () => {
    expect((await store.submissionsFor(alice.id, questId, new Date(Date.now() - 60_000))).map((submission) => submission.outcome)).toEqual(["wrong-answer"]);
  });
});
