import "server-only";
import { z } from "zod";
import type { RejectionReason } from "@/lib/execution/budget";
import { visibleSamples } from "@/lib/execution/contract";
import type { ExecutionResult } from "@/lib/execution/java-executor";
import type { ExecutionLimits } from "@/lib/execution/limits";
import type { MeteredExecuteOptions, MeteredExecution } from "@/lib/execution/metered-executor";
import { validateSourceFiles, type SourceFile, type ValidatedSourceSet } from "@/lib/execution/source-files";
import { testingOutcome, type TestQualitySpec } from "@/lib/execution/test-quality";
import { DuplicateJobError } from "@/lib/execution/usage-ledger";
import { DIAGNOSTIC_WORLD } from "@/lib/exercises/diagnostic";
import { computeRubric, dimensionForCriterion, RUBRIC_VERSION, type RubricResult } from "@/lib/grading/rubric";
import { deriveInsights, INSIGHT_MAX_SUBMISSIONS, INSIGHT_WINDOW_DAYS, strugglingSkills, type Insight, type QuestRef, type SubmissionSummary } from "@/lib/learning/insights";
import {
  evidenceFor,
  independenceFor,
  masteryState,
  MASTERY_MODEL_VERSION,
  SCHEDULER_VERSION,
  updateSkillState,
  type EvidenceOutcome,
  type SkillState,
} from "@/lib/learning/mastery";
import { BUDGET_CHOICES, planSession, type BudgetMinutes, type PracticeCandidate, type SessionPlan } from "@/lib/learning/session-planner";
import { xpAwardsFor } from "@/lib/learning/xp";
import type { Logger } from "@/lib/observability/log";
import type { ExerciseStore } from "./exercise-store";
import { ApiError } from "./http";
import {
  FollowUpsAlreadyAnsweredError,
  type ClientExecutionResult,
  type FollowUpContext,
  type FollowUpQuestion,
  type JobState,
  type LearningStore,
  type QuestGrading,
  type QuestRecord,
} from "./learning-store";
import type { SkillTreeStore } from "./skill-tree-store";

/**
 * The learning loop's server logic (spec §5, §15, §21–22, §36, §67, §70). All persistence goes
 * through LearningStore; all execution through the metered executor; every rule is a pure
 * function in lib/learning.
 */

export interface MeteredExecutor {
  execute(sources: ValidatedSourceSet, options: MeteredExecuteOptions): Promise<MeteredExecution>;
}

export interface LearningServiceDeps {
  readonly store: LearningStore;
  /** Practice sets for session planning and practice-item completion; omit for quests only. */
  readonly practice?: Pick<ExerciseStore, "listVisibleSets" | "passedQuestions" | "skillsOf" | "answeredSince"> & Pick<SkillTreeStore, "worlds">;
  readonly executor: MeteredExecutor;
  readonly limits: Pick<ExecutionLimits, "maxSourceFiles" | "maxTotalSourceBytes">;
  readonly clock?: () => Date;
}

export const executeRequestSchema = z.object({
  /** Client-generated id; repeating it returns the original job (idempotency, spec §67). */
  jobId: z.uuid(),
  contentVersionId: z.uuid(),
  mode: z.enum(["run", "submit"]),
  files: z.array(z.object({ path: z.string().max(200), content: z.string() })).max(50),
  sessionItemId: z.uuid().optional(),
  /** Client-measured active time; idle time excluded (spec §61). Clamped. */
  activeSeconds: z.number().int().min(0).max(4 * 3600).default(0),
});
export type ExecuteRequest = z.infer<typeof executeRequestSchema>;

export const answerFollowUpsSchema = z.object({
  jobId: z.uuid(),
  /** Follow-up id → chosen option index. Every question is answered at once. */
  answers: z.record(z.string().max(60), z.number().int().min(0).max(9)),
});

export interface FollowUpOutcome {
  readonly results: ReadonlyArray<{ readonly id: string; readonly choice: number; readonly correct: boolean; readonly answer: number; readonly why: string }>;
  readonly rubric: RubricResult;
}

export const createSessionSchema = z.object({
  budgetMinutes: z.union(BUDGET_CHOICES.map((choice) => z.literal(choice)) as [z.ZodLiteral<5>, ...z.ZodLiteral<BudgetMinutes>[]]),
  clientRequestKey: z.string().min(8).max(100),
});

const OUTCOME_TO_STATE: Record<string, JobState> = {
  succeeded: "succeeded",
  "wrong-answer": "wrong_answer",
  "compile-error": "compile_error",
  "runtime-error": "runtime_error",
  timeout: "timeout",
  cancelled: "cancelled",
  "infrastructure-error": "infrastructure_error",
};

const REJECTION_STATUS: Record<RejectionReason, { status: number; message: string }> = {
  concurrent_job_limit: { status: 409, message: "Your previous run is still going. Wait for it to finish." },
  daily_job_limit: { status: 429, message: "You've reached today's run limit. Your code is saved; runs resume tomorrow." },
  monthly_job_limit: { status: 429, message: "This month's run limit is reached. Your code is saved." },
  monthly_cpu_budget: { status: 429, message: "This month's code-execution budget is nearly used up, so new runs are paused. Your code is saved." },
  provider_quota_paused: { status: 503, message: "Code execution is paused because the free hosting quota ran out. Your code is saved." },
};

/** A session can be resumed from home for this long after it started. */
const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

export class LearningService {
  private readonly store: LearningStore;
  private readonly practice: LearningServiceDeps["practice"];
  private readonly executor: MeteredExecutor;
  private readonly limits: LearningServiceDeps["limits"];
  private readonly clock: () => Date;

  constructor(deps: LearningServiceDeps) {
    this.store = deps.store;
    this.practice = deps.practice;
    this.executor = deps.executor;
    this.limits = deps.limits;
    this.clock = deps.clock ?? (() => new Date());
  }

  async createSession(userId: string, request: z.infer<typeof createSessionSchema>): Promise<{ sessionId: string; plan: SessionPlan }> {
    const now = this.clock();
    const [quests, completed, states, insights, campaigns] = await Promise.all([
      this.store.listVisibleQuests(userId),
      this.store.completedContentIds(userId),
      this.store.skillStates(userId),
      this.insights(userId),
      this.store.listCampaigns(),
    ]);
    const rank = new Map(campaigns.map((campaign) => [campaign.id, campaign.worldNumber]));
    const plan = planSession(
      request.budgetMinutes,
      quests.map((quest) => ({
        contentVersionId: quest.contentVersionId,
        contentId: quest.contentId,
        title: quest.title,
        campaignOrder: quest.campaign.order,
        // An unknown campaign (content synced without it) sorts last rather than first.
        trackRank: rank.get(quest.campaign.id) ?? Number.MAX_SAFE_INTEGER,
        estimatedMinutes: quest.estimatedMinutes,
        completed: completed.has(quest.contentId),
        skills: quest.skills.map((tag) => tag.skill),
      })),
      states.map((state) => ({ skillId: state.skillId, dueAt: state.reviewDueAt, reason: "spaced_review" })),
      now,
      strugglingSkills(insights),
      await this.practiceCandidates(userId),
    );
    const sessionId = await this.store.createSession(
      userId,
      request.budgetMinutes,
      request.clientRequestKey,
      plan.policyVersion,
      plan.items.map((item) => ({ contentVersionId: item.contentVersionId, estimatedMinutes: Math.min(90, item.estimatedMinutes) })),
    );
    const reasonCodes = [...new Set(plan.items.flatMap((item) => item.reasons.map((reason) => reason.code)))];
    if (reasonCodes.length > 0) await this.store.recordRecommendation(userId, sessionId, reasonCodes, plan.policyVersion);
    return { sessionId, plan };
  }

  async getQuest(
    userId: string,
    contentVersionId: string,
  ): Promise<QuestRecord & { hintsUsed: number; hintsAvailable: number; usedHints: Array<{ tier: number; label: string; text: string }>; samples: string[] }> {
    const quest = await this.requireQuest(userId, contentVersionId);
    const [grading, hintsUsed] = await Promise.all([this.store.getGrading(contentVersionId), this.store.hintLevel(userId, contentVersionId)]);
    return {
      ...quest,
      hintsUsed,
      hintsAvailable: grading.hints.length,
      // Hints the learner already revealed stay visible after a reload.
      usedHints: grading.hints.slice(0, hintsUsed).map((hint, index) => ({ tier: index + 1, label: hint.tier, text: hint.text })),
      samples: grading.contract.cases.filter((testCase) => testCase.visible).map((testCase) => testCase.id),
    };
  }

  /** Next curated hint tier (spec §15/§70): recorded so success counts as assisted, never as an XP penalty. */
  async nextHint(userId: string, contentVersionId: string): Promise<{ tier: number; label: string; text: string; remaining: number }> {
    await this.requireQuest(userId, contentVersionId);
    const grading = await this.store.getGrading(contentVersionId);
    const tier = await this.store.recordHint(userId, contentVersionId, grading.hints.length);
    const hint = grading.hints[tier - 1];
    return { tier, label: hint.tier, text: hint.text, remaining: grading.hints.length - tier };
  }

  async execute(userId: string, request: ExecuteRequest, requestId: string, log: Logger, signal?: AbortSignal): Promise<{ jobId: string; result: ClientExecutionResult; awardedXp: number; sessionCompleted: boolean; skills: Array<{ skillId: string; dimension: string; state: string; reviewInDays: number }> }> {
    const quest = await this.requireQuest(userId, request.contentVersionId);
    const validated = validateSourceFiles(request.files as SourceFile[], this.limits);
    if (!validated.ok) throw new ApiError(400, "invalid_sources", "Some files can't be run.", validated.issues);

    const grading = await this.store.getGrading(request.contentVersionId);
    const contract = request.mode === "run" ? visibleSamples(grading.contract) : grading.contract;
    if (contract === undefined) throw new ApiError(409, "no_samples", "This quest has no runnable samples; use Submit.");

    let execution: MeteredExecution;
    try {
      execution = await this.executor.execute(validated.files, {
        requestId,
        jobId: request.jobId,
        userId,
        grading: { kind: "contract", contract },
        // Run shows the learner's own tests; Submit grades how well they catch bugs.
        runLearnerTests: request.mode === "run",
        testQuality: request.mode === "submit" ? grading.testQuality : undefined,
        signal,
        onAdmitted: () => this.store.updateJob(request.jobId, { state: "provisioning", gradingMode: "contract" }),
      });
    } catch (error) {
      if (error instanceof DuplicateJobError) throw new ApiError(409, "duplicate_job", "This run was already submitted.", { jobId: request.jobId });
      throw error;
    }
    if (!execution.admitted) {
      const rejection = REJECTION_STATUS[execution.reason];
      throw new ApiError(rejection.status, execution.reason, rejection.message, undefined, execution.retryAfter ? { "retry-after": execution.retryAfter.toUTCString() } : undefined);
    }

    const result = toClientResult(request.mode, execution.result, grading);
    await this.store.updateJob(request.jobId, {
      state: OUTCOME_TO_STATE[execution.result.outcome],
      outcomeDetail: execution.result.detail,
      limitedLogs: execution.result.testOutput ?? execution.result.compileOutput ?? "",
      result,
    });
    log.log("info", "learning.executed", { mode: request.mode, outcome: execution.result.outcome, contentId: quest.contentId });

    if (request.mode === "run" || execution.result.outcome === "cancelled") return { jobId: request.jobId, result, awardedXp: 0, sessionCompleted: false, skills: [] };
    return { jobId: request.jobId, result, ...(await this.recordSubmission(userId, request, quest, execution.result, grading.testQuality)) };
  }

  /**
   * Grades the follow-up questions of a passed submission (spec §14, §43, §46): deterministic,
   * against the canonical answers. The first set of answers counts; asking again returns them.
   * Each answer is evidence for its skill's explanation/complexity dimension.
   */
  async answerFollowUps(userId: string, request: z.infer<typeof answerFollowUpsSchema>): Promise<FollowUpOutcome> {
    const context = await this.store.followUpContext(userId, request.jobId);
    if (context === undefined || context.result === null) throw new ApiError(404, "not_found", "There's no graded submission with follow-up questions.");
    const grading = await this.store.getGrading(context.contentVersionId);
    const questions = grading.rubric?.followUps ?? [];
    if (questions.length === 0 || context.result.outcome !== "succeeded") throw new ApiError(409, "no_follow_ups", "This submission has no follow-up questions.");

    let answered = context.answered;
    if (answered.size === 0) {
      const ids = Object.keys(request.answers);
      if (ids.length !== questions.length || questions.some((question) => request.answers[question.id] === undefined)) {
        throw new ApiError(400, "answer_every_question", "Answer every question before checking.");
      }
      const invalid = questions.find((question) => request.answers[question.id] >= question.options.length);
      if (invalid) throw new ApiError(400, "invalid_choice", `That isn't one of the options for "${invalid.prompt}".`);
      answered = await this.recordFollowUps(userId, request.jobId, context, questions, request.answers);
    }

    const correct = new Map([...answered].map(([id, answer]) => [id, answer.correct]));
    const rubric = rubricFor(context.result.cases ?? [], grading, correct);
    await this.store.updateJobRubric(userId, request.jobId, rubric);
    return {
      results: questions.map((question) => {
        const answer = answered.get(question.id);
        return { id: question.id, choice: answer?.choice ?? -1, correct: answer?.correct ?? false, answer: question.answer, why: question.why };
      }),
      rubric,
    };
  }

  private async recordFollowUps(
    userId: string,
    jobId: string,
    context: FollowUpContext,
    questions: readonly FollowUpQuestion[],
    choices: Record<string, number>,
  ): Promise<ReadonlyMap<string, { choice: number; correct: boolean }>> {
    const now = this.clock();
    const independence = independenceFor(context.hintLevel);
    const answers = questions.map((question) => ({ followup_id: question.id, choice: choices[question.id], correct: choices[question.id] === question.answer }));
    // mastery_evidence holds one row per (attempt, skill, dimension): answers about the same skill
    // dimension (e.g. time and space complexity) combine into one row.
    const evidence = [...groupBy(questions.map((question, index) => ({ question, correct: answers[index].correct })), ({ question }) => `${question.skill}:${dimensionForCriterion(question.criterion)}`).values()].map((group) => ({
      skillId: group[0].question.skill,
      dimension: dimensionForCriterion(group[0].question.criterion),
      outcome: combinedOutcome(group.map((entry) => entry.correct)),
      independence,
      modelVersion: MASTERY_MODEL_VERSION,
    }));
    const previous = new Map<string, SkillState>((await this.store.skillStates(userId)).map((state) => [`${state.skillId}:${state.dimension}`, state]));
    const finalStates = evidence.map((row) => updateSkillState(previous.get(`${row.skillId}:${row.dimension}`), row, now));
    try {
      await this.store.recordFollowUpAnswers({
        userId,
        attemptId: context.attemptId,
        answers,
        evidence: evidence.map((row) => ({ skill_id: row.skillId, dimension: row.dimension, outcome: row.outcome, independence: row.independence, model_version: row.modelVersion })),
        skillStates: finalStates.map((update) => ({
          skill_id: update.skillId,
          dimension: update.dimension,
          estimate: update.estimate,
          evidence_count: update.evidenceCount,
          review_due_at: update.reviewDueAt.toISOString(),
          scheduler_version: SCHEDULER_VERSION,
          model_version: MASTERY_MODEL_VERSION,
        })),
      });
    } catch (error) {
      if (!(error instanceof FollowUpsAlreadyAnsweredError)) throw error;
      // A concurrent request answered first; its answers are the ones that count.
      return (await this.store.followUpContext(userId, jobId))?.answered ?? new Map();
    }
    return new Map(answers.map((answer) => [answer.followup_id, { choice: answer.choice, correct: answer.correct }]));
  }

  /**
   * Patterns in the learner's recent work (spec §61), with sample sizes and a suggested next
   * step. Submissions for quests that aren't visible any more are left out.
   */
  async insights(userId: string): Promise<Insight[]> {
    const now = this.clock();
    const since = new Date(now.getTime() - INSIGHT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [quests, completed, submissions, skillNames] = await Promise.all([
      this.store.listVisibleQuests(userId),
      this.store.completedContentIds(userId),
      this.store.recentSubmissions(userId, since, INSIGHT_MAX_SUBMISSIONS),
      this.store.skillNames(),
    ]);
    const byVersion = new Map(quests.map((quest) => [quest.contentVersionId, quest]));
    const relevant = submissions.filter((submission) => byVersion.has(submission.contentVersionId));
    const gradings = new Map(
      await Promise.all([...new Set(relevant.map((submission) => submission.contentVersionId))].map(async (id) => [id, await this.store.getGrading(id)] as const)),
    );
    const summaries: SubmissionSummary[] = relevant.map((submission) => {
      const quest = byVersion.get(submission.contentVersionId) as QuestRecord;
      return {
        attemptId: submission.attemptId,
        contentVersionId: submission.contentVersionId,
        contentId: quest.contentId,
        createdAt: submission.createdAt,
        outcome: submission.outcome,
        hintLevel: submission.hintLevel,
        passedCaseIds: submission.cases.filter((testCase) => testCase.passed).map((testCase) => testCase.id),
        failedCaseIds: submission.cases.filter((testCase) => !testCase.passed).map((testCase) => testCase.id),
        edgeCaseIds: gradings.get(submission.contentVersionId)?.rubric?.edgeCases ?? [],
        skills: [...new Set(quest.skills.map((tag) => tag.skill))],
      };
    });
    const refs: QuestRef[] = quests.map((quest) => ({
      contentVersionId: quest.contentVersionId,
      contentId: quest.contentId,
      title: quest.title,
      order: quest.campaign.order,
      completed: completed.has(quest.contentId),
      skills: [...new Set(quest.skills.map((tag) => tag.skill))],
      gradesTests: quest.skills.some((tag) => tag.dimension === "testing"),
    }));
    return deriveInsights(summaries, refs, skillNames, now);
  }

  /**
   * Completes a practice-set session item once every question in the set has been answered
   * since the session started (spec §5). Quest items complete when a submission passes.
   */
  async completePracticeItem(userId: string, sessionId: string, itemId: string): Promise<{ sessionCompleted: boolean }> {
    const session = await this.store.getSession(userId, sessionId);
    const item = session?.items.find((candidate) => candidate.id === itemId);
    if (session === undefined || item === undefined) throw new ApiError(404, "not_found", "No such session item.");
    if (item.kind !== "practice" || this.practice === undefined) throw new ApiError(409, "not_practice", "Only practice items are completed this way.");
    if (item.state === "completed") return { sessionCompleted: session.state === "completed" };
    const set = (await this.practice.listVisibleSets(userId)).find((candidate) => candidate.contentVersionId === item.contentVersionId);
    if (set === undefined) throw new ApiError(404, "not_found", "That practice set isn't available to you.");
    const answered = await this.practice.answeredSince(userId, item.contentVersionId, new Date(session.startedAt));
    const missing = set.questions.filter((question) => !answered.has(question.id)).length;
    if (missing > 0) throw new ApiError(409, "unanswered_questions", `Answer the remaining ${missing} question${missing === 1 ? "" : "s"} to finish this item.`);
    return { sessionCompleted: (await this.store.completeSessionItem(userId, itemId)).sessionCompleted };
  }

  private async practiceCandidates(userId: string): Promise<PracticeCandidate[]> {
    if (this.practice === undefined) return [];
    const sets = (await this.practice.listVisibleSets(userId)).filter((set) => set.world.id !== DIAGNOSTIC_WORLD);
    const [passed, skills, worlds] = await Promise.all([
      this.practice.passedQuestions(userId),
      this.practice.skillsOf(sets.map((set) => set.contentVersionId)),
      this.practice.worlds(),
    ]);
    const numbers = new Map(worlds.map((world) => [world.id, world.number]));
    // A set in a world the database doesn't know sorts last rather than failing the plan.
    const worldNumber = (id: string) => numbers.get(id) ?? Number.MAX_SAFE_INTEGER;
    return sets.map((set) => ({
      contentVersionId: set.contentVersionId,
      title: set.title,
      estimatedMinutes: set.estimatedMinutes,
      worldNumber: worldNumber(set.world.id),
      worldOrder: set.world.order,
      skills: skills.get(set.contentVersionId) ?? [],
      passedShare: set.questions.length === 0 ? 1 : (passed.get(set.contentVersionId)?.size ?? 0) / set.questions.length,
    }));
  }

  /** The session to offer "resume" for on the home screen, if any. */
  async activeSession(userId: string) {
    return this.store.activeSession(userId, new Date(this.clock().getTime() - RESUME_WINDOW_MS));
  }

  async getSession(userId: string, sessionId: string) {
    return this.store.getSession(userId, sessionId);
  }

  async getJob(userId: string, jobId: string) {
    const job = await this.store.getJob(userId, jobId);
    if (job === undefined) throw new ApiError(404, "not_found", "No such run.");
    return job;
  }

  async getProgress(userId: string) {
    const now = this.clock();
    const [quests, completed, states, xp, campaigns] = await Promise.all([
      this.store.listVisibleQuests(userId),
      this.store.completedContentIds(userId),
      this.store.skillStates(userId),
      this.store.xpTotal(userId),
      this.store.listCampaigns(),
    ]);
    const views = quests
      .sort((a, b) => a.campaign.order - b.campaign.order)
      .map((quest) => ({
        contentVersionId: quest.contentVersionId,
        contentId: quest.contentId,
        campaignId: quest.campaign.id,
        title: quest.title,
        order: quest.campaign.order,
        status: quest.status,
        completed: completed.has(quest.contentId),
      }));
    return {
      xp,
      /** Every visible quest, across campaigns. */
      campaign: views,
      /** Quests grouped by campaign, in world order; campaigns without visible quests are left out. */
      campaigns: campaigns
        .map((campaign) => ({ id: campaign.id, title: campaign.title, summary: campaign.summary, kind: campaign.kind, quests: views.filter((quest) => quest.campaignId === campaign.id) }))
        .filter((campaign) => campaign.quests.length > 0),
      skills: states.map((state) => ({ ...state, reviewDueAt: state.reviewDueAt.toISOString(), state: masteryState(state, now) })),
    };
  }

  /** A quest's campaign (title and kind), for opening its project. */
  async campaignOf(campaignId: string) {
    return (await this.store.listCampaigns()).find((campaign) => campaign.id === campaignId);
  }


  private async requireQuest(userId: string, contentVersionId: string): Promise<QuestRecord> {
    const quest = await this.store.getVisibleQuest(userId, contentVersionId);
    if (quest === undefined) throw new ApiError(404, "not_found", "That quest doesn't exist or isn't available to you.");
    return quest;
  }

  private async recordSubmission(userId: string, request: ExecuteRequest, quest: QuestRecord, result: ExecutionResult, quality: TestQualitySpec | undefined) {
    const now = this.clock();
    const hintLevel = await this.store.hintLevel(userId, request.contentVersionId);
    const independence = independenceFor(hintLevel);
    const testing = quality === undefined ? undefined : { outcome: result.testQuality === undefined ? undefined : testingOutcome(result.testQuality, quality.passRatio) };
    const evidence = evidenceFor(result.outcome, quest.skills, independence, testing);
    const previous = new Map<string, SkillState>((await this.store.skillStates(userId)).map((state) => [`${state.skillId}:${state.dimension}`, state]));
    const updates = evidence.map((row) => {
      const key = `${row.skillId}:${row.dimension}`;
      const update = updateSkillState(previous.get(key), row, now);
      previous.set(key, update as SkillState);
      return update;
    });
    const xp = xpAwardsFor(quest.contentId, result.outcome, independence, testing?.outcome === "pass");

    const recorded = await this.store.recordGradedAttempt({
      userId,
      executionJobId: request.jobId,
      contentVersionId: request.contentVersionId,
      sessionItemId: request.sessionItemId ?? null,
      // Immutable snapshot of exactly what was graded (spec §62, §67); bounded by the source limits.
      response: { files: request.files.map((file) => ({ path: file.path, content: file.content })) },
      hintLevel,
      activeSeconds: request.activeSeconds,
      state: result.outcome === "infrastructure-error" ? "infrastructure_error" : "graded",
      outcome: result.outcome,
      rubricVersion: result.outcome === "infrastructure-error" ? null : RUBRIC_VERSION,
      evidence: evidence.map((row) => ({ skill_id: row.skillId, dimension: row.dimension, outcome: row.outcome, independence: row.independence, model_version: row.modelVersion })),
      skillStates: updates.map((update) => ({
        skill_id: update.skillId,
        dimension: update.dimension,
        estimate: update.estimate,
        evidence_count: update.evidenceCount,
        review_due_at: update.reviewDueAt.toISOString(),
        scheduler_version: SCHEDULER_VERSION,
        model_version: MASTERY_MODEL_VERSION,
      })),
      xp: xp.map((award) => ({ event_key: award.eventKey, delta: award.delta })),
    });

    return {
      awardedXp: recorded.awardedXp,
      sessionCompleted: recorded.sessionCompleted,
      skills: updates.map((update) => ({ skillId: update.skillId, dimension: update.dimension, state: masteryState(update, now), reviewInDays: update.intervalDays })),
    };
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/** All right → pass, none → fail, some → partial. */
function combinedOutcome(correct: readonly boolean[]): EvidenceOutcome {
  const right = correct.filter(Boolean).length;
  if (right === correct.length) return "pass";
  return right === 0 ? "fail" : "partial";
}

/** Rubric for a graded submission; undefined for Run and for outcomes that aren't a grade. */
function submissionRubric(mode: "run" | "submit", result: ExecutionResult, grading: QuestGrading, answers?: ReadonlyMap<string, boolean>): RubricResult | undefined {
  if (mode === "run" || result.outcome === "infrastructure-error" || result.outcome === "cancelled") return undefined;
  return rubricFor(result.caseResults ?? [], grading, answers);
}

function rubricFor(cases: ReadonlyArray<{ id: string; passed: boolean }>, grading: QuestGrading, answers?: ReadonlyMap<string, boolean>): RubricResult {
  return computeRubric({
    cases,
    totalChecks: grading.contract.cases.length,
    edgeCaseIds: grading.rubric?.edgeCases ?? [],
    followUps: grading.rubric?.followUps ?? [],
    answers,
  });
}

function toClientResult(mode: "run" | "submit", result: ExecutionResult, grading: QuestGrading): ClientExecutionResult {
  const quality = grading.testQuality;
  const describe = (id: string) => ({ id, description: quality?.mutants.find((mutant) => mutant.id === id)?.description ?? id });
  const rubric = submissionRubric(mode, result, grading);
  const followUps = mode === "submit" && result.outcome === "succeeded" ? (grading.rubric?.followUps ?? []) : [];
  return {
    ...(rubric && { rubric }),
    // The questions only: answers and explanations stay on the server until answered.
    ...(followUps.length > 0 && { followUps: followUps.map((question) => ({ id: question.id, criterion: question.criterion, prompt: question.prompt, options: question.options })) }),
    ...(result.learnerTests && {
      learnerTests: {
        outcome: result.learnerTests.outcome,
        detail: result.learnerTests.detail,
        tests: result.learnerTests.summary?.tests,
        failedTests: result.learnerTests.summary?.failedTests,
        output: result.learnerTests.output,
      },
    }),
    ...(result.testQuality && {
      testQuality: {
        status: result.testQuality.status,
        caught: result.testQuality.caught.map(describe),
        missed: result.testQuality.missed,
        total: result.testQuality.total,
        failingOnReference: result.testQuality.failingOnReference,
      },
    }),
    mode,
    outcome: result.outcome,
    detail: result.detail,
    summary: result.summary ? { tests: result.summary.tests, failures: result.summary.failures, errors: result.summary.errors } : undefined,
    cases: result.caseResults,
    compileOutput: result.compileOutput,
    testOutput: result.testOutput,
    totalMs: result.timingsMs.total,
  };
}
