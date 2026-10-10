import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadContent } from "@/lib/content/repository";
import { syncContent } from "@/lib/content/sync";
import { SupabaseExerciseStore } from "@/lib/server/exercise-store";
import { SupabaseLearningStore } from "@/lib/server/learning-store";
import { SkillTreeService } from "@/lib/server/skill-tree-service";
import { SupabaseSkillTreeStore } from "@/lib/server/skill-tree-store";
import { closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

const CONTENT = join(import.meta.dirname, "..", "..", "content");
let alice: TestUser;
let store: SupabaseSkillTreeStore;
let service: SkillTreeService;

beforeAll(async () => {
  await syncContent(sql(), loadContent(CONTENT));
  alice = await createTestUser("tree-alice");
  await sql()`update public.profiles set settings = jsonb_set(settings, '{show_unreviewed_content}', 'true') where user_id = ${alice.id}`;
  store = new SupabaseSkillTreeStore(serviceClient());
  service = new SkillTreeService({ store, learning: new SupabaseLearningStore(serviceClient()), exercises: new SupabaseExerciseStore(serviceClient()) });
});

afterAll(async () => {
  if (alice) await deleteTestUser(alice);
  await closeSql();
});

describe("skill tree", () => {
  it("sync_loadsAllElevenWorldsAndAssignsEverySkillOne", async () => {
    const worlds = await store.worlds();
    const synced = new Set(loadContent(CONTENT).skills?.skills.map((skill) => skill.id));
    const skills = (await store.skills()).filter((skill) => synced.has(skill.id));

    expect([worlds.length, worlds[0].name, skills.length, skills.every((skill) => skill.worldId !== null)]).toEqual([11, "Base Camp", synced.size, true]);
  });

  it("practice_summarisesEvidencePerSkillDimension", async () => {
    const [attempt] = await sql()`
      insert into public.attempts (user_id, content_version_id, response, hint_level, active_seconds, state, outcome, graded_at)
      select ${alice.id}, id, '{}', 0, 1, 'graded', 'succeeded', now() from public.content_versions where content_id = 'java.maps-and-counting' limit 1
      returning id`;
    await sql()`insert into public.mastery_evidence (user_id, attempt_id, skill_id, dimension, outcome, independence, model_version)
                values (${alice.id}, ${attempt.id}, 'bigo.loops', 'complexity', 'pass', 'independent', 'rules-v1')`;

    const practice = await store.practice(alice.id);

    expect(practice.map((entry) => [entry.skillId, entry.dimension, entry.evidenceCount])).toEqual([["bigo.loops", "complexity", 1]]);
  });

  it("skillPractice_asSignedInLearner_isDenied", async () => {
    const { error } = await alice.client.rpc("skill_practice", { p_user_id: alice.id });

    expect(error?.code).toBe("42501");
  });

  it("worlds_areReadableBySignedInLearners", async () => {
    const { data } = await alice.client.from("worlds").select("id");

    expect(data?.length).toBe(11);
  });

  it("tree_recommendsQuestsAndPracticeSetsForASkill", async () => {
    const found = await service.skill(alice.id, "java.collections");

    expect([found?.world.name, found?.skill.recommended.map((task) => task.kind)]).toEqual(["Java Awakening", expect.arrayContaining(["quest", "practice"])]);
  });

  it("tree_strictAndRecommendedPrerequisitesAreKeptApart", async () => {
    const found = await service.skill(alice.id, "patterns.sliding-window");

    expect(found?.skill.prerequisites).toEqual([
      { id: "bigo.loops", name: "Loop analysis", kind: "strict" },
      { id: "java.collections", name: "Collections", kind: "recommended" },
    ]);
  });

  it("listCampaigns_comeInWorldOrderWithTheirKind", async () => {
    const real = new Set(loadContent(CONTENT).campaigns?.campaigns.map((campaign) => campaign.id));
    const campaigns = (await new SupabaseLearningStore(serviceClient()).listCampaigns()).filter((campaign) => real.has(campaign.id));

    expect(campaigns.map((campaign) => [campaign.id, campaign.kind, campaign.worldNumber])).toEqual([
      ["campaign.shopping-cart", "project", 1],
      ["problems.data-structures", "problems", 3],
      ["problems.patterns", "problems", 4],
      ["problems.debug-dungeon", "problems", 6],
    ]);
  });

  it("campaigns_areReadableBySignedInLearners", async () => {
    const { data } = await alice.client.from("campaigns").select("id");

    expect(data?.map((row) => row.id)).toEqual(expect.arrayContaining(["campaign.shopping-cart", "problems.data-structures", "problems.patterns"]));
  });

  it("skill_unknownId_isUndefined", async () => {
    expect(await service.skill(alice.id, "java.nothing")).toBeUndefined();
  });
});
