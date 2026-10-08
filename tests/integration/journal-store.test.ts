import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadContent } from "@/lib/content/repository";
import { syncContent } from "@/lib/content/sync";
import { SupabaseJournalStore } from "@/lib/server/journal-store";
import { SupabaseLearningStore } from "@/lib/server/learning-store";
import { closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

const CONTENT = join(import.meta.dirname, "..", "..", "content");
const Q1 = "cart.q1-checkout-totals";
const Q2 = "cart.q2-cart-classes";
let alice: TestUser;
let bob: TestUser;
let journal: SupabaseJournalStore;
let learning: SupabaseLearningStore;
const versionIds = new Map<string, string>();

/** Records a graded attempt on a fresh job and returns that job's id. */
async function gradedJob(user: TestUser, contentId = Q1): Promise<string> {
  const jobId = crypto.randomUUID();
  await sql()`insert into public.execution_jobs (id, user_id, reserved_cpu_seconds) values (${jobId}, ${user.id}, 60)`;
  await learning.recordGradedAttempt({
    userId: user.id, executionJobId: jobId, contentVersionId: versionIds.get(contentId) ?? "", sessionItemId: null,
    response: { files: [] }, hintLevel: 0, activeSeconds: 10, state: "graded", outcome: "succeeded", rubricVersion: null,
    evidence: [], skillStates: [], xp: [],
  });
  return jobId;
}

beforeAll(async () => {
  await syncContent(sql(), loadContent(CONTENT));
  [alice, bob] = [await createTestUser("journal-alice"), await createTestUser("journal-bob")];
  journal = new SupabaseJournalStore(serviceClient());
  learning = new SupabaseLearningStore(serviceClient());
  for (const row of await sql()`select distinct on (content_id) content_id, id from public.content_versions order by content_id, version desc`) {
    versionIds.set(row.content_id, row.id);
  }
});

afterAll(async () => {
  await Promise.all([alice, bob].filter(Boolean).map(deleteTestUser));
  await closeSql();
});

describe("notes", () => {
  it("saveNote_twice_updatesOneNote", async () => {
    await journal.saveNote(alice.id, Q1, "first");

    const saved = await journal.saveNote(alice.id, Q1, "second");

    const [row] = await sql()`select count(*)::int as n from public.notes where user_id = ${alice.id} and content_id = ${Q1}`;
    expect([saved.body, row.n, (await journal.getNote(alice.id, Q1))?.body]).toEqual(["second", 1, "second"]);
  });

  it("getNote_otherUsersNote_isUndefined", async () => {
    await journal.saveNote(alice.id, Q2, "alice only");

    expect(await journal.getNote(bob.id, Q2)).toBeUndefined();
  });

  it("deleteNotes_removesOnlyThatLearnersNote", async () => {
    await journal.saveNote(alice.id, Q1, "alice");
    await journal.saveNote(bob.id, Q1, "bob");

    await journal.deleteNotes(bob.id, Q1);

    expect([await journal.getNote(bob.id, Q1), (await journal.getNote(alice.id, Q1))?.body]).toEqual([undefined, "alice"]);
  });
});

describe("reflections", () => {
  const body = { version: "reflection-v1", answers: { cue: "the word exact" } } as const;

  it("attemptForJob_otherUsersJob_isUndefined", async () => {
    const jobId = await gradedJob(alice);

    expect([await journal.attemptForJob(bob.id, jobId), (await journal.attemptForJob(alice.id, jobId))?.contentId]).toEqual([undefined, Q1]);
  });

  it("saveReflection_sameAttemptTwice_keepsTheFirst", async () => {
    const attempt = await journal.attemptForJob(alice.id, await gradedJob(alice));
    await journal.saveReflection(alice.id, attempt?.attemptId ?? "", body);

    await journal.saveReflection(alice.id, attempt?.attemptId ?? "", { version: "reflection-v1", answers: { cue: "changed" } });

    const rows = await sql()`select body from public.reflections where attempt_id = ${attempt?.attemptId ?? ""}`;
    expect(rows.map((row) => row.body)).toEqual([body]);
  });

  it("latestReflection_returnsTheNewestForThatQuestOnly", async () => {
    const q1 = await journal.attemptForJob(bob.id, await gradedJob(bob, Q1));
    await journal.saveReflection(bob.id, q1?.attemptId ?? "", body);
    const q2 = await journal.attemptForJob(bob.id, await gradedJob(bob, Q2));
    await journal.saveReflection(bob.id, q2?.attemptId ?? "", { version: "reflection-v1", answers: { reuse: "q2" } });

    const latest = await journal.latestReflection(bob.id, Q1);

    expect(latest?.body).toEqual(body);
  });

  it("latestReflection_otherUsersReflection_isUndefined", async () => {
    const carol = await createTestUser("journal-carol");
    try {
      expect(await journal.latestReflection(carol.id, Q1)).toBeUndefined();
    } finally {
      await deleteTestUser(carol);
    }
  });

  it("reflections_signedInLearnerCannotReflectOnAnotherUsersAttempt", async () => {
    const attempt = await journal.attemptForJob(alice.id, await gradedJob(alice));

    const { error } = await bob.client.from("reflections").insert({ user_id: bob.id, attempt_id: attempt?.attemptId, body });

    expect(error?.code).toBe("42501");
  });
});
