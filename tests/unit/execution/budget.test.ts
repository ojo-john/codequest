import { describe, expect, it } from "vitest";
import {
  decideAdmission,
  loadExecutionBudgetConfig,
  worstCaseJobCpuSeconds,
  type ExecutionBudgetConfig,
  type UsageSnapshot,
} from "@/lib/execution/budget";

const NOW = new Date("2026-10-15T12:00:00Z");
const RESERVE = 60;
// 1,000 CPU-s quota at 80 % => 800 CPU-s budget.
const CONFIG: ExecutionBudgetConfig = {
  ...loadExecutionBudgetConfig({}),
  dailyJobLimit: 10,
  monthlyJobLimit: 50,
  monthlyCpuSecondsQuota: 1000,
  cpuBudgetFraction: 0.8,
};

function usage(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    jobsToday: 0,
    jobsThisMonth: 0,
    settledCpuSecondsThisMonth: 0,
    reservedCpuSeconds: 0,
    activeJobsForUser: 0,
    ...overrides,
  };
}

describe("decideAdmission", () => {
  it("decideAdmission_providerQuotaPauseActive_rejectsUntilPauseEnds", () => {
    const until = new Date("2026-10-16T00:00:00Z");

    expect(decideAdmission(usage({ pausedUntil: until }), CONFIG, RESERVE, NOW)).toEqual({
      admitted: false,
      reason: "provider_quota_paused",
      retryAfter: until,
    });
  });

  it("decideAdmission_pauseAlreadyExpired_admits", () => {
    expect(decideAdmission(usage({ pausedUntil: new Date("2026-10-15T11:59:59Z") }), CONFIG, RESERVE, NOW).admitted).toBe(true);
  });

  it("decideAdmission_userAlreadyHasActiveJob_rejectsConcurrentJob", () => {
    expect(decideAdmission(usage({ activeJobsForUser: 1 }), CONFIG, RESERVE, NOW)).toEqual({
      admitted: false,
      reason: "concurrent_job_limit",
    });
  });

  it("decideAdmission_dailyLimitReached_rejectsUntilNextUtcDay", () => {
    expect(decideAdmission(usage({ jobsToday: 10, jobsThisMonth: 10 }), CONFIG, RESERVE, NOW)).toEqual({
      admitted: false,
      reason: "daily_job_limit",
      retryAfter: new Date("2026-10-16T00:00:00Z"),
    });
  });

  it("decideAdmission_oneBelowDailyLimit_admits", () => {
    expect(decideAdmission(usage({ jobsToday: 9, jobsThisMonth: 9 }), CONFIG, RESERVE, NOW).admitted).toBe(true);
  });

  it("decideAdmission_monthlyLimitReached_rejectsUntilNextUtcMonth", () => {
    expect(decideAdmission(usage({ jobsThisMonth: 50 }), CONFIG, RESERVE, NOW)).toEqual({
      admitted: false,
      reason: "monthly_job_limit",
      retryAfter: new Date("2026-11-01T00:00:00Z"),
    });
  });

  it("decideAdmission_decemberMonthlyLimit_retryAfterRollsIntoJanuary", () => {
    const december = new Date("2026-12-31T23:00:00Z");

    expect(decideAdmission(usage({ jobsThisMonth: 50 }), CONFIG, RESERVE, december)).toMatchObject({
      retryAfter: new Date("2027-01-01T00:00:00Z"),
    });
  });

  it("decideAdmission_settledCpuLeavesNoRoomForWorstCase_rejectsUntilNextMonth", () => {
    expect(decideAdmission(usage({ settledCpuSecondsThisMonth: 741 }), CONFIG, RESERVE, NOW)).toEqual({
      admitted: false,
      reason: "monthly_cpu_budget",
      retryAfter: new Date("2026-11-01T00:00:00Z"),
    });
  });

  it("decideAdmission_worstCaseExactlyFillsBudget_admits", () => {
    expect(decideAdmission(usage({ settledCpuSecondsThisMonth: 740 }), CONFIG, RESERVE, NOW).admitted).toBe(true);
  });

  it("decideAdmission_runningReservationsFillBudget_rejectsWithoutFixedRetryTime", () => {
    expect(
      decideAdmission(usage({ settledCpuSecondsThisMonth: 700, reservedCpuSeconds: 60 }), CONFIG, RESERVE, NOW),
    ).toEqual({ admitted: false, reason: "monthly_cpu_budget" });
  });

  it("decideAdmission_freshMonth_admits", () => {
    expect(decideAdmission(usage(), CONFIG, RESERVE, NOW)).toEqual({ admitted: true });
  });
});

describe("loadExecutionBudgetConfig", () => {
  it("loadExecutionBudgetConfig_noEnv_usesSpecDefaultsAndHobbyQuota", () => {
    expect(loadExecutionBudgetConfig({})).toMatchObject({
      dailyJobLimit: 100,
      monthlyJobLimit: 2000,
      monthlyCpuSecondsQuota: 18_000,
      cpuBudgetFraction: 0.8,
      maxActiveJobsPerUser: 1,
    });
  });

  it("loadExecutionBudgetConfig_fractionAboveOne_throws", () => {
    expect(() => loadExecutionBudgetConfig({ EXECUTION_CPU_BUDGET_FRACTION: "1.5" })).toThrow();
  });

  it("loadExecutionBudgetConfig_envOverride_isApplied", () => {
    expect(loadExecutionBudgetConfig({ EXECUTION_DAILY_JOB_LIMIT: "5" }).dailyJobLimit).toBe(5);
  });
});

describe("worstCaseJobCpuSeconds", () => {
  it("worstCaseJobCpuSeconds_lifetimeTimesVcpus", () => {
    expect(worstCaseJobCpuSeconds({ sandboxLifetimeSeconds: 60, vcpus: 2 })).toBe(120);
  });
});
