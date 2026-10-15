import { describe, expect, it } from "vitest";
import { contractDefinitionSchema } from "@/lib/execution/contract";
import type { ExecutionResult } from "@/lib/execution/java-executor";
import type { MeteredExecuteOptions, MeteredExecution } from "@/lib/execution/metered-executor";
import { DuplicateJobError } from "@/lib/execution/usage-ledger";
import type { SkillState } from "@/lib/learning/mastery";
import { silentLogger } from "@/lib/observability/log";
import { ApiError } from "@/lib/server/http";
import type { RubricResult } from "@/lib/grading/rubric";
import { FollowUpsAlreadyAnsweredError, type FollowUpAnswersInput, type FollowUpContext, type RecentSubmission } from "@/lib/server/learning-store";
import type { ActiveSession, GradedAttemptInput, SessionView, JobState, LearningStore, QuestGrading, QuestRecord } from "@/lib/server/learning-store";
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
  createSession: LearningStore["createSession"] = async () => "session-1";
  async recordRecommendation() {}
  async getSession() { return this.session; }
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
  followUps: FollowUpContext | undefined;
  recordedFollowUps: FollowUpAnswersInput[] = [];
  rubrics: RubricResult[] = [];
  /** Simulates another request answering between our read and our write. */
  answeredConcurrently: FollowUpContext["answered"] | undefined;
  async followUpContext() { return this.followUps; }
  async recordFollowUpAnswers(input: FollowUpAnswersInput) {
    if (this.answeredConcurrently && this.followUps) {
      this.followUps = { ...this.followUps, answered: this.answeredConcurrently };
      throw new FollowUpsAlreadyAnsweredError();
    }
    this.recordedFollowUps.push(input);
  }
  async updateJobRubric(_u: string, _j: string, rubric: RubricResult) { this.rubrics.push(rubric); }
  submissions: RecentSubmission[] = [];
  submissionsSince: Date | undefined;
  async recentSubmissions(_u: string, since: Date) { this.submissionsSince = since; return this.submissions; }
  async skillNames() { return new Map([["java.loops", "Loops"]]); }
  listCampaigns: LearningStore["listCampaigns"] = async () => [{ id: "campaign.shopping-cart", title: "Shopping cart", summary: "Cart.", kind: "project", worldNumber: 1 }];
  session: SessionView | undefined;
  completedItems: string[] = [];
  async completeSessionItem(_u: string, itemId: string) { this.completedItems.push(itemId); return { completed: true, sessionCompleted: true }; }
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

describe("LearningService.execute with test-quality grading", () => {
  const QUALITY = {
    target: "src/main/java/shop/Checkout.java",
    baseline: "// ref",
    passRatio: 0.5,
    mutants: [{ id: "m1", description: "accepts zero", content: "// m1" }, { id: "m2", description: "skips trim", content: "// m2" }],
  };
  const TESTING_QUEST: QuestRecord = { ...QUEST, skills: [{ skill: "java.loops", dimension: "implementation" }, { skill: "java.unit-testing", dimension: "testing" }] };

  function storeWithQuality(): FakeStore {
    const store = new FakeStore();
    store.quests = [TESTING_QUEST];
    store.getGrading = async () => ({ ...GRADING, testQuality: QUALITY });
    return store;
  }

  it("execute_run_asksForTheLearnersOwnTestsButNoTestQuality", async () => {
    const executor = new ScriptedExecutor();

    await service(storeWithQuality(), executor).execute(USER, request({ mode: "run" }), "r", silentLogger);

    expect([executor.calls[0].runLearnerTests, executor.calls[0].testQuality]).toEqual([true, undefined]);
  });

  it("execute_submit_gradesTestQualityAndRecordsTestingEvidenceFromIt", async () => {
    const store = storeWithQuality();
    const executor = new ScriptedExecutor({
      admitted: true,
      result: { ...result(), testQuality: { status: "graded", caught: ["m1"], missed: [{ id: "m2", description: "skips trim" }], total: 2 } },
    });

    const response = await service(store, executor).execute(USER, request(), "r", silentLogger);

    expect(executor.calls[0].testQuality).toEqual(QUALITY);
    expect(store.attempts[0].evidence.map((row) => [row.dimension, row.outcome])).toEqual([["implementation", "pass"], ["testing", "pass"]]);
    expect(response.result.testQuality?.caught).toEqual([{ id: "m1", description: "accepts zero" }]);
  });

  it("execute_submitWithoutLearnerTests_recordsTestingFailButStillPassesTheCode", async () => {
    const store = storeWithQuality();
    const executor = new ScriptedExecutor({ admitted: true, result: { ...result(), testQuality: { status: "no_tests", caught: [], missed: [], total: 2 } } });

    await service(store, executor).execute(USER, request(), "r", silentLogger);

    expect([store.attempts[0].evidence.map((row) => row.outcome), store.attempts[0].xp.some((award) => award.event_key.startsWith("quest-tests:"))]).toEqual([["pass", "fail"], false]);
  });

  it("execute_testsCaughtEnoughBugs_awardsTheTestQualityXp", async () => {
    const store = storeWithQuality();
    const executor = new ScriptedExecutor({ admitted: true, result: { ...result(), testQuality: { status: "graded", caught: ["m1", "m2"], missed: [], total: 2 } } });

    await service(store, executor).execute(USER, request(), "r", silentLogger);

    expect(store.attempts[0].xp.map((award) => award.event_key)).toContain("quest-tests:cart.q1-checkout-totals");
  });
});

describe("LearningService rubric and follow-ups", () => {
  const FOLLOW_UPS = [
    { id: "why", criterion: "explanation" as const, skill: "java.loops", prompt: "Why loop?", options: ["a", "b", "c"], answer: 1, why: "Because." },
    { id: "time", criterion: "time_complexity" as const, skill: "java.loops", prompt: "How fast?", options: ["O(1)", "O(n)"], answer: 1, why: "One pass." },
  ];
  const JOB = "44444444-4444-4444-8444-444444444444";
  const PASSED_RESULT = { mode: "submit" as const, outcome: "succeeded", detail: "d", cases: [{ id: "sample", visible: true, passed: true }, { id: "hidden", visible: false, passed: true }] };

  function storeWithRubric(context?: Partial<FollowUpContext>): FakeStore {
    const store = new FakeStore();
    store.getGrading = async () => ({ ...GRADING, rubric: { edgeCases: ["hidden"], followUps: FOLLOW_UPS } });
    store.followUps = { attemptId: "attempt-1", contentVersionId: QUEST_ID, hintLevel: 0, result: PASSED_RESULT, answered: new Map(), ...context };
    return store;
  }

  it("execute_passedSubmit_returnsRubricAndQuestionsWithoutAnswers", async () => {
    const store = storeWithRubric();
    const executor = new ScriptedExecutor({ admitted: true, result: { ...result(), caseResults: [{ id: "sample", visible: true, passed: true }, { id: "hidden", visible: false, passed: true }] } });

    const response = await service(store, executor).execute(USER, request(), "r", silentLogger);

    expect([response.result.rubric?.score, response.result.followUps?.map((question) => question.id), JSON.stringify(response.result.followUps).includes("Because")]).toEqual([100, ["why", "time"], false]);
  });

  it("execute_failedSubmit_hasARubricButNoQuestions", async () => {
    const store = storeWithRubric();
    const executor = new ScriptedExecutor({ admitted: true, result: { ...result("wrong-answer"), caseResults: [{ id: "hidden", visible: false, passed: false }] } });

    const response = await service(store, executor).execute(USER, request(), "r", silentLogger);

    expect([response.result.rubric?.score, response.result.followUps]).toEqual([0, undefined]);
  });

  it("execute_run_hasNoRubric", async () => {
    const response = await service(storeWithRubric()).execute(USER, request({ mode: "run" }), "r", silentLogger);

    expect(response.result.rubric).toBeUndefined();
  });

  it("execute_submit_recordsTheRubricVersionOnTheAttempt", async () => {
    const store = storeWithRubric();

    await service(store).execute(USER, request(), "r", silentLogger);

    expect(store.attempts[0].rubricVersion).toBe("rubric-v1");
  });

  it("answerFollowUps_firstAnswers_areGradedAndRecordedAsExplanationAndComplexityEvidence", async () => {
    const store = storeWithRubric();

    const outcome = await service(store).answerFollowUps(USER, { jobId: JOB, answers: { why: 1, time: 0 } });

    expect(outcome.results.map((entry) => [entry.id, entry.correct, entry.why])).toEqual([["why", true, "Because."], ["time", false, "One pass."]]);
    expect(store.recordedFollowUps[0].evidence.map((row) => [row.dimension, row.outcome])).toEqual([["explanation", "pass"], ["complexity", "fail"]]);
    expect(store.rubrics[0].criteria.find((entry) => entry.criterion === "explanation")).toMatchObject({ assessed: true, score: 1 });
  });

  it("answerFollowUps_alreadyAnswered_returnsTheFirstAnswersWithoutRecording", async () => {
    const store = storeWithRubric({ answered: new Map([["why", { choice: 0, correct: false }], ["time", { choice: 1, correct: true }]]) });

    const outcome = await service(store).answerFollowUps(USER, { jobId: JOB, answers: { why: 1, time: 1 } });

    expect([outcome.results.map((entry) => entry.choice), store.recordedFollowUps.length]).toEqual([[0, 1], 0]);
  });

  it("answerFollowUps_concurrentRequestWonTheRace_returnsItsAnswers", async () => {
    const store = storeWithRubric();
    store.answeredConcurrently = new Map([["why", { choice: 2, correct: false }], ["time", { choice: 1, correct: true }]]);

    const outcome = await service(store).answerFollowUps(USER, { jobId: JOB, answers: { why: 1, time: 1 } });

    expect(outcome.results.map((entry) => entry.choice)).toEqual([2, 1]);
  });

  it("answerFollowUps_missingAnAnswer_is400AndRecordsNothing", async () => {
    const store = storeWithRubric();

    const error = await apiError(service(store).answerFollowUps(USER, { jobId: JOB, answers: { why: 1 } }));

    expect([error.status, error.code, store.recordedFollowUps.length]).toEqual([400, "answer_every_question", 0]);
  });

  it("answerFollowUps_choiceOutOfRange_is400", async () => {
    const error = await apiError(service(storeWithRubric()).answerFollowUps(USER, { jobId: JOB, answers: { why: 1, time: 5 } }));

    expect(error.code).toBe("invalid_choice");
  });

  it("answerFollowUps_unknownJob_is404", async () => {
    const store = storeWithRubric();
    store.followUps = undefined;

    expect((await apiError(service(store).answerFollowUps(USER, { jobId: JOB, answers: {} }))).status).toBe(404);
  });

  it("answerFollowUps_failedSubmission_is409", async () => {
    const store = storeWithRubric({ result: { ...PASSED_RESULT, outcome: "wrong-answer" } });

    expect((await apiError(service(store).answerFollowUps(USER, { jobId: JOB, answers: { why: 1, time: 1 } }))).code).toBe("no_follow_ups");
  });

  it("answerFollowUps_twoAnswersForOneSkillDimension_combineIntoOnePartialEvidenceRow", async () => {
    const store = storeWithRubric();
    store.getGrading = async () => ({ ...GRADING, rubric: { edgeCases: [], followUps: [FOLLOW_UPS[1], { ...FOLLOW_UPS[1], id: "space", criterion: "space_complexity" as const }] } });

    await service(store).answerFollowUps(USER, { jobId: JOB, answers: { time: 1, space: 0 } });

    expect([store.recordedFollowUps[0].evidence.map((row) => [row.dimension, row.outcome]), store.recordedFollowUps[0].skillStates.length]).toEqual([[["complexity", "partial"]], 1]);
  });
});

describe("LearningService.insights", () => {
  function miss(index: number, contentVersionId = QUEST_ID): RecentSubmission {
    return {
      attemptId: `a${index}`,
      contentVersionId,
      createdAt: new Date(NOW.getTime() - index * 60_000),
      outcome: "wrong-answer",
      hintLevel: 0,
      cases: [{ id: "sample", passed: true }, { id: "hidden", passed: false }],
    };
  }

  it("insights_edgeCasesComeFromTheQuestsGrading", async () => {
    const store = new FakeStore();
    store.getGrading = async () => ({ ...GRADING, rubric: { edgeCases: ["hidden"], followUps: [] } });
    store.submissions = [miss(1), miss(2), miss(3)];

    const insights = await service(store).insights(USER);

    expect(insights.map((entry) => entry.code)).toContain("edge_cases_missed");
  });

  it("insights_submissionsForQuestsNoLongerVisible_areLeftOut", async () => {
    const store = new FakeStore();
    store.submissions = [miss(1, "gone"), miss(2, "gone"), miss(3, "gone")];

    expect(await service(store).insights(USER)).toEqual([]);
  });

  it("insights_readsTheLast30Days", async () => {
    const store = new FakeStore();

    await service(store).insights(USER);

    expect(store.submissionsSince).toEqual(new Date("2026-09-07T12:00:00Z"));
  });
});

describe("LearningService practice in sessions", () => {
  const SESSION_ID = "55555555-5555-4555-8555-555555555555";
  const ITEM_ID = "66666666-6666-4666-8666-666666666666";
  const SET = {
    kind: "exercise-set" as const,
    contentVersionId: "77777777-7777-4777-8777-777777777777",
    contentId: "java.maps",
    version: 1,
    status: "draft" as const,
    title: "Maps",
    summary: "Maps.",
    world: { id: "world.java-awakening", order: 1 },
    estimatedMinutes: 5,
    questions: [
      { id: "a", type: "true_false" as const, prompt: "True or false?" },
      { id: "b", type: "true_false" as const, prompt: "True or false again?" },
    ],
  };

  function practice(answered: string[] = [], passed = new Map<string, Set<string>>()) {
    return {
      listVisibleSets: async () => [SET],
      passedQuestions: async () => passed,
      skillsOf: async () => new Map([[SET.contentVersionId, ["java.collections"]]]),
      answeredSince: async () => new Set(answered),
      worlds: async () => [{ id: "world.java-awakening", number: 1, name: "Java", summary: "Java.", available: true }],
    };
  }

  function storeWithItem(kind: "practice" | "quest" = "practice"): FakeStore {
    const store = new FakeStore();
    store.session = {
      id: SESSION_ID,
      budgetMinutes: 5,
      state: "active",
      startedAt: "2026-10-07T11:00:00Z",
      reasonCodes: [],
      items: [{ id: ITEM_ID, kind, contentVersionId: SET.contentVersionId, ordinal: 0, state: "pending", estimatedMinutes: 5, title: "Maps" }],
    };
    return store;
  }

  function practiceService(store: FakeStore, deps = practice()) {
    return new LearningService({ store, practice: deps, executor: new ScriptedExecutor(), limits: { maxSourceFiles: 20, maxTotalSourceBytes: 200_000 }, clock: () => NOW });
  }

  it("createSession_fiveMinutes_plansOnlyAPracticeSet", async () => {
    const store = new FakeStore();
    let planned: ReadonlyArray<{ contentVersionId: string }> = [];
    store.createSession = async (_u: string, _b: number, _k: string, _p: string, items: ReadonlyArray<{ contentVersionId: string; estimatedMinutes: number }>) => {
      planned = items;
      return "session-1";
    };

    const { plan } = await practiceService(store).createSession(USER, { budgetMinutes: 5, clientRequestKey: "key-12345678" });

    expect([plan.items.map((item) => item.kind), planned.map((item) => item.contentVersionId)]).toEqual([["practice"], [SET.contentVersionId]]);
  });

  it("createSession_fifteenMinutes_addsPracticeBeforeTheQuest", async () => {
    const { plan } = await practiceService(new FakeStore()).createSession(USER, { budgetMinutes: 15, clientRequestKey: "key-12345678" });

    expect(plan.items.map((item) => item.kind)).toEqual(["practice", "quest"]);
  });

  it("createSession_neverPlansDesignChallengesOrExamsAsPractice", async () => {
    const deps = practice();
    deps.listVisibleSets = async () => [
      { ...SET, contentVersionId: "design-1", design: { scenario: "A scenario long enough.", requirements: ["r"], sections: [{ id: "api", title: "API", guidance: "The API." }], timeMinutes: 35 } },
      { ...SET, contentVersionId: "boss-1", boss: { passShare: 0.7 } },
    ];

    const { plan } = await practiceService(new FakeStore(), deps).createSession(USER, { budgetMinutes: 15, clientRequestKey: "key-12345678" });

    expect(plan.items.map((item) => item.kind)).toEqual(["quest"]);
  });

  it("completePracticeItem_unansweredQuestions_is409AndCompletesNothing", async () => {
    const store = storeWithItem();

    const error = await apiError(practiceService(store, practice(["a"])).completePracticeItem(USER, SESSION_ID, ITEM_ID));

    expect([error.status, error.message, store.completedItems]).toEqual([409, "Answer the remaining 1 question to finish this item.", []]);
  });

  it("completePracticeItem_everyQuestionAnswered_completesTheItem", async () => {
    const store = storeWithItem();

    const result = await practiceService(store, practice(["a", "b"])).completePracticeItem(USER, SESSION_ID, ITEM_ID);

    expect([result.sessionCompleted, store.completedItems]).toEqual([true, [ITEM_ID]]);
  });

  it("completePracticeItem_questItem_is409", async () => {
    expect((await apiError(practiceService(storeWithItem("quest"), practice(["a", "b"])).completePracticeItem(USER, SESSION_ID, ITEM_ID))).code).toBe("not_practice");
  });

  it("completePracticeItem_someoneElsesSession_is404", async () => {
    expect((await apiError(practiceService(new FakeStore()).completePracticeItem(USER, SESSION_ID, ITEM_ID))).status).toBe(404);
  });
});

describe("LearningService.getProgress", () => {
  it("getProgress_groupsQuestsByCampaignAndLeavesOutEmptyCampaigns", async () => {
    const store = new FakeStore();
    store.listCampaigns = async () => [
      { id: "campaign.shopping-cart", title: "Shopping cart", summary: "Cart.", kind: "project" as const, worldNumber: 1 },
      { id: "problems.patterns", title: "Pattern problems", summary: "Problems.", kind: "problems" as const, worldNumber: 4 },
    ];

    const progress = await service(store).getProgress(USER);

    expect(progress.campaigns.map((campaign) => [campaign.id, campaign.quests.map((quest) => quest.contentId)])).toEqual([["campaign.shopping-cart", ["cart.q1-checkout-totals"]]]);
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

  it("nextHint_duringAMockOnThisQuest_is409AndRevealsNothing", async () => {
    const store = new FakeStore();
    const learning = new LearningService({ store, executor: new ScriptedExecutor(), limits: { maxSourceFiles: 20, maxTotalSourceBytes: 200_000 }, clock: () => NOW, hintGuard: { hintsBlocked: async () => true } });

    const error = await apiError(learning.nextHint(USER, QUEST_ID));

    expect([error.status, error.code, store.hints]).toEqual([409, "mock_in_progress", 0]);
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
