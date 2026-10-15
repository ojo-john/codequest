import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StoryInput } from "@/lib/behavioral/stories";
import { SupabaseStoryStore } from "@/lib/server/story-store";
import { closeSql, createTestUser, deleteTestUser, serviceClient, type TestUser } from "./support/local-supabase";

const INPUT: StoryInput = { title: "Shipping under pressure", competencies: ["prioritization"], situation: "s", task: "t", action: "I did it.", result: "r", learned: "l" };

let alice: TestUser;
let bob: TestUser;
let store: SupabaseStoryStore;

beforeAll(async () => {
  [alice, bob] = [await createTestUser("story-alice"), await createTestUser("story-bob")];
  store = new SupabaseStoryStore(serviceClient());
});

afterAll(async () => {
  await Promise.all([alice, bob].filter(Boolean).map(deleteTestUser));
  await closeSql();
});

describe("SupabaseStoryStore", () => {
  it("create_thenUpdate_returnsTheNewTextAndALaterTimestamp", async () => {
    const created = await store.create(alice.id, INPUT);

    const updated = await store.update(alice.id, created.id, { ...INPUT, action: "I re-planned the release." });

    expect([updated?.action, Date.parse(updated!.updatedAt) >= Date.parse(created.updatedAt)]).toEqual(["I re-planned the release.", true]);
  });

  it("update_anotherLearnersStory_changesNothing", async () => {
    const created = await store.create(alice.id, INPUT);

    const result = await store.update(bob.id, created.id, { ...INPUT, title: "Hijacked" });

    expect([result, (await store.get(alice.id, created.id))?.title]).toEqual([undefined, INPUT.title]);
  });

  it("remove_anotherLearnersStory_isFalse", async () => {
    const created = await store.create(alice.id, INPUT);

    expect([await store.remove(bob.id, created.id), (await store.get(alice.id, created.id)) !== undefined]).toEqual([false, true]);
  });

  it("count_onlyCountsTheLearnersOwnStories", async () => {
    const before = await store.count(bob.id);
    await store.create(alice.id, INPUT);

    expect(await store.count(bob.id)).toBe(before);
  });

  it("rls_learnerReadsOwnStoriesOnly_andCannotWriteDirectly", async () => {
    const own = await bob.client.from("behavioral_stories").select("user_id");
    const insert = await alice.client.from("behavioral_stories").insert({ user_id: alice.id, title: "direct" });

    expect([own.data, insert.error?.code]).toEqual([[], "42501"]);
  });
});
