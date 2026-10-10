import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadContent } from "@/lib/content/repository";
import { syncContent } from "@/lib/content/sync";
import { SupabaseDashboardStore } from "@/lib/server/dashboard-service";
import { SupabaseLearningStore, type GradedAttemptInput } from "@/lib/server/learning-store";
import { closeSql, createTestUser, deleteTestUser, serviceClient, sql, type TestUser } from "./support/local-supabase";

const CONTENT = join(import.meta.dirname, "..", "..", "content");
let user: TestUser;
let questId: string;

async function submit(outcome: string, hintLevel: number, activeSeconds: number): Promise<void> {
  const jobId = crypto.randomUUID();
  await sql()`insert into public.execution_jobs (id, user_id, reserved_cpu_seconds) values (${jobId}, ${user.id}, 60)`;
  const input: GradedAttemptInput = {
    userId: user.id, executionJobId: jobId, contentVersionId: questId, sessionItemId: null, response: { files: [] }, hintLevel, activeSeconds,
    state: "graded", outcome, rubricVersion: null,
    evidence: [{ skill_id: "java.loops", dimension: "implementation", outcome: outcome === "succeeded" ? "pass" : "fail", independence: hintLevel > 0 ? "hinted" : "independent", model_version: "rules-v1" }],
    skillStates: [], xp: [],
  };
  await new SupabaseLearningStore(serviceClient()).recordGradedAttempt(input);
}

beforeAll(async () => {
  await syncContent(sql(), loadContent(CONTENT));
  user = await createTestUser("dashboard");
  const [row] = await sql()`select id from public.content_versions where content_id = 'cart.q1-checkout-totals' order by version desc limit 1`;
  questId = row.id;
});

afterAll(async () => {
  if (user) await deleteTestUser(user);
  await closeSql();
});

describe("learning_dashboard", () => {
  it("stats_countFirstAttemptsIndependentSolvesAndMedianTime", async () => {
    await submit("wrong-answer", 0, 100);
    await submit("succeeded", 1, 300);
    await submit("succeeded", 0, 500);

    const stats = await new SupabaseDashboardStore(serviceClient()).stats(user.id);

    expect(stats).toMatchObject({
      problems_attempted: 1,
      problems_solved: 1,
      independent_solves: 1,
      first_attempt_passes: 0,
      median_solve_seconds: 400,
      solve_time_sample: 2,
      evidence_by_dimension: { implementation: { total: 3, passed: 2 } },
    });
    expect([stats.recent_evidence.length, stats.solved_content_ids]).toEqual([3, ["cart.q1-checkout-totals"]]);
  });

  it("stats_asSignedInLearner_isDenied", async () => {
    const { error } = await user.client.rpc("learning_dashboard", { p_user_id: user.id });

    expect(error?.code).toBe("42501");
  });
});
