import { describe, expect, it } from "vitest";
import { contractDefinitionSchema } from "@/lib/execution/contract";
import type { ExecutionResult } from "@/lib/execution/java-executor";
import type { MeteredExecuteOptions, MeteredExecution } from "@/lib/execution/metered-executor";
import { DuplicateJobError } from "@/lib/execution/usage-ledger";
import type { SkillState } from "@/lib/learning/mastery";
import { silentLogger } from "@/lib/observability/log";
import { ApiError } from "@/lib/server/http";
import type { ActiveSession, GradedAttemptInput, JobState, LearningStore, QuestGrading, QuestRecord } from "@/lib/server/learning-store";
import { LearningService, type ExecuteRequest, type MeteredExecutor } from "@/lib/server/learning-service";

const USER = "11111111-1111-4111-8111-111111111111";
const QUEST_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-07T12:00:00Z");

const QUEST: QuestRecord = {
  contentVersionId: QUEST_ID,
  contentId: "cart.q1-checkout-totals",
  version: 1,
  status: "draft",
  title: "Checkout totals",
  summary: "s",
  campaign: { id: "campaign.shopping-cart", order: 1 },
  stage: "completion",
  estimatedMinutes: 15,
  skills: [{ skill: "java.loops", dimension: "implementation" }],
  instructions: "i",
  starter: [],
  starterCompiles: true,
};

const GRADING: QuestGrading = {
  contract: contractDefinitionSchema.parse({
    version: 1,
    cases: [
      { id: "sample", visible: true, steps: [{ call: "f", static: "shop.Checkout", paramTypes: [], expect: { value: 1 } }] },
      { id: "hidden", steps: [{ call: "g", static: "shop.Checkout", paramTypes: [], expect: { value: 2 } }] },
    ],
  }),
  hints: [{ tier: "direction", text: "Look at the loop." }, { tier: "pattern", text: "Accumulate." }],
};

/** In-memory store that records what the service asked it to persist. */
class FakeStore implements LearningStore {
  quests: QuestRecord[] = [QUEST];
  hints = 0;
  states: SkillState[] = [];
  jobUpdates: Array<{ jobId: string; state: JobState }> = [];
  attempts: GradedAttemptInput[] = [];

  async listVisibleQuests() { return this.quests; }
  async getVisibleQuest(_user: string, id: string) { return this.quests.find((quest) => quest.contentVersionId === id); }
  async getGrading() { return GRADING; }
  async completedContentIds() { return new Set<string>(); }
  async skillStates() { return this.states; }
  async xpTotal() { return 0; }
  async hintLevel() { return this.hints; }
  async recordHint(_u: string, _c: string, maxTier: number) { this.hints = Math.min(maxTier, this.hints + 1); return this.hints; }
  async createSession() { return "session-1"; }
  async recordRecommendation() {}
  async getSession() { return undefined; }
  async updateJob(jobId: string, patch: { state: JobState }) { this.jobUpdates.push({ jobId, state: patch.state }); }
  async getJob() { return undefined; }
  /** Event keys already in the ledger; like the database, an earned key is never awarded again. */
  earnedXp = new Set<string>();
  sessionCompletes = false;
  active: ActiveSession | undefined;
  activeSince: Date | undefined;
  async recordGradedAttempt(input: GradedAttemptInput) {
    this.attempts.push(input);
    const fresh = input.xp.filter((award) => !this.earnedXp.has(award.event_key));
    for (const award of fresh) this.earnedXp.add(award.event_key);
    return { attemptId: "attempt-1", awardedXp: fresh.reduce((sum, award) => sum + award.delta, 0), sessionCompleted: this.sessionCompletes };
  }
  async activeSession(_user: string, startedAfter: Date) { this.activeSince = startedAfter; return this.active; }
}

function result(outcome: ExecutionResult["outcome"] = "succeeded"): ExecutionResult {
  return { outcome, detail: "d", stage: "report", timingsMs: { total: 10 } };
}

/** Executor that records the options it was called with and returns a scripted execution. */
class ScriptedExecutor implements MeteredExecutor {
  calls: MeteredExecuteOptions[] = [];
  constructor(private readonly next: MeteredExecution | Error = { admitted: true, result: result() }) {}
  async execute(_sources: unknown, options: MeteredExecuteOptions): Promise<MeteredExecution> {
    this.calls.push(options);
    if (this.next instanceof Error) throw this.next;
    if (this.next.admitted) await options.onAdmitted?.();
    return this.next;
  }
}

function service(store = new FakeStore(), executor: MeteredExecutor = new ScriptedExecutor()) {
  return new LearningService({ store, executor, limits: { maxSourceFiles: 20, maxTotalSourceBytes: 200_000 }, clock: () => NOW });
}

function request(overrides: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    jobId: crypto.randomUUID(),
    contentVersionId: QUEST_ID,
    mode: "submit",
    files: [{ path: "shop/Checkout.java", content: "class Checkout {}" }],
    activeSeconds: 60,
    ...overrides,
  };
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected an ApiError");
}

describe("LearningService.execute", () => {
  it("execute_questNotVisible_is404WithoutRunningAnything", async () => {
    const executor = new ScriptedExecutor();

    const error = await apiError(service(new FakeStore(), executor).execute(USER, request({ contentVersionId: crypto.randomUUID() }), "r", silentLogger));

    expect([error.status, executor.calls.length]).toEqual([404, 0]);
  });

  it("execute_pathTraversalInFiles_is400", async () => {
    const error = await apiError(service().execute(USER, request({ files: [{ path: "../Escape.java", content: "x" }] }), "r", silentLogger));

    expect([error.status, error.code]).toEqual([400, "invalid_sources"]);
  });

  it("execute_budgetExhausted_is429WithRetryAfter", async () => {
    const executor = new ScriptedExecutor({ admitted: false, reason: "daily_job_limit", retryAfter: new Date("2026-10-08T00:00:00Z") });

    const error = await apiError(service(new FakeStore(), executor).execute(USER, request(), "r", silentLogger));

    expect([error.status, error.code, error.headers?.["retry-after"]]).toEqual([429, "daily_job_limit", "Thu, 08 Oct 2026 00:00:00 GMT"]);
  });

  it("execute_providerQuotaPaused_is503", async () => {
    const executor = new ScriptedExecutor({ admitted: false, reason: "provider_quota_paused" });

    expect((await apiError(service(new FakeStore(), executor).execute(USER, request(), "r", silentLogger))).status).toBe(503);
  });

  it("execute_replayedJobId_is409DuplicateJob", async () => {
    const error = await apiError(service(new FakeStore(), new ScriptedExecutor(new DuplicateJobError("j"))).execute(USER, request(), "r", silentLogger));

    expect([error.status, error.code]).toEqual([409, "duplicate_job"]);
  });

  it("execute_infrastructureErrorOnSubmit_recordsNoEvidenceAndNoXp", async () => {
    const store = new FakeStore();

    await service(store, new ScriptedExecutor({ admitted: true, result: result("infrastructure-error") })).execute(USER, request(), "r", silentLogger);

    expect(store.attempts[0]).toMatchObject({ state: "infrastructure_error", evidence: [], skillStates: [], xp: [] });
  });

  it("execute_hintedSuccess_countsAsHintedWithoutBonusOrPenalty", async () => {
    const store = new FakeStore();
    store.hints = 1;

    const response = await service(store).execute(USER, request(), "r", silentLogger);

    expect(store.attempts[0].evidence[0].independence).toBe("hinted");
    expect([store.attempts[0].xp.map((award) => award.event_key), response.awardedXp]).toEqual([["quest-pass:cart.q1-checkout-totals"], 30]);
  });

  it("execute_failedSubmit_recordsFailureEvidenceAndNextDayReview", async () => {
    const store = new FakeStore();

    const response = await service(store, new ScriptedExecutor({ admitted: true, result: result("wrong-answer") })).execute(USER, request(), "r", silentLogger);

    expect([store.attempts[0].evidence[0].outcome, response.skills[0].reviewInDays, store.attempts[0].xp]).toEqual(["fail", 1, []]);
  });

  it("execute_run_gradesOnlyVisibleSamplesAndRecordsNoAttempt", async () => {
    const store = new FakeStore();
    const executor = new ScriptedExecutor();

    await service(store, executor).execute(USER, request({ mode: "run" }), "r", silentLogger);

    const grading = executor.calls[0].grading;
    expect([grading?.kind === "contract" && grading.contract.cases.map((testCase) => testCase.id), store.attempts.length]).toEqual([["sample"], 0]);
  });

  it("execute_admitted_persistsProvisioningBeforeTheFinalState", async () => {
    const store = new FakeStore();
    const job = request();

    await service(store).execute(USER, job, "r", silentLogger);

    expect(store.jobUpdates).toEqual([
      { jobId: job.jobId, state: "provisioning" },
      { jobId: job.jobId, state: "succeeded" },
    ]);
  });

  it("execute_independentSuccess_awardsChallengeAndBonusUnderEventKeys", async () => {
    const store = new FakeStore();

    await service(store).execute(USER, request(), "r", silentLogger);

    expect(store.attempts[0].xp.map((award) => award.event_key)).toEqual(["quest-pass:cart.q1-checkout-totals", "quest-independent:cart.q1-checkout-totals"]);
  });
});

describe("LearningService.execute reporting", () => {
  it("execute_passAlreadyRewarded_reportsZeroXp", async () => {
    const store = new FakeStore();
    store.earnedXp = new Set(["quest-pass:cart.q1-checkout-totals", "quest-independent:cart.q1-checkout-totals"]);

    const response = await service(store).execute(USER, request(), "r", silentLogger);

    expect(response.awardedXp).toBe(0);
  });

  it("execute_independentPassAfterHintedPass_reportsOnlyTheNewBonus", async () => {
    const store = new FakeStore();
    store.earnedXp = new Set(["quest-pass:cart.q1-checkout-totals"]);

    const response = await service(store).execute(USER, request(), "r", silentLogger);

    expect(response.awardedXp).toBe(20);
  });

  it("execute_lastSessionItemPassed_reportsSessionCompleted", async () => {
    const store = new FakeStore();
    store.sessionCompletes = true;

    const response = await service(store).execute(USER, request({ sessionItemId: crypto.randomUUID() }), "r", silentLogger);

    expect(response.sessionCompleted).toBe(true);
  });

  it("execute_run_neverCompletesASession", async () => {
    const store = new FakeStore();
    store.sessionCompletes = true;

    const response = await service(store).execute(USER, request({ mode: "run", sessionItemId: crypto.randomUUID() }), "r", silentLogger);

    expect([response.sessionCompleted, store.attempts.length]).toEqual([false, 0]);
  });
});

describe("LearningService.activeSession", () => {
  it("activeSession_asksForSessionsFromTheLast24Hours", async () => {
    const store = new FakeStore();

    await service(store).activeSession(USER);

    expect(store.activeSince).toEqual(new Date("2026-10-06T12:00:00Z"));
  });

  it("activeSession_noOpenSession_isUndefined", async () => {
    expect(await service().activeSession(USER)).toBeUndefined();
  });
});

describe("LearningService.nextHint", () => {
  it("nextHint_escalatesOneTierAtATimeAndStopsAtTheLast", async () => {
    const store = new FakeStore();
    const learning = service(store);

    const tiers = [await learning.nextHint(USER, QUEST_ID), await learning.nextHint(USER, QUEST_ID), await learning.nextHint(USER, QUEST_ID)];

    expect(tiers.map((hint) => [hint.tier, hint.label, hint.remaining])).toEqual([[1, "direction", 1], [2, "pattern", 0], [2, "pattern", 0]]);
  });

  it("nextHint_questNotVisible_is404", async () => {
    expect((await apiError(service().nextHint(USER, crypto.randomUUID()))).status).toBe(404);
  });
});

describe("LearningService.createSession", () => {
  it("createSession_noVisibleContent_returnsEmptyPlanWithReason", async () => {
    const store = new FakeStore();
    store.quests = [];

    const { plan } = await service(store).createSession(USER, { budgetMinutes: 15, clientRequestKey: "key-12345" });

    expect(plan).toMatchObject({ items: [], emptyReason: "no_content" });
  });
});
