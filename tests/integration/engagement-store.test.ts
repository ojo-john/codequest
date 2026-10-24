import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadContent } from "@/lib/content/repository";
import { syncContent } from "@/lib/content/sync";
import { SupabaseEngagementStore } from "@/lib/server/engagement-store";
import { closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

const CONTENT = join(import.meta.dirname, "..", "..", "content");

let alice: TestUser;
let store: SupabaseEngagementStore;
let problemId: string;
let debugId: string;

async function attempt(createdAt: string, options: { seconds?: number; contentVersionId?: string; outcome?: string; hintLevel?: number } = {}) {
  await sql()`insert into public.attempts (user_id, content_version_id, response, hint_level, active_seconds, state, outcome, graded_at, created_at)
    values (${alice.id}, ${options.contentVersionId ?? problemId}, '{}', ${options.hintLevel ?? 0}, ${options.seconds ?? 120},
            'graded', ${options.outcome ?? "wrong-answer"}, ${createdAt}, ${createdAt})`;
}

beforeAll(async () => {
  await syncContent(sql(), loadContent(CONTENT));
  alice = await createTestUser("engagement-alice");
  store = new SupabaseEngagementStore(serviceClient());
  [{ id: problemId }] = await sql()`select id from public.content_versions where content_id = 'problems.ds-int-stack' order by version desc limit 1`;
  [{ id: debugId }] = await sql()`select id from public.content_versions where content_id like 'debug.%' order by content_id limit 1`;
});

beforeEach(async () => {
  await sql()`delete from public.attempts where user_id = ${alice.id}`;
  await sql()`update public.profiles set timezone = 'UTC', settings = '{}' where user_id = ${alice.id}`;
});

afterAll(async () => {
  if (alice) await deleteTestUser(alice);
  await closeSql();
});

describe("daily_activity", () => {
  it("dailyActivity_groupsByTheLearnersLocalDate", async () => {
    await sql()`update public.profiles set timezone = 'America/Los_Angeles' where user_id = ${alice.id}`;
    await attempt("2026-10-15T02:00:00Z", { seconds: 100 }); // Oct 14 in Los Angeles
    await attempt("2026-10-15T20:00:00Z", { seconds: 200 }); // Oct 15

    expect([...(await store.dailyActivity(alice.id, "2026-10-01")).entries()]).toEqual([["2026-10-14", 100], ["2026-10-15", 200]]);
  });

  it("profiles_unknownZone_isRejectedSoDayGroupingNeverSeesOne", async () => {
    const result = await alice.client.from("profiles").update({ timezone: "Mars/Olympus" }).eq("user_id", alice.id);

    expect(result.error?.message).toMatch(/unknown IANA timezone/);
  });

  it("dailyActivity_daysBeforeSince_areLeftOut", async () => {
    await attempt("2026-09-30T12:00:00Z");

    expect((await store.dailyActivity(alice.id, "2026-10-01")).size).toBe(0);
  });
});

describe("achievement_counts and awards", () => {
  it("achievementCounts_countsOnlyHintFreeDebugFixesPerQuest", async () => {
    await attempt("2026-10-15T10:00:00Z", { contentVersionId: debugId, outcome: "succeeded" });
    await attempt("2026-10-15T11:00:00Z", { contentVersionId: debugId, outcome: "succeeded" });

    expect((await store.achievementCounts(alice.id)).bugsFixed).toBe(1);
  });

  it("achievementCounts_hintedDebugFix_doesNotCount", async () => {
    await attempt("2026-10-15T10:00:00Z", { contentVersionId: debugId, outcome: "succeeded", hintLevel: 1 });

    expect((await store.achievementCounts(alice.id)).bugsFixed).toBe(0);
  });

  it("award_twice_keepsTheFirstDate", async () => {
    await store.award(alice.id, ["speedrunner"]);
    const first = (await store.awards(alice.id)).get("speedrunner");

    await store.award(alice.id, ["speedrunner"]);

    expect((await store.awards(alice.id)).get("speedrunner")).toBe(first);
  });

  it("savePauses_keepsOtherSettings", async () => {
    await sql()`update public.profiles set settings = '{"show_unreviewed_content": true}' where user_id = ${alice.id}`;

    await store.savePauses(alice.id, [{ kind: "vacation", from: "2026-11-01", to: "2026-11-03" }]);

    const [row] = await sql()`select settings from public.profiles where user_id = ${alice.id}`;
    expect(row.settings).toEqual({ show_unreviewed_content: true, streak_pauses: [{ kind: "vacation", from: "2026-11-01", to: "2026-11-03" }] });
  });

  it("rpcs_areNotCallableByLearners", async () => {
    const results = await Promise.all([
      alice.client.rpc("daily_activity", { p_user_id: alice.id, p_since: "2026-10-01" }),
      alice.client.rpc("achievement_counts", { p_user_id: alice.id }),
      alice.client.rpc("set_profile_setting", { p_user_id: alice.id, p_key: "x", p_value: 1 }),
    ]);

    expect(results.map((result) => result.error?.code)).toEqual(["42501", "42501", "42501"]);
  });
});
