import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { contractDefinitionSchema, type CaseResult, type ContractDefinition } from "@/lib/execution/contract";
import { questPayloadSchema, type QuestPayload } from "@/lib/content/payload";
import { hintTierSchema } from "@/lib/content/schema";
import type { SkillDimension, SkillState } from "@/lib/learning/mastery";

/**
 * Persistence for the learning loop. The Supabase implementation uses the server (secret) key,
 * which bypasses RLS — so every method takes the authenticated user id and enforces ownership
 * and content visibility itself. Never pass a browser-supplied user id here.
 */

export type ContentStatus = "draft" | "ai_reviewed" | "human_reviewed" | "published" | "deprecated";

export interface QuestRecord extends QuestPayload {
  readonly contentVersionId: string;
  readonly contentId: string;
  readonly version: number;
  readonly status: ContentStatus;
}

export interface QuestGrading {
  readonly contract: ContractDefinition;
  readonly hints: ReadonlyArray<{ readonly tier: z.infer<typeof hintTierSchema>; readonly text: string }>;
}

export type JobState =
  | "created" | "provisioning" | "compiling" | "running" | "grading"
  | "succeeded" | "wrong_answer" | "compile_error" | "runtime_error" | "timeout" | "cancelled" | "infrastructure_error";

export interface ClientExecutionResult {
  readonly mode: "run" | "submit";
  readonly outcome: string;
  readonly detail: string;
  readonly summary?: { readonly tests: number; readonly failures: number; readonly errors: number };
  readonly cases?: readonly CaseResult[];
  readonly compileOutput?: string;
  readonly testOutput?: string;
  readonly totalMs?: number;
}

export interface JobView {
  readonly id: string;
  readonly state: JobState;
  readonly createdAt: string;
  readonly result: ClientExecutionResult | null;
}

export interface SessionItemView {
  readonly id: string;
  readonly contentVersionId: string;
  readonly ordinal: number;
  readonly state: string;
  readonly estimatedMinutes: number;
  readonly title: string;
}

export interface SessionView {
  readonly id: string;
  readonly budgetMinutes: number;
  readonly state: string;
  readonly startedAt: string;
  readonly items: readonly SessionItemView[];
  readonly reasonCodes: readonly string[];
}

export interface GradedAttemptInput {
  readonly userId: string;
  readonly executionJobId: string;
  readonly contentVersionId: string;
  readonly sessionItemId: string | null;
  readonly response: unknown;
  readonly hintLevel: number;
  readonly activeSeconds: number;
  readonly state: "graded" | "infrastructure_error";
  readonly outcome: string;
  readonly rubricVersion: string | null;
  readonly evidence: ReadonlyArray<{ skill_id: string; dimension: string; outcome: string; independence: string; model_version: string }>;
  readonly skillStates: ReadonlyArray<{ skill_id: string; dimension: string; estimate: number; evidence_count: number; review_due_at: string; scheduler_version: string; model_version: string }>;
  readonly xp: ReadonlyArray<{ event_key: string; delta: number }>;
}

export interface LearningStore {
  listVisibleQuests(userId: string): Promise<QuestRecord[]>;
  getVisibleQuest(userId: string, contentVersionId: string): Promise<QuestRecord | undefined>;
  getGrading(contentVersionId: string): Promise<QuestGrading>;
  completedContentIds(userId: string): Promise<Set<string>>;
  skillStates(userId: string): Promise<SkillState[]>;
  xpTotal(userId: string): Promise<number>;
  hintLevel(userId: string, contentVersionId: string): Promise<number>;
  recordHint(userId: string, contentVersionId: string, maxTier: number): Promise<number>;
  createSession(userId: string, budgetMinutes: number, clientRequestKey: string, policyVersion: string, items: ReadonlyArray<{ contentVersionId: string; estimatedMinutes: number }>): Promise<string>;
  recordRecommendation(userId: string, sessionId: string, reasonCodes: readonly string[], policyVersion: string): Promise<void>;
  getSession(userId: string, sessionId: string): Promise<SessionView | undefined>;
  updateJob(jobId: string, patch: { state: JobState; outcomeDetail?: string; limitedLogs?: string; gradingMode?: "contract" | "junit"; result?: ClientExecutionResult }): Promise<void>;
  getJob(userId: string, jobId: string): Promise<JobView | undefined>;
  recordGradedAttempt(input: GradedAttemptInput): Promise<string>;
}

/** Store failure (database unreachable, unexpected response). Surfaces as a 503, never as a learner outcome. */
export class StoreError extends Error {
  constructor(operation: string, message: string, options?: { cause?: unknown }) {
    super(`${operation}: ${message}`, options);
    this.name = "StoreError";
  }
}

const UNREVIEWED_VISIBLE: readonly ContentStatus[] = ["published", "draft", "ai_reviewed", "human_reviewed"];
const PUBLISHED_ONLY: readonly ContentStatus[] = ["published"];
const MAX_LOG_BYTES = 64 * 1024;

const versionRowSchema = z.object({
  id: z.string(),
  content_id: z.string(),
  version: z.number(),
  status: z.enum(["draft", "ai_reviewed", "human_reviewed", "published", "deprecated"]),
  payload: z.unknown(),
});

function check<T>(operation: string, result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new StoreError(operation, result.error.message, { cause: result.error });
  return result.data;
}

export class SupabaseLearningStore implements LearningStore {
  constructor(private readonly db: SupabaseClient) {}

  private async visibleStatuses(userId: string): Promise<readonly ContentStatus[]> {
    const row = check("profile", await this.db.from("profiles").select("settings").eq("user_id", userId).maybeSingle());
    const settings = (row?.settings ?? {}) as Record<string, unknown>;
    return settings.show_unreviewed_content === true ? UNREVIEWED_VISIBLE : PUBLISHED_ONLY;
  }

  private toQuest(row: z.infer<typeof versionRowSchema>): QuestRecord | undefined {
    const payload = questPayloadSchema.safeParse(row.payload);
    if (!payload.success) return undefined;
    return { ...payload.data, contentVersionId: row.id, contentId: row.content_id, version: row.version, status: row.status };
  }

  async listVisibleQuests(userId: string): Promise<QuestRecord[]> {
    const statuses = await this.visibleStatuses(userId);
    const rows = z.array(versionRowSchema).parse(
      check("list_quests", await this.db.from("content_versions").select("id, content_id, version, status, payload").in("status", [...statuses]).order("version", { ascending: false })),
    );
    // Latest visible version of each item.
    const latest = new Map<string, QuestRecord>();
    for (const row of rows) {
      if (latest.has(row.content_id)) continue;
      const quest = this.toQuest(row);
      if (quest) latest.set(row.content_id, quest);
    }
    return [...latest.values()];
  }

  async getVisibleQuest(userId: string, contentVersionId: string): Promise<QuestRecord | undefined> {
    const statuses = await this.visibleStatuses(userId);
    const row = check("get_quest", await this.db.from("content_versions").select("id, content_id, version, status, payload").eq("id", contentVersionId).in("status", [...statuses]).maybeSingle());
    return row ? this.toQuest(versionRowSchema.parse(row)) : undefined;
  }

  async getGrading(contentVersionId: string): Promise<QuestGrading> {
    const data = check("get_grading", await this.db.rpc("get_content_grading", { p_content_version_id: contentVersionId }));
    return z.object({ contract: contractDefinitionSchema, hints: z.array(z.object({ tier: hintTierSchema, text: z.string() })) }).parse(data);
  }

  async completedContentIds(userId: string): Promise<Set<string>> {
    const rows = check(
      "completed",
      await this.db.from("attempts").select("content_versions(content_id)").eq("user_id", userId).eq("state", "graded").eq("outcome", "succeeded"),
    ) as unknown as Array<{ content_versions: { content_id: string } | null }>;
    return new Set(rows.flatMap((row) => (row.content_versions ? [row.content_versions.content_id] : [])));
  }

  async skillStates(userId: string): Promise<SkillState[]> {
    const rows = check("skill_states", await this.db.from("user_skill_state").select("skill_id, dimension, estimate, evidence_count, review_due_at").eq("user_id", userId)) ?? [];
    return rows.map((row) => ({
      skillId: row.skill_id as string,
      dimension: row.dimension as SkillDimension,
      estimate: Number(row.estimate),
      evidenceCount: Number(row.evidence_count),
      reviewDueAt: new Date(row.review_due_at as string),
    }));
  }

  async xpTotal(userId: string): Promise<number> {
    const rows = check("xp_total", await this.db.from("xp_ledger").select("delta").eq("user_id", userId)) ?? [];
    return rows.reduce((sum, row) => sum + Number(row.delta), 0);
  }

  async hintLevel(userId: string, contentVersionId: string): Promise<number> {
    const rows = check("hint_level", await this.db.from("hint_requests").select("tier").eq("user_id", userId).eq("content_version_id", contentVersionId)) ?? [];
    return rows.reduce((max, row) => Math.max(max, Number(row.tier)), 0);
  }

  async recordHint(userId: string, contentVersionId: string, maxTier: number): Promise<number> {
    return Number(check("record_hint", await this.db.rpc("record_hint_request", { p_user_id: userId, p_content_version_id: contentVersionId, p_max_tier: maxTier })));
  }

  async createSession(userId: string, budgetMinutes: number, clientRequestKey: string, policyVersion: string, items: ReadonlyArray<{ contentVersionId: string; estimatedMinutes: number }>): Promise<string> {
    return String(
      check(
        "create_session",
        await this.db.rpc("create_session", {
          p_user_id: userId,
          p_budget_minutes: budgetMinutes,
          p_client_request_key: clientRequestKey,
          p_policy_version: policyVersion,
          p_items: items.map((item) => ({ content_version_id: item.contentVersionId, estimated_minutes: item.estimatedMinutes })),
        }),
      ),
    );
  }

  async recordRecommendation(userId: string, sessionId: string, reasonCodes: readonly string[], policyVersion: string): Promise<void> {
    check("record_recommendation", await this.db.rpc("record_recommendation", { p_user_id: userId, p_session_id: sessionId, p_reason_codes: [...reasonCodes], p_evidence_ids: [], p_policy_version: policyVersion }));
  }

  async getSession(userId: string, sessionId: string): Promise<SessionView | undefined> {
    const session = check(
      "get_session",
      await this.db.from("sessions").select("id, budget_minutes, state, started_at, session_items(id, content_version_id, ordinal, state, estimated_minutes, content_versions(payload))").eq("id", sessionId).eq("user_id", userId).maybeSingle(),
    ) as unknown as {
      id: string; budget_minutes: number; state: string; started_at: string;
      session_items: Array<{ id: string; content_version_id: string; ordinal: number; state: string; estimated_minutes: number; content_versions: { payload: { title?: string } } | null }>;
    } | null;
    if (session === null) return undefined;
    const recommendations = check("get_recommendations", await this.db.from("recommendations").select("reason_codes").eq("session_id", sessionId).eq("user_id", userId)) ?? [];
    return {
      id: session.id,
      budgetMinutes: session.budget_minutes,
      state: session.state,
      startedAt: session.started_at,
      reasonCodes: recommendations.flatMap((row) => row.reason_codes as string[]),
      items: [...session.session_items]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((item) => ({
          id: item.id,
          contentVersionId: item.content_version_id,
          ordinal: item.ordinal,
          state: item.state,
          estimatedMinutes: item.estimated_minutes,
          title: item.content_versions?.payload.title ?? "Untitled",
        })),
    };
  }

  async updateJob(jobId: string, patch: { state: JobState; outcomeDetail?: string; limitedLogs?: string; gradingMode?: "contract" | "junit"; result?: ClientExecutionResult }): Promise<void> {
    const update: Record<string, unknown> = { state: patch.state };
    if (patch.outcomeDetail !== undefined) update.outcome_detail = patch.outcomeDetail.slice(0, 100);
    if (patch.limitedLogs !== undefined) update.limited_logs = Buffer.from(patch.limitedLogs).subarray(0, MAX_LOG_BYTES).toString("utf8");
    if (patch.gradingMode !== undefined) update.grading_mode = patch.gradingMode;
    if (patch.result !== undefined) update.result = patch.result;
    check("update_job", await this.db.from("execution_jobs").update(update).eq("id", jobId));
  }

  async getJob(userId: string, jobId: string): Promise<JobView | undefined> {
    const row = check("get_job", await this.db.from("execution_jobs").select("id, state, created_at, result").eq("id", jobId).eq("user_id", userId).maybeSingle());
    if (row === null) return undefined;
    return { id: row.id as string, state: row.state as JobState, createdAt: row.created_at as string, result: (row.result as ClientExecutionResult | null) ?? null };
  }

  async recordGradedAttempt(input: GradedAttemptInput): Promise<string> {
    return String(
      check(
        "record_graded_attempt",
        await this.db.rpc("record_graded_attempt", {
          p_user_id: input.userId,
          p_execution_job_id: input.executionJobId,
          p_content_version_id: input.contentVersionId,
          p_session_item_id: input.sessionItemId,
          p_response: input.response,
          p_hint_level: input.hintLevel,
          p_active_seconds: input.activeSeconds,
          p_state: input.state,
          p_outcome: input.outcome,
          p_rubric_version: input.rubricVersion,
          p_evidence: input.evidence,
          p_skill_states: input.skillStates,
          p_xp: input.xp,
        }),
      ),
    );
  }
}
