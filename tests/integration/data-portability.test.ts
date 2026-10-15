import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Archive } from "@/lib/archive/archive-schema";
import { loadArchiveSigningKey } from "@/lib/archive/archive-signing";
import { loadContent } from "@/lib/content/repository";
import { syncContent } from "@/lib/content/sync";
import { DEFAULT_EXECUTION_LIMITS } from "@/lib/execution/limits";
import { silentLogger } from "@/lib/observability/log";
import { ArchiveService, DELETE_CONFIRMATION_PHRASE, MissingReferencesError } from "@/lib/server/archive-service";
import { SupabaseArchiveStore } from "@/lib/server/archive-store";
import { SupabaseLearningStore } from "@/lib/server/learning-store";
import { closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

const CONTENT = join(import.meta.dirname, "..", "..", "content");
const CAMPAIGN = "campaign.shopping-cart";
const KEY = loadArchiveSigningKey({ ARCHIVE_SIGNING_KEY: Buffer.alloc(32, 5).toString("base64") });

let alice: TestUser;
let bob: TestUser;
let archiveStore: SupabaseArchiveStore;
let learning: SupabaseLearningStore;
let archives: ArchiveService;
let questId: string;

async function newJob(user: TestUser): Promise<string> {
  const id = crypto.randomUUID();
  await sql()`insert into public.execution_jobs (id, user_id, reserved_cpu_seconds) values (${id}, ${user.id}, 60)`;
  return id;
}

/** A learner with one session, a graded attempt (evidence, skill state, XP), a hint, a project and a note. */
async function seedLearner(user: TestUser): Promise<{ projectId: string }> {
  const sessionId = await learning.createSession(user.id, 15, `key-${crypto.randomUUID()}`, "planner-v1", [{ contentVersionId: questId, estimatedMinutes: 15 }]);
  await learning.recordRecommendation(user.id, sessionId, ["new_material"], "planner-v1");
  const view = await learning.getSession(user.id, sessionId);
  await learning.recordHint(user.id, questId, 3);
  const graded = await learning.recordGradedAttempt({
    userId: user.id,
    executionJobId: await newJob(user),
    contentVersionId: questId,
    sessionItemId: view!.items[0].id,
    response: { files: [{ path: "shop/Checkout.java", content: "class Checkout {}" }] },
    hintLevel: 1,
    activeSeconds: 90,
    state: "graded",
    outcome: "succeeded",
    rubricVersion: null,
    evidence: [{ skill_id: "java.loops", dimension: "implementation", outcome: "pass", independence: "hinted", model_version: "rules-v1" }],
    skillStates: [{ skill_id: "java.loops", dimension: "implementation", estimate: 0.25, evidence_count: 1, review_due_at: "2026-10-10T00:00:00Z", scheduler_version: "ladder-v1", model_version: "rules-v1" }],
    xp: [{ event_key: "quest-pass:cart.q1-checkout-totals", delta: 30 }],
  });
  await learning.recordFollowUpAnswers({
    userId: user.id,
    attemptId: graded.attemptId,
    answers: [{ followup_id: "why-multiply-exact", choice: 1, correct: true }],
    evidence: [{ skill_id: "java.integer-arithmetic", dimension: "explanation", outcome: "pass", independence: "hinted", model_version: "rules-v1" }],
    skillStates: [],
  });
  const project = await user.client.from("projects").insert({ user_id: user.id, campaign_id: CAMPAIGN, title: "Shopping cart" }).select("id").single();
  if (project.error) throw project.error;
  const saved = await user.client.rpc("save_project_file", {
    p_project_id: project.data.id, p_path: "shop/Checkout.java", p_expected_revision: 0, p_source: `// ${user.id}\nclass Checkout {}`, p_mutation_id: crypto.randomUUID(),
  });
  if (saved.error) throw saved.error;
  await sql()`insert into public.notes (user_id, content_id, body) values (${user.id}, 'cart.q1-checkout-totals', 'totals are in cents')`;
  await sql()`insert into public.mock_interviews (user_id, kind, duration_minutes, content_version_id, request_key, plan, started_at, ends_at, finished_at, result)
    values (${user.id}, 'coding', 45, ${questId}, ${`mock-${crypto.randomUUID()}`}, '{"clarify": "inputs?"}', '2026-10-01T10:00:00Z', '2026-10-01T10:45:00Z',
            '2026-10-01T10:30:00Z', '{"overall": "mixed"}')`;
  return { projectId: project.data.id };
}

async function counts(user: TestUser) {
  const [row] = await sql()`
    select
      (select count(*)::int from public.sessions where user_id = ${user.id}) as sessions,
      (select count(*)::int from public.session_items i join public.sessions s on s.id = i.session_id where s.user_id = ${user.id}) as session_items,
      (select count(*)::int from public.attempts where user_id = ${user.id}) as attempts,
      (select count(*)::int from public.mastery_evidence where user_id = ${user.id}) as evidence,
      (select count(*)::int from public.user_skill_state where user_id = ${user.id}) as skill_states,
      (select count(*)::int from public.recommendations where user_id = ${user.id}) as recommendations,
      (select coalesce(sum(delta), 0)::int from public.xp_ledger where user_id = ${user.id}) as xp,
      (select count(*)::int from public.hint_requests where user_id = ${user.id}) as hints,
      (select count(*)::int from public.projects where user_id = ${user.id}) as projects,
      (select count(*)::int from public.project_files where user_id = ${user.id}) as files,
      (select count(*)::int from public.notes where user_id = ${user.id}) as notes,
      (select count(*)::int from public.followup_answers where user_id = ${user.id}) as followup_answers,
      (select count(*)::int from public.mock_interviews where user_id = ${user.id}) as mocks`;
  return row;
}

async function resetLearner(user: TestUser): Promise<void> {
  await archiveStore.deleteUserData(user.id);
}

function roundTrip(archive: Archive): Archive {
  return JSON.parse(JSON.stringify(archive)) as Archive;
}

beforeAll(async () => {
  await syncContent(sql(), loadContent(CONTENT));
  [alice, bob] = [await createTestUser("archive-alice"), await createTestUser("archive-bob")];
  archiveStore = new SupabaseArchiveStore(serviceClient());
  learning = new SupabaseLearningStore(serviceClient());
  archives = new ArchiveService({ store: archiveStore, signingKey: KEY, limits: DEFAULT_EXECUTION_LIMITS, logger: silentLogger });
  const [row] = await sql()`select id from public.content_versions where content_id = 'cart.q1-checkout-totals' order by version desc limit 1`;
  questId = row.id;
});

beforeEach(async () => {
  await Promise.all([resetLearner(alice), resetLearner(bob)]);
});

afterAll(async () => {
  await Promise.all([alice, bob].filter(Boolean).map(deleteTestUser));
  await closeSql();
});

describe("export and import", () => {
  it("import_signedArchiveAfterDelete_restoresProgressAndProjects", async () => {
    await seedLearner(alice);
    const before = await counts(alice);
    const archive = roundTrip(await archives.exportArchive(alice.id));
    await archives.deleteAllData(alice.id, DELETE_CONFIRMATION_PHRASE);

    await archives.importArchive(alice.id, archive);

    expect([before, await counts(alice)]).toEqual([
      { sessions: 1, session_items: 1, attempts: 1, evidence: 2, skill_states: 1, recommendations: 1, xp: 30, hints: 1, projects: 1, files: 1, notes: 1, followup_answers: 1, mocks: 1 },
      before,
    ]);
  });

  it("import_signedArchive_restoresSkillStateAndTimestampsExactly", async () => {
    await seedLearner(alice);
    const archive = roundTrip(await archives.exportArchive(alice.id));
    await archives.deleteAllData(alice.id, DELETE_CONFIRMATION_PHRASE);

    await archives.importArchive(alice.id, archive);

    const again = roundTrip(await archives.exportArchive(alice.id));
    expect({ states: again.data.skill_states, attempts: again.data.attempts, xp: again.data.xp_events }).toEqual({
      states: archive.data.skill_states,
      attempts: archive.data.attempts,
      xp: archive.data.xp_events,
    });
  });

  it("import_signedArchiveWithARunningMock_restoresProgressButNotTheRunningMock", async () => {
    await seedLearner(alice);
    await sql()`update public.mock_interviews set finished_at = null, result = null where user_id = ${alice.id}`;
    const archive = roundTrip(await archives.exportArchive(alice.id));
    await archives.deleteAllData(alice.id, DELETE_CONFIRMATION_PHRASE);

    const result = await archives.importArchive(alice.id, archive);

    expect([result.signature, (await counts(alice)).attempts, (await counts(alice)).mocks]).toEqual(["valid", 1, 0]);
  });

  it("import_sameArchiveTwice_changesNothingTheSecondTime", async () => {
    await seedLearner(alice);
    const archive = roundTrip(await archives.exportArchive(alice.id));
    await archives.importArchive(alice.id, archive);
    const before = await counts(alice);

    const result = await archives.importArchive(alice.id, archive);

    expect([await counts(alice), Object.values(result.report).every((entry) => entry.imported === 0)]).toEqual([before, true]);
  });

  it("import_unsignedArchive_restoresProjectsAndNotesButNoProgress", async () => {
    await seedLearner(alice);
    const archive = { ...roundTrip(await archives.exportArchive(alice.id)), signature: null };
    await archives.deleteAllData(alice.id, DELETE_CONFIRMATION_PHRASE);

    await archives.importArchive(alice.id, archive);

    const after = await counts(alice);
    expect({ xp: after.xp, attempts: after.attempts, sessions: after.sessions, mocks: after.mocks, projects: after.projects, files: after.files, notes: after.notes })
      .toEqual({ xp: 0, attempts: 0, sessions: 0, mocks: 0, projects: 1, files: 1, notes: 1 });
  });

  it("import_editedXp_restoresNoProgress", async () => {
    await seedLearner(alice);
    const archive = roundTrip(await archives.exportArchive(alice.id));
    archive.data.xp_events[0].delta = 1000;
    await archives.deleteAllData(alice.id, DELETE_CONFIRMATION_PHRASE);

    const result = await archives.importArchive(alice.id, archive);

    expect([result.signature, (await counts(alice)).xp]).toEqual(["invalid", 0]);
  });

  it("import_aliceArchiveIntoBob_givesBobACopyAndLeavesAliceUntouched", async () => {
    await seedLearner(alice);
    const aliceBefore = await counts(alice);
    const archive = roundTrip(await archives.exportArchive(alice.id));

    await archives.importArchive(bob.id, archive);

    expect([await counts(bob), await counts(alice)]).toEqual([aliceBefore, aliceBefore]);
  });

  it("import_intoAccountWithItsOwnCampaignProject_mergesNewFilesAndKeepsExistingOnes", async () => {
    await seedLearner(alice);
    const archive = roundTrip(await archives.exportArchive(alice.id));
    archive.data.project_files.push({ ...archive.data.project_files[0], path: "shop/Cart.java", source: "class Cart {}" });
    const { projectId: bobProject } = await seedLearner(bob);

    await archives.importArchive(bob.id, { ...archive, signature: null });

    const files = await sql()`select path, source from public.project_files where project_id = ${bobProject} order by path`;
    expect(files.map((file) => [file.path, file.source.startsWith(`// ${bob.id}`) || file.source === "class Cart {}"])).toEqual([
      ["shop/Cart.java", true],
      ["shop/Checkout.java", true],
    ]);
  });

  it("import_unsignedArchiveNamingBobsProject_cannotTouchBobsProject", async () => {
    const { projectId: bobProject } = await seedLearner(bob);
    const bobFilesBefore = await sql()`select path, source, user_id from public.project_files where project_id = ${bobProject}`;
    const archive = roundTrip(await archives.exportArchive(alice.id));
    archive.data.projects = [{ id: bobProject, content_id: null, campaign_id: null, title: "hijack", created_at: archive.exportedAt, updated_at: archive.exportedAt }];
    archive.data.project_files = [{ project_id: bobProject, path: "shop/Evil.java", revision: 1, source: "class Evil {}", updated_at: archive.exportedAt }];

    const result = await archives.importArchive(alice.id, { ...archive, signature: null });

    const bobFilesAfter = await sql()`select path, source, user_id from public.project_files where project_id = ${bobProject}`;
    expect([bobFilesAfter, result.report.project_files]).toEqual([bobFilesBefore, { imported: 0, skipped: 1 }]);
  });

  it("import_signedArchiveNamingBobsAttempt_cannotAttachEvidenceToIt", async () => {
    await seedLearner(bob);
    const [bobAttempt] = await sql()`select id from public.attempts where user_id = ${bob.id}`;
    await seedLearner(alice);
    // Alice's own signed archive, rewritten as if her evidence pointed at Bob's attempt: the
    // signature fails, so no progress is imported at all.
    const archive = roundTrip(await archives.exportArchive(alice.id));
    archive.data.mastery_evidence[0].attempt_id = bobAttempt.id;
    await archives.deleteAllData(alice.id, DELETE_CONFIRMATION_PHRASE);

    await archives.importArchive(alice.id, archive);

    // Bob's own two rows (code + follow-up answer), nothing of Alice's.
    const [row] = await sql()`select count(*)::int as n from public.mastery_evidence where attempt_id = ${bobAttempt.id}`;
    expect(row.n).toBe(2);
  });

  it("importUserData_childRowsForSomeoneElsesParents_areSkippedEvenWhenTrusted", async () => {
    await seedLearner(bob);
    const [bobAttempt] = await sql()`select id from public.attempts where user_id = ${bob.id}`;
    const [bobSession] = await sql()`select id from public.sessions where user_id = ${bob.id}`;
    const archive = roundTrip(await archives.exportArchive(alice.id));
    const t = archive.exportedAt;
    const data = {
      ...archive.data,
      session_items: [{ id: crypto.randomUUID(), session_id: bobSession.id, content_id: "cart.q1-checkout-totals", content_version: 1, ordinal: 9, state: "pending" as const, estimated_minutes: 5 }],
      mastery_evidence: [{ id: crypto.randomUUID(), attempt_id: bobAttempt.id, skill_id: "java.loops", dimension: "implementation" as const, outcome: "pass" as const, independence: "independent" as const, model_version: "x", created_at: t }],
      reflections: [{ id: crypto.randomUUID(), attempt_id: bobAttempt.id, body: {}, created_at: t }],
    };

    const report = await archiveStore.importUserData(alice.id, data, true);

    expect([report.session_items, report.mastery_evidence, report.reflections]).toEqual([
      { imported: 0, skipped: 1 }, { imported: 0, skipped: 1 }, { imported: 0, skipped: 1 },
    ]);
  });

  it("importUserData_contentThisDatabaseLacks_throwsMissingReferencesAndWritesNothing", async () => {
    await seedLearner(alice);
    const archive = roundTrip(await archives.exportArchive(alice.id));
    await archives.deleteAllData(alice.id, DELETE_CONFIRMATION_PHRASE);
    archive.data.attempts[0].content_version = 999;

    const error = await archiveStore.importUserData(alice.id, archive.data, true).catch((caught: unknown) => caught);

    expect([error instanceof MissingReferencesError && error.references, (await counts(alice)).projects]).toEqual([
      ["content cart.q1-checkout-totals@v999"],
      0,
    ]);
  });
});

describe("delete", () => {
  it("deleteUserData_removesEverythingButTheAccount_andLeavesOthersAlone", async () => {
    await seedLearner(alice);
    await seedLearner(bob);
    const bobBefore = await counts(bob);

    await archives.deleteAllData(alice.id, DELETE_CONFIRMATION_PHRASE);

    const [profile] = await sql()`select count(*)::int as n from public.profiles where user_id = ${alice.id}`;
    expect([Object.values(await counts(alice)).every((n) => n === 0), profile.n, await counts(bob)]).toEqual([true, 1, bobBefore]);
  });

  it("deleteUserData_scrubsExecutionOutputButKeepsQuotaAccounting", async () => {
    const job = await newJob(alice);
    await sql()`update public.execution_jobs set limited_logs = 'secret output', settled_cpu_seconds = 2 where id = ${job}`;

    await archives.deleteAllData(alice.id, DELETE_CONFIRMATION_PHRASE);

    const [row] = await sql()`select limited_logs, settled_cpu_seconds::float as cpu from public.execution_jobs where id = ${job}`;
    expect(row).toEqual({ limited_logs: null, cpu: 2 });
  });
});

describe("project ZIP", () => {
  it("getProject_ownProject_returnsItsFiles", async () => {
    const { projectId } = await seedLearner(alice);

    const project = await archiveStore.getProject(alice.id, projectId);

    expect(project?.files.map((file) => file.path)).toEqual(["shop/Checkout.java"]);
  });

  it("getProject_someoneElsesProject_isUndefined", async () => {
    const { projectId } = await seedLearner(bob);

    expect(await archiveStore.getProject(alice.id, projectId)).toBeUndefined();
  });
});

describe("authorization", () => {
  it.each([
    ["export_user_data", () => ({ p_user_id: bob.id })],
    ["import_user_data", () => ({ p_user_id: alice.id, p_data: {}, p_include_progress: true })],
    ["delete_user_data", () => ({ p_user_id: bob.id })],
  ])("%s_calledByASignedInLearner_isDenied", async (fn, args) => {
    const result = await alice.client.rpc(fn, args());

    expect(result.error?.code).toBe("42501");
  });
});
