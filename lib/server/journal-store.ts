import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { REFLECTION_PROMPTS, type ReflectionBody } from "@/lib/learning/reflection";
import { StoreError } from "./learning-store";

/**
 * Notes and reflections (spec §51, §56) over Supabase with the server (secret) key. Every method
 * takes the authenticated user id and filters by it; never pass a browser-supplied user id.
 */

export interface NoteRecord {
  readonly id: string;
  readonly body: string;
  readonly updatedAt: string;
}

export interface ReflectionRecord {
  readonly body: ReflectionBody;
  readonly createdAt: string;
}

export interface GradedAttemptRef {
  readonly attemptId: string;
  readonly contentId: string;
}

export interface JournalStore {
  /** The learner's note on a quest (the most recently edited, if an import brought in several). */
  getNote(userId: string, contentId: string): Promise<NoteRecord | undefined>;
  saveNote(userId: string, contentId: string, body: string): Promise<NoteRecord>;
  deleteNotes(userId: string, contentId: string): Promise<void>;
  /** The graded attempt recorded for one of the learner's execution jobs. */
  attemptForJob(userId: string, jobId: string): Promise<GradedAttemptRef | undefined>;
  /** Idempotent per attempt: a second save for the same attempt keeps the first. */
  saveReflection(userId: string, attemptId: string, body: ReflectionBody): Promise<void>;
  latestReflection(userId: string, contentId: string): Promise<ReflectionRecord | undefined>;
}

const UNIQUE_VIOLATION = "23505";

const noteSchema = z.object({ id: z.string(), body: z.string(), updated_at: z.string() });
const attemptSchema = z.object({ id: z.string(), content_versions: z.object({ content_id: z.string() }) });
const reflectionBodySchema = z.object({
  version: z.literal("reflection-v1"),
  answers: z.partialRecord(z.enum(REFLECTION_PROMPTS.map((prompt) => prompt.key)), z.string()),
});
const reflectionSchema = z.object({ body: reflectionBodySchema, created_at: z.string() });

function check<T>(operation: string, result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new StoreError(operation, result.error.message, { cause: result.error });
  return result.data;
}

function toNote(row: unknown): NoteRecord {
  const note = noteSchema.parse(row);
  return { id: note.id, body: note.body, updatedAt: note.updated_at };
}

export class SupabaseJournalStore implements JournalStore {
  constructor(private readonly db: SupabaseClient) {}

  async getNote(userId: string, contentId: string): Promise<NoteRecord | undefined> {
    const row = check(
      "get_note",
      await this.db.from("notes").select("id, body, updated_at").eq("user_id", userId).eq("content_id", contentId).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    );
    return row === null ? undefined : toNote(row);
  }

  async saveNote(userId: string, contentId: string, body: string): Promise<NoteRecord> {
    // Update the existing note, else create one. Two tabs saving a first note at the same moment
    // can both insert; getNote then shows the newer and the older stays in the export.
    const existing = await this.getNote(userId, contentId);
    if (existing !== undefined) {
      const row = check("update_note", await this.db.from("notes").update({ body }).eq("id", existing.id).eq("user_id", userId).select("id, body, updated_at").single());
      return toNote(row);
    }
    const row = check("insert_note", await this.db.from("notes").insert({ user_id: userId, content_id: contentId, body }).select("id, body, updated_at").single());
    return toNote(row);
  }

  async deleteNotes(userId: string, contentId: string): Promise<void> {
    check("delete_notes", await this.db.from("notes").delete().eq("user_id", userId).eq("content_id", contentId));
  }

  async attemptForJob(userId: string, jobId: string): Promise<GradedAttemptRef | undefined> {
    const row = check(
      "attempt_for_job",
      await this.db.from("attempts").select("id, content_versions(content_id)").eq("execution_job_id", jobId).eq("user_id", userId).eq("state", "graded").maybeSingle(),
    );
    if (row === null) return undefined;
    const attempt = attemptSchema.parse(row);
    return { attemptId: attempt.id, contentId: attempt.content_versions.content_id };
  }

  async saveReflection(userId: string, attemptId: string, body: ReflectionBody): Promise<void> {
    const { error } = await this.db.from("reflections").insert({ user_id: userId, attempt_id: attemptId, body });
    if (error && error.code !== UNIQUE_VIOLATION) throw new StoreError("save_reflection", error.message, { cause: error });
  }

  async latestReflection(userId: string, contentId: string): Promise<ReflectionRecord | undefined> {
    const row = check(
      "latest_reflection",
      await this.db
        .from("reflections")
        .select("body, created_at, attempts!inner(content_versions!inner(content_id))")
        .eq("user_id", userId)
        .eq("attempts.content_versions.content_id", contentId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    );
    if (row === null) return undefined;
    const parsed = reflectionSchema.safeParse(row);
    // A reflection stored under an older prompt version is kept but not shown with today's prompts.
    if (!parsed.success) return undefined;
    return { body: parsed.data.body as ReflectionBody, createdAt: parsed.data.created_at };
  }
}
