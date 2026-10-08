import { describe, expect, it } from "vitest";
import { loadExecutionBudgetConfig, staleBefore, usageReport, type UsageSnapshot } from "@/lib/execution/budget";
import { silentLogger } from "@/lib/observability/log";
import { UsageService } from "@/lib/server/usage-service";
import { formatBytes, formatCpuTime, percentUsed, usageTone } from "@/lib/usage/format";

const NOW = new Date("2026-10-15T12:00:00Z");
const CONFIG = loadExecutionBudgetConfig({});
const SNAPSHOT: UsageSnapshot = { jobsToday: 3, jobsThisMonth: 40, settledCpuSecondsThisMonth: 100, reservedCpuSeconds: 60, activeJobsForUser: 1 };

describe("usageReport", () => {
  it("usageReport_cpu_countsSettledPlusRunningReservations", () => {
    const report = usageReport(SNAPSHOT, CONFIG, NOW);

    expect([report.cpuSecondsThisMonth.used, report.cpuSecondsThisMonth.limit]).toEqual([160, 5 * 3600 * 0.8]);
  });

  it("usageReport_resets_atTheNextUtcDayAndMonth", () => {
    const report = usageReport(SNAPSHOT, CONFIG, NOW);

    expect([report.jobsToday.resetsAt.toISOString(), report.jobsThisMonth.resetsAt.toISOString()]).toEqual(["2026-10-16T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
  });

  it("usageReport_pauseAlreadyOver_isNotReported", () => {
    expect(usageReport({ ...SNAPSHOT, pausedUntil: new Date("2026-10-15T11:00:00Z") }, CONFIG, NOW).pausedUntil).toBeUndefined();
  });

  it("usageReport_pauseInTheFuture_isReported", () => {
    const until = new Date("2026-10-16T00:00:00Z");

    expect(usageReport({ ...SNAPSHOT, pausedUntil: until }, CONFIG, NOW).pausedUntil).toEqual(until);
  });
});

describe("staleBefore", () => {
  it("staleBefore_default_isFiveMinutesAgo", () => {
    expect(staleBefore(CONFIG, NOW).toISOString()).toBe("2026-10-15T11:55:00.000Z");
  });

  it("loadExecutionBudgetConfig_staleJobShorterThanTheRouteDuration_isRejected", () => {
    expect(() => loadExecutionBudgetConfig({ EXECUTION_STALE_JOB_SECONDS: "60" })).toThrow();
  });
});

describe("UsageService", () => {
  function service(sizeBytes: () => Promise<number>) {
    const calls: Date[] = [];
    const ledger = { usage: async (_user: string, _now: Date, cutoff: Date) => (calls.push(cutoff), SNAPSHOT) };
    return { calls, usage: new UsageService({ ledger, budget: CONFIG, database: { sizeBytes }, databaseQuotaBytes: 500, logger: silentLogger, clock: () => NOW }) };
  }

  it("usage_databaseSizeFails_stillReportsExecutionUsage", async () => {
    const { usage } = service(async () => {
      throw new Error("db down");
    });

    const view = await usage.usage("u");

    expect([view.database, view.execution.jobsToday.used]).toEqual([undefined, 3]);
  });

  it("usage_reclaimsWithTheSameCutoffAsAdmission", async () => {
    const { usage, calls } = service(async () => 10);

    await usage.usage("u");

    expect(calls).toEqual([staleBefore(CONFIG, NOW)]);
  });

  it("usage_databaseSize_isReportedAgainstTheQuota", async () => {
    const { usage } = service(async () => 10);

    expect((await usage.usage("u")).database).toEqual({ usedBytes: 10, limitBytes: 500 });
  });
});

describe("format", () => {
  it.each([
    [0, "0 s"],
    [59.4, "59 s"],
    [90, "2 min"],
    [3600, "1 h"],
    [14_400, "4 h"],
    [3900, "1 h 5 min"],
  ])("formatCpuTime_%s_is_%s", (seconds, text) => {
    expect(formatCpuTime(seconds)).toBe(text);
  });

  it.each([
    [512, "1 KB"],
    [5 * 1024 * 1024, "5.0 MB"],
    [500 * 1024 * 1024, "500 MB"],
  ])("formatBytes_%s_is_%s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it("percentUsed_overTheLimit_isClampedTo100", () => {
    expect([percentUsed(150, 100), percentUsed(0, 100), percentUsed(5, 0)]).toEqual([100, 0, 100]);
  });

  it("usageTone_bands_areOkThenWarningAt80ThenFull", () => {
    expect([usageTone(79), usageTone(80), usageTone(100)]).toEqual(["ok", "warning", "full"]);
  });
});
