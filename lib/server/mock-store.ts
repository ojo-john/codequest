import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MockPlan, MockResult, MockSubmission } from "@/lib/interview/mock-scoring";
import { StoreError } from "./learning-store";

/** Persistence for mock interviews (spec §34) over Supabase with the server key; every query is scoped to the user. */

export interface MockRecord {
  readonly id: string;
  readonly kind: "coding";
  readonly durationMinutes: number;
  readonly contentVersionId: string;
  readonly plan: Partial<MockPlan>;
  readonly startedAt: Date;
  readonly endsAt: Date;
  readonly finishedAt?: Date;
  readonly result?: MockResult;
}

export interface NewMock {
  readonly userId: string;
  readonly durationMinutes: number;
  readonly contentVersionId: string;
  readonly requestKey: string;
  readonly startedAt: Date;
  readonly endsAt: Date;
}

export interface MockStore {
  /** The learner's unfinished mock, if any. */
  unfinished(userId: string): Promise<MockRecord | undefined>;
  get(userId: string, id: string): Promise<MockRecord | undefined>;
  byRequestKey(userId: string, requestKey: string): Promise<MockRecord | undefined>;
  /** Inserts the mock; "conflict" when the request key was used or another mock is unfinished. */
  insert(mock: NewMock): Promise<MockRecord | "conflict">;
  savePlan(userId: string, id: string, plan: MockPlan): Promise<boolean>;
  /** Records the result once; false if the mock was already finished. */
  finish(userId: string, id: string, finishedAt: Date, result: MockResult): Promise<boolean>;
  recent(userId: string, limit: number): Promise<MockRecord[]>;
  /** Content ids the learner has submitted anything for. */
  attemptedContentIds(userId: string): Promise<Set<string>>;
  submissionsFor(userId: string, contentVersionId: string, since: Date): Promise<MockSubmission[]>;
}

const UNIQUE_VIOLATION = "23505";
const COLUMNS = "id, kind, duration_minutes, content_version_id, plan, started_at, ends_at, finished_at, result";

interface Row {
  id: string;
  kind: "coding";
  duration_minutes: number;
  content_version_id: string;
  plan: Partial<MockPlan>;
  started_at: string;
  ends_at: string;
  finished_at: string | null;
  result: MockResult | null;
}

function toRecord(row: Row): MockRecord {
  return {
    id: row.id,
    kind: row.kind,
    durationMinutes: Number(row.duration_minutes),
    contentVersionId: row.content_version_id,
    plan: row.plan,
    startedAt: new Date(row.started_at),
    endsAt: new Date(row.ends_at),
    ...(row.finished_at && { finishedAt: new Date(row.finished_at) }),
    ...(row.result && { result: row.result }),
  };
}

function check<T>(operation: string, result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new StoreError(operation, result.error.message, { cause: result.error });
  return result.data;
}

export class SupabaseMockStore implements MockStore {
  constructor(private readonly db: SupabaseClient) {}

  async unfinished(userId: string): Promise<MockRecord | undefined> {
    const row = check("mock_unfinished", await this.db.from("mock_interviews").select(COLUMNS).eq("user_id", userId).is("finished_at", null).maybeSingle());
    return row ? toRecord(row as Row) : undefined;
  }

  async get(userId: string, id: string): Promise<MockRecord | undefined> {
    const row = check("mock_get", await this.db.from("mock_interviews").select(COLUMNS).eq("user_id", userId).eq("id", id).maybeSingle());
    return row ? toRecord(row as Row) : undefined;
  }

  async byRequestKey(userId: string, requestKey: string): Promise<MockRecord | undefined> {
    const row = check("mock_by_key", await this.db.from("mock_interviews").select(COLUMNS).eq("user_id", userId).eq("request_key", requestKey).maybeSingle());
    return row ? toRecord(row as Row) : undefined;
  }

  async insert(mock: NewMock): Promise<MockRecord | "conflict"> {
    const result = await this.db
      .from("mock_interviews")
      .insert({
        user_id: mock.userId,
        kind: "coding",
        duration_minutes: mock.durationMinutes,
        content_version_id: mock.contentVersionId,
        request_key: mock.requestKey,
        started_at: mock.startedAt.toISOString(),
        ends_at: mock.endsAt.toISOString(),
      })
      .select(COLUMNS)
      .single();
    if (result.error?.code === UNIQUE_VIOLATION) return "conflict";
    return toRecord(check("mock_insert", result) as Row);
  }

  async savePlan(userId: string, id: string, plan: MockPlan): Promise<boolean> {
    const rows = check("mock_save_plan", await this.db.from("mock_interviews").update({ plan }).eq("user_id", userId).eq("id", id).is("finished_at", null).select("id"));
    return (rows ?? []).length > 0;
  }

  async finish(userId: string, id: string, finishedAt: Date, result: MockResult): Promise<boolean> {
    const rows = check(
      "mock_finish",
      await this.db.from("mock_interviews").update({ finished_at: finishedAt.toISOString(), result }).eq("user_id", userId).eq("id", id).is("finished_at", null).select("id"),
    );
    return (rows ?? []).length > 0;
  }

  async recent(userId: string, limit: number): Promise<MockRecord[]> {
    const rows = check("mock_recent", await this.db.from("mock_interviews").select(COLUMNS).eq("user_id", userId).order("started_at", { ascending: false }).limit(limit));
    return (rows as Row[]).map(toRecord);
  }

  async attemptedContentIds(userId: string): Promise<Set<string>> {
    const rows = check("mock_attempted", await this.db.from("attempts").select("content_versions!inner(content_id)").eq("user_id", userId)) as unknown as Array<{ content_versions: { content_id: string } }>;
    return new Set(rows.map((row) => row.content_versions.content_id));
  }

  async submissionsFor(userId: string, contentVersionId: string, since: Date): Promise<MockSubmission[]> {
    const rows = check(
      "mock_submissions",
      await this.db
        .from("attempts")
        .select("created_at, outcome, execution_jobs!attempts_execution_job_id_fkey(result)")
        .eq("user_id", userId)
        .eq("content_version_id", contentVersionId)
        .eq("state", "graded")
        .gte("created_at", since.toISOString()),
    ) as unknown as Array<{ created_at: string; outcome: string | null; execution_jobs: { result: { cases?: Array<{ passed: boolean }> } | null } | null }>;
    return rows.map((row) => ({
      createdAt: new Date(row.created_at),
      outcome: row.outcome ?? "unknown",
      cases: (row.execution_jobs?.result?.cases ?? []).map((testCase) => ({ passed: testCase.passed })),
    }));
  }
}
