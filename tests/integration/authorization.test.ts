import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

/**
 * Spec §66 acceptance: two distinct users and anonymous access. Users only ever see their own
 * rows; grading-derived data is read-only to them; content is visible only once published;
 * judge material is unreachable through the API.
 */

const PERMISSION_DENIED = "42501";
const SKILL = "test.authz-skill";
const PREREQ = "test.authz-prereq";

let alice: TestUser;
let bob: TestUser;
let anon: SupabaseClient;
let publishedVersionId: string;
let draftVersionId: string;
let contentId: string;

interface Seeded {
  attemptId: string;
  recommendationId: string;
  projectId: string;
}
const seeded: Record<"alice" | "bob", Seeded> = {} as Record<"alice" | "bob", Seeded>;

async function seedLearnerData(user: TestUser): Promise<Seeded> {
  const [session] = await sql()`
    insert into public.sessions (user_id, budget_minutes, client_request_key, policy_version)
    values (${user.id}, 15, ${crypto.randomUUID()}, 'rules-v1') returning id`;
  const [attempt] = await sql()`
    insert into public.attempts (user_id, content_version_id, response)
    values (${user.id}, ${publishedVersionId}, '{"answer": 1}') returning id`;
  await sql()`
    insert into public.mastery_evidence (user_id, attempt_id, skill_id, dimension, outcome, independence, model_version)
    values (${user.id}, ${attempt.id}, ${SKILL}, 'implementation', 'pass', 'independent', 'rules-v1')`;
  await sql()`
    insert into public.user_skill_state (user_id, skill_id, dimension, estimate, scheduler_version, model_version)
    values (${user.id}, ${SKILL}, 'implementation', 0.5, 'sched-v1', 'rules-v1')`;
  const [recommendation] = await sql()`
    insert into public.recommendations (user_id, session_id, reason_codes, policy_version)
    values (${user.id}, ${session.id}, '{overdue_review}', 'rules-v1') returning id`;
  await sql()`insert into public.xp_ledger (user_id, event_key, delta) values (${user.id}, ${`lesson:${crypto.randomUUID()}`}, 10)`;
  await sql()`insert into public.achievement_awards (user_id, achievement_id) values (${user.id}, 'window-shopper')`;
  await sql()`
    insert into public.execution_jobs (id, user_id, reserved_cpu_seconds) values (${crypto.randomUUID()}, ${user.id}, 60)`;

  const project = await user.client.from("projects").insert({ user_id: user.id, title: "Cart" }).select("id").single();
  if (project.error) throw project.error;
  const saved = await user.client.rpc("save_project_file", {
    p_project_id: project.data.id,
    p_path: "shop/Cart.java",
    p_expected_revision: 0,
    p_source: "class Cart {}",
    p_mutation_id: crypto.randomUUID(),
  });
  if (saved.error) throw saved.error;
  const note = await user.client.from("notes").insert({ user_id: user.id, content_id: contentId, body: "my note" });
  if (note.error) throw note.error;
  return { attemptId: attempt.id, recommendationId: recommendation.id, projectId: project.data.id };
}

beforeAll(async () => {
  anon = anonClient();
  [alice, bob] = [await createTestUser("alice"), await createTestUser("bob")];

  contentId = `test.authz-${crypto.randomUUID().slice(0, 8)}`;
  await sql()`insert into public.skills (id, category, name, definition, difficulty) values
    (${SKILL}, 'test', 'Authz skill', 'For tests', 1), (${PREREQ}, 'test', 'Authz prereq', 'For tests', 1)
    on conflict do nothing`;
  await sql()`insert into public.content_items (id, kind) values (${contentId}, 'question')`;
  const provenance = sql().json({ author: "test", license: "CC-BY-4.0" });
  const [published] = await sql()`
    insert into public.content_versions (content_id, version, status, payload, provenance, reviewed_at)
    values (${contentId}, 1, 'published', '{"prompt": "visible"}', ${provenance}, now()) returning id`;
  const [draft] = await sql()`
    insert into public.content_versions (content_id, version, status, payload, provenance)
    values (${contentId}, 2, 'draft', '{"prompt": "draft"}', ${provenance}) returning id`;
  publishedVersionId = published.id;
  draftVersionId = draft.id;
  await sql()`insert into private.content_secrets (content_version_id, hidden_grading) values (${publishedVersionId}, '{"expected": 42}')`;

  seeded.alice = await seedLearnerData(alice);
  seeded.bob = await seedLearnerData(bob);
});

afterAll(async () => {
  await Promise.all([alice, bob].filter(Boolean).map(deleteTestUser));
  await sql()`delete from public.content_versions where content_id = ${contentId} and status = 'draft'`;
  await closeSql();
});

// ---------------------------------------------------------------------------------------------

const USER_READABLE_TABLES = [
  "profiles",
  "sessions",
  "attempts",
  "mastery_evidence",
  "user_skill_state",
  "recommendations",
  "xp_ledger",
  "achievement_awards",
  "execution_jobs",
  "projects",
  "project_files",
  "notes",
] as const;

describe("cross-user isolation", () => {
  it.each(USER_READABLE_TABLES)("%s: alice sees only her own rows", async (table) => {
    const { data, error } = await alice.client.from(table).select("user_id");

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(new Set(data!.map((row) => row.user_id))).toEqual(new Set([alice.id]));
  });

  it.each(USER_READABLE_TABLES)("%s: anonymous sees nothing", async (table) => {
    const { data, error } = await anon.from(table).select("*");

    // Either denied outright or filtered to zero rows; never any user data.
    expect(error?.code === PERMISSION_DENIED || (error === null && data!.length === 0)).toBe(true);
  });

  it("notes: bob cannot update or delete alice's note", async () => {
    const update = await bob.client.from("notes").update({ body: "hijacked" }).eq("user_id", alice.id).select();
    const remove = await bob.client.from("notes").delete().eq("user_id", alice.id).select();

    const [stillThere] = await sql()`select body from public.notes where user_id = ${alice.id}`;
    expect([update.data, remove.data, stillThere.body]).toEqual([[], [], "my note"]);
  });

  it("notes: alice cannot create a note owned by bob", async () => {
    const { error } = await alice.client.from("notes").insert({ user_id: bob.id, content_id: contentId, body: "forged" });

    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("profiles: bob cannot update alice's profile", async () => {
    const { data } = await bob.client.from("profiles").update({ timezone: "Asia/Tokyo" }).eq("user_id", alice.id).select();

    const [profile] = await sql()`select timezone from public.profiles where user_id = ${alice.id}`;
    expect([data, profile.timezone]).toEqual([[], "UTC"]);
  });
});

describe("grading-derived data is read-only to learners", () => {
  const forgedRows = (): Record<string, Record<string, unknown>> => ({
    attempts: { user_id: alice.id, content_version_id: publishedVersionId, response: {}, state: "graded", graded_at: new Date().toISOString() },
    mastery_evidence: {
      user_id: alice.id, attempt_id: seeded.alice.attemptId, skill_id: PREREQ, dimension: "concept",
      outcome: "pass", independence: "independent", model_version: "forged",
    },
    user_skill_state: { user_id: alice.id, skill_id: PREREQ, dimension: "concept", estimate: 1, scheduler_version: "x", model_version: "x" },
    xp_ledger: { user_id: alice.id, event_key: "forged", delta: 1000 },
    achievement_awards: { user_id: alice.id, achievement_id: "architect" },
    execution_jobs: { id: crypto.randomUUID(), user_id: alice.id, reserved_cpu_seconds: 1 },
    recommendations: { user_id: alice.id, reason_codes: ["forged"], policy_version: "x" },
    sessions: { user_id: alice.id, budget_minutes: 5, client_request_key: crypto.randomUUID(), policy_version: "x" },
  });

  it.each(["attempts", "mastery_evidence", "user_skill_state", "xp_ledger", "achievement_awards", "execution_jobs", "recommendations", "sessions"])(
    "%s: alice cannot insert",
    async (table) => {
      const { error } = await alice.client.from(table).insert(forgedRows()[table]);

      expect(error?.code).toBe(PERMISSION_DENIED);
    },
  );

  it("xp_ledger: alice cannot inflate her own XP by updating a row", async () => {
    const { error } = await alice.client.from("xp_ledger").update({ delta: 1000 }).eq("user_id", alice.id);

    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("attempts: alice cannot mark her own attempt graded", async () => {
    const { error } = await alice.client.from("attempts").update({ state: "graded", outcome: "succeeded" }).eq("id", seeded.alice.attemptId);

    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("xp_ledger: the same event key can never be awarded twice", async () => {
    const eventKey = `quiz:${crypto.randomUUID()}`;
    await sql()`insert into public.xp_ledger (user_id, event_key, delta) values (${alice.id}, ${eventKey}, 10)`;

    await expect(sql()`insert into public.xp_ledger (user_id, event_key, delta) values (${alice.id}, ${eventKey}, 10)`).rejects.toMatchObject({
      code: "23505",
    });
  });

  it.each(["model_configs", "sync_mutations"])("%s: not readable through the API", async (table) => {
    const { error } = await alice.client.from(table).select("*");

    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("profiles: alice cannot change her user_id", async () => {
    const { error } = await alice.client.from("profiles").update({ user_id: bob.id }).eq("user_id", alice.id);

    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("learner-authored data", () => {
  it("profiles: alice can update her own timezone", async () => {
    const { error } = await alice.client.from("profiles").update({ timezone: "Europe/London" }).eq("user_id", alice.id);

    const [profile] = await sql()`select timezone from public.profiles where user_id = ${alice.id}`;
    await sql()`update public.profiles set timezone = 'UTC' where user_id = ${alice.id}`;
    expect([error, profile.timezone]).toEqual([null, "Europe/London"]);
  });

  it("profiles: an unknown timezone is rejected", async () => {
    const { error } = await alice.client.from("profiles").update({ timezone: "Mars/Olympus" }).eq("user_id", alice.id);

    expect(error?.code).toBe("22023");
  });

  it("reflections: alice can reflect on her own attempt", async () => {
    const { error } = await alice.client.from("reflections").insert({ user_id: alice.id, attempt_id: seeded.alice.attemptId, body: { cue: "window" } });

    expect(error).toBeNull();
  });

  it("reflections: alice cannot attach a reflection to bob's attempt", async () => {
    const { error } = await alice.client.from("reflections").insert({ user_id: alice.id, attempt_id: seeded.bob.attemptId, body: {} });

    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("recommendation_feedback: allowed on own recommendation, denied on bob's", async () => {
    const own = await alice.client.from("recommendation_feedback").insert({ recommendation_id: seeded.alice.recommendationId, user_id: alice.id, feedback: "dismissed" });
    const other = await alice.client.from("recommendation_feedback").insert({ recommendation_id: seeded.bob.recommendationId, user_id: alice.id, feedback: "dismissed" });

    expect([own.error, other.error?.code]).toEqual([null, PERMISSION_DENIED]);
  });
});

describe("project files", () => {
  const save = (user: TestUser, projectId: string, path: string, expectedRevision: number, source: string, mutationId = crypto.randomUUID()) =>
    user.client.rpc("save_project_file", {
      p_project_id: projectId,
      p_path: path,
      p_expected_revision: expectedRevision,
      p_source: source,
      p_mutation_id: mutationId,
    });

  it("save_project_file: bob cannot write into alice's project", async () => {
    const { error } = await save(bob, seeded.alice.projectId, "shop/Evil.java", 0, "class Evil {}");

    expect(error?.code).toBe("P0002");
  });

  it("save_project_file: a stale revision is a conflict, never a silent overwrite", async () => {
    const path = `shop/Conflict${Date.now()}.java`;
    await save(alice, seeded.alice.projectId, path, 0, "v1");
    await save(alice, seeded.alice.projectId, path, 1, "v2 from laptop");

    const stale = await save(alice, seeded.alice.projectId, path, 1, "v2 from phone");

    const [file] = await sql()`select source, revision from public.project_files where project_id = ${seeded.alice.projectId} and path = ${path}`;
    expect([stale.error?.code, file.source, file.revision]).toEqual(["PT409", "v2 from laptop", 2]);
  });

  it("save_project_file: a replayed outbox mutation changes nothing", async () => {
    const path = `shop/Replay${Date.now()}.java`;
    const mutationId = crypto.randomUUID();
    const first = await save(alice, seeded.alice.projectId, path, 0, "original", mutationId);

    const replay = await save(alice, seeded.alice.projectId, path, 0, "original", mutationId);

    expect([first.data, replay.data, replay.error]).toEqual([1, 1, null]);
  });

  it("save_project_file: a path that could escape the workspace is rejected", async () => {
    const { error } = await save(alice, seeded.alice.projectId, "../etc/Passwd.java", 0, "x");

    expect(error?.code).toBe("23514");
  });

  it("save_project_file: source beyond the project size limit is rejected", async () => {
    const { error } = await save(alice, seeded.alice.projectId, "shop/Huge.java", 0, "x".repeat(204_801));

    expect(error?.code).toBe("54000");
  });

  it("project_files: direct writes bypassing revision checks are denied", async () => {
    const { error } = await alice.client.from("project_files").update({ source: "overwritten" }).eq("project_id", seeded.alice.projectId);

    expect(error?.code).toBe(PERMISSION_DENIED);
  });
});

describe("content", () => {
  it("content_versions: anonymous and users see published versions only", async () => {
    const asAnon = await anon.from("content_versions").select("id").eq("content_id", contentId);
    const asAlice = await alice.client.from("content_versions").select("id").eq("content_id", contentId);

    expect([asAnon.data, asAlice.data]).toEqual([[{ id: publishedVersionId }], [{ id: publishedVersionId }]]);
    expect(draftVersionId).not.toBe(publishedVersionId);
  });

  it("content_versions: users cannot write content", async () => {
    const { error } = await alice.client.from("content_versions").update({ payload: { prompt: "edited" } }).eq("id", publishedVersionId);

    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("content_secrets: the private schema is not reachable through the API", async () => {
    const { data, error } = await serviceClient().schema("private").from("content_secrets").select("*");

    expect([data, error === null]).toEqual([null, false]);
  });

  it("content_versions: a published version is immutable even for trusted writers", async () => {
    await expect(sql()`update public.content_versions set payload = '{"prompt": "changed"}' where id = ${publishedVersionId}`).rejects.toMatchObject({
      code: PERMISSION_DENIED,
    });
  });

  it("content_versions: a published version can be deprecated", async () => {
    const [{ status }] = await sql()`
      with moved as (update public.content_versions set status = 'deprecated' where id = ${publishedVersionId} returning status)
      select status from moved`;
    await sql()`update public.content_versions set status = 'published' where id = ${publishedVersionId}`.catch(() => undefined);

    expect(status).toBe("deprecated");
  });

  it("content_versions: claiming human review without a review date is rejected", async () => {
    await expect(
      sql()`insert into public.content_versions (content_id, version, status, payload, provenance)
            values (${contentId}, 99, 'human_reviewed', '{}', ${sql().json({ author: "x", license: "x" })})`,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("skill_edges: a strict prerequisite cycle is rejected", async () => {
    await sql()`insert into public.skill_edges (skill_id, prerequisite_id, edge_kind) values (${SKILL}, ${PREREQ}, 'strict') on conflict do nothing`;

    await expect(sql()`insert into public.skill_edges (skill_id, prerequisite_id, edge_kind) values (${PREREQ}, ${SKILL}, 'strict')`).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("skill_edges: a recommended back-edge is allowed (ordering, not gating)", async () => {
    await sql()`insert into public.skill_edges (skill_id, prerequisite_id, edge_kind) values (${SKILL}, ${PREREQ}, 'strict') on conflict do nothing`;

    await sql()`insert into public.skill_edges (skill_id, prerequisite_id, edge_kind) values (${PREREQ}, ${SKILL}, 'recommended') on conflict do nothing`;
    const [{ count }] = await sql()`select count(*)::int as count from public.skill_edges where skill_id = ${PREREQ}`;
    await sql()`delete from public.skill_edges where skill_id in (${SKILL}, ${PREREQ})`;

    expect(count).toBe(1);
  });
});

describe("account deletion", () => {
  it("deleting a user removes all of their data", async () => {
    const carol = await createTestUser("carol");
    await seedLearnerData(carol);

    await deleteTestUser(carol);

    const [{ remaining }] = await sql()`
      select (select count(*) from public.profiles where user_id = ${carol.id})
           + (select count(*) from public.attempts where user_id = ${carol.id})
           + (select count(*) from public.xp_ledger where user_id = ${carol.id})
           + (select count(*) from public.project_files where user_id = ${carol.id})
           + (select count(*) from public.notes where user_id = ${carol.id}) as remaining`;
    expect(Number(remaining)).toBe(0);
  });
});
