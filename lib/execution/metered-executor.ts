import type { Logger } from "../observability/log";
import {
  decideAdmission,
  worstCaseJobCpuSeconds,
  type ExecutionBudgetConfig,
  type RejectionReason,
} from "./budget";
import type { ExecutionResult, GradingMode, JavaExecutor } from "./java-executor";
import type { ExecutionLimits } from "./limits";
import type { ValidatedSourceSet } from "./source-files";
import type { ExecutionUsageLedger } from "./usage-ledger";

export interface MeteredExecuteOptions {
  readonly requestId: string;
  readonly jobId: string;
  /** Authenticated user id — never a browser-supplied value (spec §66). */
  readonly userId: string;
  readonly grading?: GradingMode;
  readonly signal?: AbortSignal;
}

/** A rejected job never reached the sandbox; the learner's code is untouched and can be resubmitted. */
export type MeteredExecution =
  | { readonly admitted: true; readonly result: ExecutionResult }
  | { readonly admitted: false; readonly reason: RejectionReason; readonly retryAfter?: Date };

export interface MeteredJavaExecutorDeps {
  readonly inner: JavaExecutor;
  readonly ledger: ExecutionUsageLedger;
  readonly budget: ExecutionBudgetConfig;
  readonly limits: Pick<ExecutionLimits, "sandboxLifetimeSeconds" | "vcpus">;
  readonly logger: Logger;
  readonly clock?: () => Date;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Admission control around a {@link JavaExecutor} (spec §64): rejects jobs that would exceed
 * the job caps or the CPU budget, reserves worst-case CPU for admitted jobs, settles them with
 * the measured CPU (or the worst case when the provider can't say), and pauses all admissions
 * when the provider reports its quota exhausted.
 */
export class MeteredJavaExecutor {
  private readonly deps: MeteredJavaExecutorDeps;
  private readonly clock: () => Date;

  constructor(deps: MeteredJavaExecutorDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? (() => new Date());
  }

  async execute(sources: ValidatedSourceSet, options: MeteredExecuteOptions): Promise<MeteredExecution> {
    const { inner, ledger, budget, limits, logger } = this.deps;
    const log = logger.child({ requestId: options.requestId, jobId: options.jobId, component: "metered-executor" });
    const reserve = worstCaseJobCpuSeconds(limits);
    const now = this.clock();

    const decision = await ledger.admit(
      { jobId: options.jobId, userId: options.userId, now, reserveCpuSeconds: reserve },
      (usage) => decideAdmission(usage, budget, reserve, now),
    );
    if (!decision.admitted) {
      log.log("warn", "execution.rejected", { reason: decision.reason, retryAfter: decision.retryAfter?.toISOString() });
      log.metric("execution.rejected", 1, { reason: decision.reason });
      return decision;
    }

    let settleCpuSeconds = reserve;
    try {
      const result = await inner.execute(sources, { requestId: options.requestId, grading: options.grading, signal: options.signal });
      if (result.activeCpuMs !== undefined) settleCpuSeconds = result.activeCpuMs / 1000;
      if (result.outcome === "infrastructure-error" && result.infrastructureErrorType === "provider_quota") {
        const until = new Date(now.getTime() + budget.providerQuotaPauseHours * MS_PER_HOUR);
        await ledger.pauseUntil(until);
        log.log("error", "execution.provider_quota_exhausted", { pausedUntil: until.toISOString() });
        log.metric("execution.provider_quota_exhausted", 1);
      }
      return { admitted: true, result };
    } finally {
      // Unknown usage (provider silent, or a bug threw) is charged at the worst case.
      await ledger.settle(options.jobId, settleCpuSeconds);
      log.metric("execution.cpu_seconds_charged", settleCpuSeconds);
    }
  }
}
