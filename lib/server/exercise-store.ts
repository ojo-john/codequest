import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { exerciseSetPayloadSchema, privateAnswerSchema, type ExerciseSetPayload, type PrivateAnswer } from "@/lib/exercises/schema";
import { StoreError, visibleContentStatuses, type ContentStatus, type GradedAttemptInput } from "./learning-store";

/**
 * Persistence for exercise sets (spec §43) over Supabase with the server (secret) key. Every
 * method takes the authenticated user id and enforces ownership and content visibility itself.
 */

export interface ExerciseSetRecord extends ExerciseSetPayload {
  readonly contentVersionId: string;
  readonly contentId: string;
  readonly version: number;
  readonly status: ContentStatus;
}

export interface ExerciseAttemptInput {
  readonly userId: string;
  readonly contentVersionId: string;
  readonly requestKey: string;
  readonly response: { readonly questionId: string; readonly answer: unknown };
  readonly activeSeconds: number;
  readonly outcome: string;
  readonly evidence: GradedAttemptInput["evidence"];
  readonly skillStates: GradedAttemptInput["skillStates"];
  readonly xp: GradedAttemptInput["xp"];
}

export interface RecordedExerciseAttempt {
  readonly attemptId: string;
  readonly awardedXp: number;
  /** A retried request: nothing new was recorded. */
  readonly replayed: boolean;
}

export interface ExerciseStore {
  listVisibleSets(userId: string): Promise<ExerciseSetRecord[]>;
  getVisibleSet(userId: string, contentVersionId: string): Promise<ExerciseSetRecord | undefined>;
  /** Canonical answers (server only). */
  getAnswers(contentVersionId: string): Promise<Record<string, PrivateAnswer>>;
  /** Best outcome so far per question of this set version ("pass" beats "partial" beats "fail"). */
  bestOutcomes(userId: string, contentVersionId: string): Promise<Map<string, string>>;
  recordAttempt(input: ExerciseAttemptInput): Promise<RecordedExerciseAttempt>;
}

const rowSchema = z.object({
  id: z.string(),
  content_id: z.string(),
  version: z.number(),
  status: z.enum(["draft", "ai_reviewed", "human_reviewed", "published", "deprecated"]),
  payload: z.unknown(),
});
const answersSchema = z.object({ answers: z.record(z.string(), privateAnswerSchema) });
const recordedSchema = z.object({ attempt_id: z.string(), awarded_xp: z.number().int().nonnegative(), replayed: z.boolean() });

const OUTCOME_RANK: Record<string, number> = { succeeded: 3, partial: 2, "wrong-answer": 1 };

function check<T>(operation: string, result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new StoreError(operation, result.error.message, { cause: result.error });
  return result.data;
}

function toRecord(row: z.infer<typeof rowSchema>): ExerciseSetRecord | undefined {
  const payload = exerciseSetPayloadSchema.safeParse(row.payload);
  if (!payload.success) return undefined;
  return { ...payload.data, contentVersionId: row.id, contentId: row.content_id, version: row.version, status: row.status };
}

export class SupabaseExerciseStore implements ExerciseStore {
  constructor(private readonly db: SupabaseClient) {}

  async listVisibleSets(userId: string): Promise<ExerciseSetRecord[]> {
    const statuses = await visibleContentStatuses(this.db, userId);
    const rows = z.array(rowSchema).parse(
      check(
        "list_exercise_sets",
        await this.db
          .from("content_versions")
          .select("id, content_id, version, status, payload, content_items!inner(kind)")
          .eq("content_items.kind", "question")
          .in("status", [...statuses])
          .order("version", { ascending: false }),
      ),
    );
    const latest = new Map<string, ExerciseSetRecord>();
    for (const row of rows) {
      if (latest.has(row.content_id)) continue;
      const record = toRecord(row);
      if (record) latest.set(row.content_id, record);
    }
    return [...latest.values()];
  }

  async getVisibleSet(userId: string, contentVersionId: string): Promise<ExerciseSetRecord | undefined> {
    const statuses = await visibleContentStatuses(this.db, userId);
    const row = check(
      "get_exercise_set",
      await this.db.from("content_versions").select("id, content_id, version, status, payload").eq("id", contentVersionId).in("status", [...statuses]).maybeSingle(),
    );
    return row === null ? undefined : toRecord(rowSchema.parse(row));
  }

  async getAnswers(contentVersionId: string): Promise<Record<string, PrivateAnswer>> {
    const data = check("get_exercise_answers", await this.db.rpc("get_content_grading", { p_content_version_id: contentVersionId }));
    return answersSchema.parse(data).answers;
  }

  async bestOutcomes(userId: string, contentVersionId: string): Promise<Map<string, string>> {
    const rows = check(
      "exercise_outcomes",
      await this.db.from("attempts").select("outcome, response").eq("user_id", userId).eq("content_version_id", contentVersionId).eq("state", "graded"),
    ) as Array<{ outcome: string | null; response: { questionId?: string } | null }>;
    const best = new Map<string, string>();
    for (const row of rows) {
      const questionId = row.response?.questionId;
      const outcome = row.outcome ?? "";
      if (questionId === undefined) continue;
      if ((OUTCOME_RANK[outcome] ?? 0) > (OUTCOME_RANK[best.get(questionId) ?? ""] ?? 0)) best.set(questionId, outcome);
    }
    return best;
  }

  async recordAttempt(input: ExerciseAttemptInput): Promise<RecordedExerciseAttempt> {
    const data = check(
      "record_exercise_attempt",
      await this.db.rpc("record_exercise_attempt", {
        p_user_id: input.userId,
        p_content_version_id: input.contentVersionId,
        p_request_key: input.requestKey,
        p_response: input.response,
        p_active_seconds: input.activeSeconds,
        p_outcome: input.outcome,
        p_evidence: input.evidence,
        p_skill_states: input.skillStates,
        p_xp: input.xp,
      }),
    );
    const row = recordedSchema.parse(data);
    return { attemptId: row.attempt_id, awardedXp: row.awarded_xp, replayed: row.replayed };
  }
}
