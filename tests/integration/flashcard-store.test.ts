import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadContent } from "@/lib/content/repository";
import { syncContent } from "@/lib/content/sync";
import { SupabaseFlashcardStore } from "@/lib/server/flashcard-store";
import { closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

const CONTENT = join(import.meta.dirname, "..", "..", "content");
const CARD = { contentId: "problems.ds-int-stack", front: "Why does the array double?", back: "So push stays amortized O(1)." };

let alice: TestUser;
let bob: TestUser;
let store: SupabaseFlashcardStore;

beforeAll(async () => {
  await syncContent(sql(), loadContent(CONTENT));
  [alice, bob] = [await createTestUser("cards-alice"), await createTestUser("cards-bob")];
  store = new SupabaseFlashcardStore(serviceClient());
});

afterAll(async () => {
  await Promise.all([alice, bob].filter(Boolean).map(deleteTestUser));
  await closeSql();
});

describe("SupabaseFlashcardStore", () => {
  it("create_isDueImmediatelyInBoxOne", async () => {
    const card = await store.create(alice.id, CARD);

    expect([card.box, (await store.dueCount(alice.id, new Date(Date.now() + 1000))) >= 1]).toEqual([1, true]);
  });

  it("schedule_anotherLearnersCard_changesNothing", async () => {
    const card = await store.create(alice.id, CARD);

    expect([await store.schedule(bob.id, card.id, 5, new Date()), (await store.get(alice.id, card.id))?.box]).toEqual([false, 1]);
  });

  it("schedule_movesTheDueDate", async () => {
    const card = await store.create(alice.id, CARD);
    const later = new Date(Date.now() + 4 * 86_400_000);

    await store.schedule(alice.id, card.id, 3, later);

    expect(await store.get(alice.id, card.id)).toMatchObject({ box: 3, dueAt: later.toISOString() });
  });

  it("create_unknownContent_isRejectedByTheDatabase", async () => {
    await expect(store.create(alice.id, { ...CARD, contentId: "no.such-content" })).rejects.toThrow();
  });

  it("rls_learnerReadsOwnCardsOnly_andCannotWriteDirectly", async () => {
    await store.create(alice.id, CARD);
    const bobsView = await bob.client.from("flashcards").select("id");
    const insert = await alice.client.from("flashcards").insert({ user_id: alice.id, content_id: CARD.contentId, front: "x", back: "y" });

    expect([bobsView.data, insert.error?.code]).toEqual([[], "42501"]);
  });
});
