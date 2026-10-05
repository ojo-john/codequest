import { describe, expect, it } from "vitest";
import { loadExecutionBudgetConfig, type ExecutionBudgetConfig } from "@/lib/execution/budget";
import type { ExecutionResult, JavaExecutor } from "@/lib/execution/java-executor";
import { MeteredJavaExecutor, type MeteredExecuteOptions } from "@/lib/execution/metered-executor";
import { validateSourceFiles, type ValidatedSourceSet } from "@/lib/execution/source-files";
import { InMemoryExecutionUsageLedger } from "@/lib/execution/usage-ledger";
import { silentLogger } from "@/lib/observability/log";

const LIMITS = { sandboxLifetimeSeconds: 60, vcpus: 1 };
const BUDGET: ExecutionBudgetConfig = {
  ...loadExecutionBudgetConfig({}),
  dailyJobLimit: 3,
  monthlyCpuSecondsQuota: 200,
  cpuBudgetFraction: 1,
};

function result(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return { outcome: "succeeded", detail: "all_tests_passed", stage: "report", timingsMs: {}, activeCpuMs: 5_000, ...overrides };
}

/** Inner executor that returns scripted results, or blocks until released. */
class ScriptedExecutor implements JavaExecutor {
  calls = 0;
  private release: (() => void) | undefined;

  constructor(private readonly next: ExecutionResult | Error | "block" = result()) {}

  async execute(): Promise<ExecutionResult> {
    this.calls += 1;
    if (this.next === "block") {
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
      return result();
    }
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }

  finish(): void {
    this.release?.();
  }
}

let clockNow = new Date("2026-10-15T12:00:00Z");

function metered(inner: JavaExecutor, ledger = new InMemoryExecutionUsageLedger(), budget = BUDGET) {
  return new MeteredJavaExecutor({ inner, ledger, budget, limits: LIMITS, logger: silentLogger, clock: () => clockNow });
}

function sources(): ValidatedSourceSet {
  const validated = validateSourceFiles([{ path: "A.java", content: "class A {}" }], { maxSourceFiles: 20, maxTotalSourceBytes: 1000 });
  if (!validated.ok) throw new Error("fixture must be valid");
  return validated.files;
}

let jobCounter = 0;
function job(userId = "user-1"): MeteredExecuteOptions {
  jobCounter += 1;
  return { requestId: `req-${jobCounter}`, jobId: `job-${jobCounter}`, userId };
}

describe("MeteredJavaExecutor.execute", () => {
  it("execute_providerQuotaExhausted_pausesAllFurtherJobs", async () => {
    const quota = new ScriptedExecutor(result({ outcome: "infrastructure-error", detail: "provider_quota", infrastructureErrorType: "provider_quota" }));
    const ledger = new InMemoryExecutionUsageLedger();
    await metered(quota, ledger).execute(sources(), job());

    const next = await metered(new ScriptedExecutor(), ledger).execute(sources(), job("user-2"));

    expect(next).toMatchObject({ admitted: false, reason: "provider_quota_paused" });
  });

  it("execute_innerThrows_settlesAtWorstCaseAndRethrows", async () => {
    const ledger = new InMemoryExecutionUsageLedger();
    const budget = { ...BUDGET, dailyJobLimit: 100 };
    await expect(metered(new ScriptedExecutor(new RangeError("bug")), ledger, budget).execute(sources(), job())).rejects.toBeInstanceOf(
      RangeError,
    );
    const unknownCpu = () => metered(new ScriptedExecutor(result({ activeCpuMs: undefined })), ledger, budget);
    await unknownCpu().execute(sources(), job());
    await unknownCpu().execute(sources(), job());

    // 3 × 60 s worst case charged = 180 CPU-s; another 60 s reservation would exceed 200.
    const fourth = await unknownCpu().execute(sources(), job());

    expect(fourth).toMatchObject({ admitted: false, reason: "monthly_cpu_budget" });
  });

  it("execute_secondJobWhileFirstRunning_rejectsConcurrentJob", async () => {
    const blocking = new ScriptedExecutor("block");
    const ledger = new InMemoryExecutionUsageLedger();
    const first = metered(blocking, ledger).execute(sources(), job());

    const second = await metered(new ScriptedExecutor(), ledger).execute(sources(), job());
    blocking.finish();
    await first;

    expect(second).toEqual({ admitted: false, reason: "concurrent_job_limit" });
  });

  it("execute_afterFirstJobSettles_admitsNextJobForSameUser", async () => {
    const ledger = new InMemoryExecutionUsageLedger();
    await metered(new ScriptedExecutor(), ledger).execute(sources(), job());

    const second = await metered(new ScriptedExecutor(), ledger).execute(sources(), job());

    expect(second.admitted).toBe(true);
  });

  it("execute_dailyLimitReached_rejectsWithoutRunningSandbox", async () => {
    const ledger = new InMemoryExecutionUsageLedger();
    for (let i = 0; i < 3; i++) await metered(new ScriptedExecutor(), ledger).execute(sources(), job());
    const inner = new ScriptedExecutor();

    const rejected = await metered(inner, ledger).execute(sources(), job());

    expect([rejected.admitted, inner.calls]).toEqual([false, 0]);
  });

  it("execute_nextUtcDay_dailyLimitResets", async () => {
    const ledger = new InMemoryExecutionUsageLedger();
    for (let i = 0; i < 3; i++) await metered(new ScriptedExecutor(), ledger).execute(sources(), job());
    clockNow = new Date("2026-10-16T00:00:01Z");

    const nextDay = await metered(new ScriptedExecutor(), ledger).execute(sources(), job());
    clockNow = new Date("2026-10-15T12:00:00Z");

    expect(nextDay.admitted).toBe(true);
  });

  it("execute_measuredCpu_isChargedInsteadOfWorstCase", async () => {
    const ledger = new InMemoryExecutionUsageLedger();
    const budget = { ...BUDGET, dailyJobLimit: 100 };
    // 28 jobs × 5 s measured = 140 CPU-s, so a 60 s reservation still fits in 200. Had the worst
    // case been charged instead, the 4th job would already have been rejected.
    for (let i = 0; i < 28; i++) await metered(new ScriptedExecutor(), ledger, budget).execute(sources(), job());

    const admitted = await metered(new ScriptedExecutor(), ledger, budget).execute(sources(), job());

    expect(admitted.admitted).toBe(true);
  });

  it("execute_admitted_returnsInnerResult", async () => {
    const execution = await metered(new ScriptedExecutor(result({ outcome: "wrong-answer", detail: "test_failures" }))).execute(sources(), job());

    expect(execution).toMatchObject({ admitted: true, result: { outcome: "wrong-answer" } });
  });
});

describe("InMemoryExecutionUsageLedger", () => {
  it("admit_sameJobIdTwice_throws", async () => {
    const ledger = new InMemoryExecutionUsageLedger();
    const request = { jobId: "j", userId: "u", now: clockNow, reserveCpuSeconds: 60 };
    await ledger.admit(request, () => ({ admitted: true }));

    await expect(ledger.admit(request, () => ({ admitted: true }))).rejects.toThrow(/already admitted/);
  });

  it("settle_twice_keepsFirstValue", async () => {
    const ledger = new InMemoryExecutionUsageLedger();
    await ledger.admit({ jobId: "j", userId: "u", now: clockNow, reserveCpuSeconds: 60 }, () => ({ admitted: true }));
    await ledger.settle("j", 5);
    await ledger.settle("j", 500);
    let seen = -1;

    await ledger.admit({ jobId: "k", userId: "u", now: clockNow, reserveCpuSeconds: 60 }, (usage) => {
      seen = usage.settledCpuSecondsThisMonth;
      return { admitted: false, reason: "daily_job_limit" };
    });

    expect(seen).toBe(5);
  });

  it("settle_unknownJob_throws", async () => {
    await expect(new InMemoryExecutionUsageLedger().settle("missing", 1)).rejects.toThrow(/never admitted/);
  });

  it("pauseUntil_earlierThanExistingPause_keepsLaterPause", async () => {
    const ledger = new InMemoryExecutionUsageLedger();
    const later = new Date("2026-10-20T00:00:00Z");
    await ledger.pauseUntil(later);
    await ledger.pauseUntil(new Date("2026-10-16T00:00:00Z"));
    let paused: Date | undefined;

    await ledger.admit({ jobId: "p", userId: "u", now: clockNow, reserveCpuSeconds: 60 }, (usage) => {
      paused = usage.pausedUntil;
      return { admitted: false, reason: "provider_quota_paused" };
    });

    expect(paused).toEqual(later);
  });
});
