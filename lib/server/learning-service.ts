import "server-only";
import { z } from "zod";
import type { RejectionReason } from "@/lib/execution/budget";
import { visibleSamples } from "@/lib/execution/contract";
import type { ExecutionResult } from "@/lib/execution/java-executor";
import type { ExecutionLimits } from "@/lib/execution/limits";
import type { MeteredExecuteOptions, MeteredExecution } from "@/lib/execution/metered-executor";
import { validateSourceFiles, type SourceFile, type ValidatedSourceSet } from "@/lib/execution/source-files";
import { DuplicateJobError } from "@/lib/execution/usage-ledger";
import {
  evidenceFor,
  independenceFor,
  masteryState,
  MASTERY_MODEL_VERSION,
  SCHEDULER_VERSION,
  updateSkillState,
  type SkillState,
} from "@/lib/learning/mastery";
import { BUDGET_CHOICES, planSession, type BudgetMinutes, type SessionPlan } from "@/lib/learning/session-planner";
import { xpAwardsFor } from "@/lib/learning/xp";
import type { Logger } from "@/lib/observability/log";
import { ApiError } from "./http";
import type { ClientExecutionResult, JobState, LearningStore, QuestRecord } from "./learning-store";

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

export class LearningService {
  private readonly store: LearningStore;
  private readonly executor: MeteredExecutor;
  private readonly limits: LearningServiceDeps["limits"];
  private readonly clock: () => Date;

  constructor(deps: LearningServiceDeps) {
    this.store = deps.store;
    this.executor = deps.executor;
    this.limits = deps.limits;
    this.clock = deps.clock ?? (() => new Date());
  }

  async createSession(userId: string, request: z.infer<typeof createSessionSchema>): Promise<{ sessionId: string; plan: SessionPlan }> {
    const now = this.clock();
    const [quests, completed, states] = await Promise.all([this.store.listVisibleQuests(userId), this.store.completedContentIds(userId), this.store.skillStates(userId)]);
    const plan = planSession(
      request.budgetMinutes,
      quests.map((quest) => ({
        contentVersionId: quest.contentVersionId,
        contentId: quest.contentId,
        title: quest.title,
        campaignOrder: quest.campaign.order,
        estimatedMinutes: quest.estimatedMinutes,
        completed: completed.has(quest.contentId),
        skills: quest.skills.map((tag) => tag.skill),
      })),
      states.map((state) => ({ skillId: state.skillId, dueAt: state.reviewDueAt, reason: "spaced_review" })),
      now,
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

  async getQuest(userId: string, contentVersionId: string): Promise<QuestRecord & { hintsUsed: number; hintsAvailable: number; samples: string[] }> {
    const quest = await this.requireQuest(userId, contentVersionId);
    const [grading, hintsUsed] = await Promise.all([this.store.getGrading(contentVersionId), this.store.hintLevel(userId, contentVersionId)]);
    return { ...quest, hintsUsed, hintsAvailable: grading.hints.length, samples: grading.contract.cases.filter((testCase) => testCase.visible).map((testCase) => testCase.id) };
  }

  /** Next curated hint tier (spec §15/§70): recorded so success counts as assisted, never as an XP penalty. */
  async nextHint(userId: string, contentVersionId: string): Promise<{ tier: number; label: string; text: string; remaining: number }> {
    await this.requireQuest(userId, contentVersionId);
    const grading = await this.store.getGrading(contentVersionId);
    const tier = await this.store.recordHint(userId, contentVersionId, grading.hints.length);
    const hint = grading.hints[tier - 1];
    return { tier, label: hint.tier, text: hint.text, remaining: grading.hints.length - tier };
  }

  async execute(userId: string, request: ExecuteRequest, requestId: string, log: Logger, signal?: AbortSignal): Promise<{ jobId: string; result: ClientExecutionResult; awardedXp: number; skills: Array<{ skillId: string; dimension: string; state: string; reviewInDays: number }> }> {
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

    const result = toClientResult(request.mode, execution.result);
    await this.store.updateJob(request.jobId, {
      state: OUTCOME_TO_STATE[execution.result.outcome],
      outcomeDetail: execution.result.detail,
      limitedLogs: execution.result.testOutput ?? execution.result.compileOutput ?? "",
      result,
    });
    log.log("info", "learning.executed", { mode: request.mode, outcome: execution.result.outcome, contentId: quest.contentId });

    if (request.mode === "run" || execution.result.outcome === "cancelled") return { jobId: request.jobId, result, awardedXp: 0, skills: [] };
    return { jobId: request.jobId, result, ...(await this.recordSubmission(userId, request, quest, execution.result)) };
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
    const [quests, completed, states, xp] = await Promise.all([
      this.store.listVisibleQuests(userId),
      this.store.completedContentIds(userId),
      this.store.skillStates(userId),
      this.store.xpTotal(userId),
    ]);
    return {
      xp,
      campaign: quests
        .sort((a, b) => a.campaign.order - b.campaign.order)
        .map((quest) => ({ contentVersionId: quest.contentVersionId, contentId: quest.contentId, title: quest.title, order: quest.campaign.order, status: quest.status, completed: completed.has(quest.contentId) })),
      skills: states.map((state) => ({ ...state, reviewDueAt: state.reviewDueAt.toISOString(), state: masteryState(state, now) })),
    };
  }

  private async requireQuest(userId: string, contentVersionId: string): Promise<QuestRecord> {
    const quest = await this.store.getVisibleQuest(userId, contentVersionId);
    if (quest === undefined) throw new ApiError(404, "not_found", "That quest doesn't exist or isn't available to you.");
    return quest;
  }

  private async recordSubmission(userId: string, request: ExecuteRequest, quest: QuestRecord, result: ExecutionResult) {
    const now = this.clock();
    const hintLevel = await this.store.hintLevel(userId, request.contentVersionId);
    const independence = independenceFor(hintLevel);
    const evidence = evidenceFor(result.outcome, quest.skills, independence);
    const previous = new Map<string, SkillState>((await this.store.skillStates(userId)).map((state) => [`${state.skillId}:${state.dimension}`, state]));
    const updates = evidence.map((row) => {
      const key = `${row.skillId}:${row.dimension}`;
      const update = updateSkillState(previous.get(key), row, now);
      previous.set(key, update as SkillState);
      return update;
    });
    const xp = xpAwardsFor(quest.contentId, result.outcome, independence);

    await this.store.recordGradedAttempt({
      userId,
      executionJobId: request.jobId,
      contentVersionId: request.contentVersionId,
      sessionItemId: request.sessionItemId ?? null,
      response: { files: request.files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content) })) },
      hintLevel,
      activeSeconds: request.activeSeconds,
      state: result.outcome === "infrastructure-error" ? "infrastructure_error" : "graded",
      outcome: result.outcome,
      rubricVersion: null,
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
      // Upper bound: an award already in the ledger is skipped by the database.
      awardedXp: xp.reduce((sum, award) => sum + award.delta, 0),
      skills: updates.map((update) => ({ skillId: update.skillId, dimension: update.dimension, state: masteryState(update, now), reviewInDays: update.intervalDays })),
    };
  }
}

function toClientResult(mode: "run" | "submit", result: ExecutionResult): ClientExecutionResult {
  return {
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
