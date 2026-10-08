import { startOfUtcDay, startOfUtcMonth, type AdmissionDecision, type UsageSnapshot } from "./budget";

/**
 * Persistence port for execution usage. `admit` must evaluate the policy and record the
 * reservation atomically, so two concurrent requests can't both take the last slot. The
 * Supabase implementation (Phase 1) does this in one SQL function under a row lock; the
 * in-memory one below is for tests and single-process local use.
 */
export interface ReservationRequest {
  readonly jobId: string;
  readonly userId: string;
  readonly now: Date;
  readonly reserveCpuSeconds: number;
  /** Unsettled jobs created before this are abandoned and settled at their reservation first. */
  readonly staleBefore: Date;
}

/** The job id was admitted before (a retried or replayed request). */
export class DuplicateJobError extends Error {
  constructor(readonly jobId: string) {
    super(`job ${jobId} was already admitted`);
    this.name = "DuplicateJobError";
  }
}

export interface ExecutionUsageLedger {
  admit(request: ReservationRequest, decide: (usage: UsageSnapshot) => AdmissionDecision): Promise<AdmissionDecision>;
  /** Replaces a job's reservation with its measured CPU. Idempotent per job. */
  settle(jobId: string, cpuSeconds: number): Promise<void>;
  /** Pauses all admissions until the given time (provider reported its quota exhausted). */
  pauseUntil(until: Date): Promise<void>;
  /** Read-only view for the usage screen, after reclaiming abandoned jobs like admission does. */
  usage(userId: string, now: Date, staleBefore: Date): Promise<UsageSnapshot>;
}

interface JobRecord {
  readonly userId: string;
  readonly admittedAt: Date;
  readonly reservedCpuSeconds: number;
  settledCpuSeconds?: number;
}

export class InMemoryExecutionUsageLedger implements ExecutionUsageLedger {
  private readonly jobs = new Map<string, JobRecord>();
  private paused: Date | undefined;

  // No awaits inside: evaluation and recording happen in one synchronous turn, which is atomic
  // within a single Node process.
  async admit(request: ReservationRequest, decide: (usage: UsageSnapshot) => AdmissionDecision): Promise<AdmissionDecision> {
    if (this.jobs.has(request.jobId)) throw new DuplicateJobError(request.jobId);
    this.reclaim(request.staleBefore);
    const decision = decide(this.snapshot(request.userId, request.now));
    if (decision.admitted) {
      this.jobs.set(request.jobId, {
        userId: request.userId,
        admittedAt: request.now,
        reservedCpuSeconds: request.reserveCpuSeconds,
      });
    }
    return decision;
  }

  async settle(jobId: string, cpuSeconds: number): Promise<void> {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error(`job ${jobId} was never admitted`);
    if (job.settledCpuSeconds === undefined) job.settledCpuSeconds = cpuSeconds;
  }

  async pauseUntil(until: Date): Promise<void> {
    if (this.paused === undefined || until > this.paused) this.paused = until;
  }

  async usage(userId: string, now: Date, staleBefore: Date): Promise<UsageSnapshot> {
    this.reclaim(staleBefore);
    return this.snapshot(userId, now);
  }

  private reclaim(staleBefore: Date): void {
    for (const job of this.jobs.values()) {
      if (job.settledCpuSeconds === undefined && job.admittedAt < staleBefore) job.settledCpuSeconds = job.reservedCpuSeconds;
    }
  }

  private snapshot(userId: string, now: Date): UsageSnapshot {
    const dayStart = startOfUtcDay(now);
    const monthStart = startOfUtcMonth(now);
    let jobsToday = 0;
    let jobsThisMonth = 0;
    let settledCpuSecondsThisMonth = 0;
    let reservedCpuSeconds = 0;
    let activeJobsForUser = 0;
    for (const job of this.jobs.values()) {
      const active = job.settledCpuSeconds === undefined;
      if (active) {
        reservedCpuSeconds += job.reservedCpuSeconds;
        if (job.userId === userId) activeJobsForUser += 1;
      }
      if (job.admittedAt >= monthStart) {
        jobsThisMonth += 1;
        if (job.admittedAt >= dayStart) jobsToday += 1;
        if (!active) settledCpuSecondsThisMonth += job.settledCpuSeconds ?? 0;
      }
    }
    return { jobsToday, jobsThisMonth, settledCpuSecondsThisMonth, reservedCpuSeconds, activeJobsForUser, pausedUntil: this.paused };
  }
}
