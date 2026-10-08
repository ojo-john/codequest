import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AdmissionDecision, UsageSnapshot } from "./budget";
import { DuplicateJobError, type ExecutionUsageLedger, type ReservationRequest } from "./usage-ledger";

/**
 * Supabase implementation of {@link ExecutionUsageLedger} over public.execution_jobs.
 *
 * The admission policy stays in TypeScript; atomicity comes from optimistic concurrency:
 * read a snapshot with its usage_version, decide, then reserve only if the version is
 * unchanged (supabase/migrations/…_execution_jobs.sql). On a conflict the snapshot is re-read
 * and the policy re-applied, with jittered backoff. If the ledger is unreachable admission fails
 * closed — no job runs without a recorded reservation.
 */

const snapshotRowSchema = z.object({
  jobs_today: z.coerce.number(),
  jobs_this_month: z.coerce.number(),
  settled_cpu_seconds_this_month: z.coerce.number(),
  reserved_cpu_seconds: z.coerce.number(),
  active_jobs_for_user: z.coerce.number(),
  paused_until: z.string().nullable(),
  usage_version: z.coerce.number(),
});

/** Ledger failure. `retryable` distinguishes transient (network, contention) from bugs. */
export class LedgerError extends Error {
  readonly errorType: string;
  readonly retryable: boolean;

  constructor(errorType: string, retryable: boolean, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LedgerError";
    this.errorType = errorType;
    this.retryable = retryable;
  }
}

export interface SupabaseLedgerOptions {
  readonly maxReserveAttempts: number;
  readonly baseBackoffMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
}

const DEFAULT_OPTIONS: SupabaseLedgerOptions = {
  maxReserveAttempts: 5,
  baseBackoffMs: 20,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

interface PostgrestLikeError {
  readonly code?: string;
  readonly message: string;
}

const UNIQUE_VIOLATION = "23505";
const NO_DATA_FOUND = "P0002";

function toLedgerError(operation: string, error: PostgrestLikeError): Error {
  if (error.code === UNIQUE_VIOLATION) return new Error(`${operation}: job was already admitted`);
  if (error.code === NO_DATA_FOUND) return new Error(`${operation}: job was never admitted`);
  // An empty/absent code means the request never got a database answer (network, timeout).
  const transport = error.code === undefined || error.code === "";
  return new LedgerError(
    transport ? "ledger_unreachable" : `ledger_db_${error.code}`,
    transport,
    `${operation}: ${error.message}`,
    { cause: error },
  );
}

export class SupabaseExecutionUsageLedger implements ExecutionUsageLedger {
  private readonly options: SupabaseLedgerOptions;

  constructor(
    private readonly client: SupabaseClient,
    options: Partial<SupabaseLedgerOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async admit(request: ReservationRequest, decide: (usage: UsageSnapshot) => AdmissionDecision): Promise<AdmissionDecision> {
    await this.reclaim(request.staleBefore);
    for (let attempt = 1; attempt <= this.options.maxReserveAttempts; attempt += 1) {
      const { usage, version } = await this.snapshot(request.userId, request.now);
      const decision = decide(usage);
      if (!decision.admitted) return decision;

      const { data, error } = await this.client.rpc("reserve_execution_job", {
        p_job_id: request.jobId,
        p_user_id: request.userId,
        p_now: request.now.toISOString(),
        p_reserve_cpu_seconds: request.reserveCpuSeconds,
        p_expected_usage_version: version,
      });
      if (error?.code === UNIQUE_VIOLATION) throw new DuplicateJobError(request.jobId);
      if (error) throw toLedgerError("reserve_execution_job", error);
      if (data === "reserved") return decision;

      // Someone else changed usage since our snapshot: back off (full jitter) and decide again.
      await this.options.sleep(this.options.random() * this.options.baseBackoffMs * 2 ** (attempt - 1));
    }
    throw new LedgerError("ledger_contention", true, `admission did not settle after ${this.options.maxReserveAttempts} attempts`);
  }

  async settle(jobId: string, cpuSeconds: number): Promise<void> {
    const { error } = await this.client.rpc("settle_execution_job", { p_job_id: jobId, p_cpu_seconds: cpuSeconds });
    if (error) throw toLedgerError("settle_execution_job", error);
  }

  async pauseUntil(until: Date): Promise<void> {
    const { error } = await this.client.rpc("pause_executions", { p_until: until.toISOString() });
    if (error) throw toLedgerError("pause_executions", error);
  }

  async usage(userId: string, now: Date, staleBefore: Date): Promise<UsageSnapshot> {
    await this.reclaim(staleBefore);
    return (await this.snapshot(userId, now)).usage;
  }

  private async reclaim(staleBefore: Date): Promise<void> {
    const { error } = await this.client.rpc("reclaim_stale_executions", { p_stale_before: staleBefore.toISOString() });
    if (error) throw toLedgerError("reclaim_stale_executions", error);
  }

  private async snapshot(userId: string, now: Date): Promise<{ usage: UsageSnapshot; version: number }> {
    const { data, error } = await this.client.rpc("execution_usage_snapshot", { p_user_id: userId, p_now: now.toISOString() });
    if (error) throw toLedgerError("execution_usage_snapshot", error);
    const first: unknown = Array.isArray(data) ? data[0] : data;
    if (first === undefined || first === null) {
      // private.execution_controls lost its singleton row (e.g. a manual truncate). Fail closed.
      throw new LedgerError("ledger_controls_missing", false, "execution_usage_snapshot returned no row; private.execution_controls is empty");
    }
    const row = snapshotRowSchema.parse(first);
    return {
      version: row.usage_version,
      usage: {
        jobsToday: row.jobs_today,
        jobsThisMonth: row.jobs_this_month,
        settledCpuSecondsThisMonth: row.settled_cpu_seconds_this_month,
        reservedCpuSeconds: row.reserved_cpu_seconds,
        activeJobsForUser: row.active_jobs_for_user,
        pausedUntil: row.paused_until === null ? undefined : new Date(row.paused_until),
      },
    };
  }
}

/** Database size for the usage screen (service-role-only SQL function). */
export class SupabaseDatabaseSize {
  constructor(private readonly client: SupabaseClient) {}

  async sizeBytes(): Promise<number> {
    const { data, error } = await this.client.rpc("database_size_bytes");
    if (error) throw toLedgerError("database_size_bytes", error);
    return z.coerce.number().nonnegative().parse(data);
  }
}
