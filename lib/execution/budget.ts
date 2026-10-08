import { z } from "zod";
import type { ExecutionLimits } from "./limits";

/**
 * Execution admission control (spec §64): keeps learner executions inside the free sandbox quota.
 *
 * Job counts alone don't protect the quota — a job that hits its deadline burns ~2.5× the CPU
 * of a normal one (docs/COSTS.md) — so admission also meters CPU-seconds. Every admitted job
 * reserves its worst case (sandbox lifetime × vCPUs) until it settles with the measured value,
 * so concurrent jobs can't jointly overshoot. Windows are UTC calendar day/month; Vercel's
 * billing cycle may not align, which the budget fraction (default 80 %) absorbs.
 */

const budgetConfigSchema = z.object({
  dailyJobLimit: z.coerce.number().int().positive().default(100),
  monthlyJobLimit: z.coerce.number().int().positive().default(2000),
  /** Provider quota: Vercel Hobby includes 5 active CPU-hours per month. */
  monthlyCpuSecondsQuota: z.coerce.number().int().positive().default(5 * 3600),
  /** Stop admitting once settled + reserved CPU would exceed this fraction of the quota. */
  cpuBudgetFraction: z.coerce.number().gt(0).lte(1).default(0.8),
  maxActiveJobsPerUser: z.coerce.number().int().positive().default(1),
  /** How long to pause all new jobs after the provider reports its quota exhausted. */
  providerQuotaPauseHours: z.coerce.number().positive().default(24),
  /**
   * An unsettled job older than this is treated as abandoned (its function died before settling)
   * and settled at its reservation. Must exceed the execution route's maxDuration (90 s).
   */
  staleJobSeconds: z.coerce.number().int().min(120).default(300),
});

export type ExecutionBudgetConfig = Readonly<z.infer<typeof budgetConfigSchema>>;

const ENV_KEYS: Record<keyof ExecutionBudgetConfig, string> = {
  dailyJobLimit: "EXECUTION_DAILY_JOB_LIMIT",
  monthlyJobLimit: "EXECUTION_MONTHLY_JOB_LIMIT",
  monthlyCpuSecondsQuota: "SANDBOX_MONTHLY_CPU_SECONDS_QUOTA",
  cpuBudgetFraction: "EXECUTION_CPU_BUDGET_FRACTION",
  maxActiveJobsPerUser: "EXECUTION_MAX_ACTIVE_JOBS_PER_USER",
  providerQuotaPauseHours: "EXECUTION_PROVIDER_QUOTA_PAUSE_HOURS",
  staleJobSeconds: "EXECUTION_STALE_JOB_SECONDS",
};

export function loadExecutionBudgetConfig(env: Readonly<Record<string, string | undefined>> = process.env): ExecutionBudgetConfig {
  const raw = Object.fromEntries(
    Object.entries(ENV_KEYS)
      .map(([key, envKey]) => [key, env[envKey]] as const)
      .filter(([, value]) => value !== undefined && value !== ""),
  );
  return Object.freeze(budgetConfigSchema.parse(raw));
}

/** Worst-case CPU a single job can consume: the whole sandbox lifetime on every vCPU. */
export function worstCaseJobCpuSeconds(limits: Pick<ExecutionLimits, "sandboxLifetimeSeconds" | "vcpus">): number {
  return limits.sandboxLifetimeSeconds * limits.vcpus;
}

export interface UsageSnapshot {
  readonly jobsToday: number;
  readonly jobsThisMonth: number;
  /** Measured CPU of settled jobs this month. */
  readonly settledCpuSecondsThisMonth: number;
  /** Worst-case reservations of jobs still running (all users). */
  readonly reservedCpuSeconds: number;
  readonly activeJobsForUser: number;
  readonly pausedUntil?: Date;
}

export type RejectionReason =
  | "provider_quota_paused"
  | "concurrent_job_limit"
  | "daily_job_limit"
  | "monthly_job_limit"
  | "monthly_cpu_budget";

export type AdmissionDecision =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: RejectionReason; readonly retryAfter?: Date };

export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function startOfUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function startOfNextUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function startOfNextUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Pure admission policy; the ledger applies it atomically with recording the reservation. */
export function decideAdmission(
  usage: UsageSnapshot,
  config: ExecutionBudgetConfig,
  jobReserveCpuSeconds: number,
  now: Date,
): AdmissionDecision {
  if (usage.pausedUntil !== undefined && usage.pausedUntil > now) {
    return { admitted: false, reason: "provider_quota_paused", retryAfter: usage.pausedUntil };
  }
  if (usage.activeJobsForUser >= config.maxActiveJobsPerUser) {
    return { admitted: false, reason: "concurrent_job_limit" };
  }
  if (usage.jobsToday >= config.dailyJobLimit) {
    return { admitted: false, reason: "daily_job_limit", retryAfter: startOfNextUtcDay(now) };
  }
  if (usage.jobsThisMonth >= config.monthlyJobLimit) {
    return { admitted: false, reason: "monthly_job_limit", retryAfter: startOfNextUtcMonth(now) };
  }
  const cpuBudget = config.monthlyCpuSecondsQuota * config.cpuBudgetFraction;
  if (usage.settledCpuSecondsThisMonth + usage.reservedCpuSeconds + jobReserveCpuSeconds > cpuBudget) {
    // Running jobs may settle below their reservation and free budget, so no fixed retry time
    // unless only settled usage is already over.
    const exhausted = usage.settledCpuSecondsThisMonth + jobReserveCpuSeconds > cpuBudget;
    return exhausted
      ? { admitted: false, reason: "monthly_cpu_budget", retryAfter: startOfNextUtcMonth(now) }
      : { admitted: false, reason: "monthly_cpu_budget" };
  }
  return { admitted: true };
}

/** Jobs created before this and still unsettled are abandoned. */
export function staleBefore(config: Pick<ExecutionBudgetConfig, "staleJobSeconds">, now: Date): Date {
  return new Date(now.getTime() - config.staleJobSeconds * 1000);
}

export interface UsageMeter {
  readonly used: number;
  readonly limit: number;
  readonly resetsAt: Date;
}

/** What the usage screen shows (spec §64): the application's own allowance, not the provider's bill. */
export interface UsageReport {
  readonly jobsToday: UsageMeter;
  readonly jobsThisMonth: UsageMeter;
  /** CPU-seconds: measured for finished jobs plus the worst case for running ones. */
  readonly cpuSecondsThisMonth: UsageMeter;
  /** The provider's monthly quota the CPU allowance is a fraction of. */
  readonly providerCpuSecondsQuota: number;
  readonly runningJobs: number;
  readonly pausedUntil?: Date;
}

export function usageReport(usage: UsageSnapshot, config: ExecutionBudgetConfig, now: Date): UsageReport {
  const nextMonth = startOfNextUtcMonth(now);
  const paused = usage.pausedUntil !== undefined && usage.pausedUntil > now ? usage.pausedUntil : undefined;
  return {
    jobsToday: { used: usage.jobsToday, limit: config.dailyJobLimit, resetsAt: startOfNextUtcDay(now) },
    jobsThisMonth: { used: usage.jobsThisMonth, limit: config.monthlyJobLimit, resetsAt: nextMonth },
    cpuSecondsThisMonth: {
      used: usage.settledCpuSecondsThisMonth + usage.reservedCpuSeconds,
      limit: config.monthlyCpuSecondsQuota * config.cpuBudgetFraction,
      resetsAt: nextMonth,
    },
    providerCpuSecondsQuota: config.monthlyCpuSecondsQuota,
    runningJobs: usage.activeJobsForUser,
    ...(paused && { pausedUntil: paused }),
  };
}
