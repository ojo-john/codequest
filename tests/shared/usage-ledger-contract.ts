import { beforeEach, describe, expect, it } from "vitest";
import type { AdmissionDecision, UsageSnapshot } from "@/lib/execution/budget";
import type { ExecutionUsageLedger } from "@/lib/execution/usage-ledger";

/**
 * Behaviour every {@link ExecutionUsageLedger} must have. Run against the in-memory ledger
 * (unit tests) and the Supabase ledger (integration tests) so the two can't drift apart.
 */
export interface LedgerFixture {
  readonly ledger: ExecutionUsageLedger;
  /** Ids of users the ledger may reference (must exist where the store enforces it). */
  readonly userIds: readonly [string, string];
}

const NOW = new Date("2026-10-15T12:00:00Z");
const ADMIT = (): AdmissionDecision => ({ admitted: true });
/** A cutoff no test job is older than, so nothing is reclaimed unless a test says so. */
const NOTHING_STALE = new Date("2000-01-01T00:00:00Z");

function observe(ledger: ExecutionUsageLedger, userId: string, now = NOW): Promise<UsageSnapshot> {
  let seen: UsageSnapshot | undefined;
  return ledger
    .admit({ jobId: crypto.randomUUID(), userId, now, reserveCpuSeconds: 60, staleBefore: NOTHING_STALE }, (usage) => {
      seen = usage;
      return { admitted: false, reason: "daily_job_limit" };
    })
    .then(() => {
      if (seen === undefined) throw new Error("decide was not called");
      return seen;
    });
}

export function usageLedgerContract(name: string, setup: () => Promise<LedgerFixture>): void {
  describe(`${name} (ExecutionUsageLedger contract)`, () => {
    let fixture: LedgerFixture;

    beforeEach(async () => {
      fixture = await setup();
    });

    it("admit_sameJobIdTwice_throws", async () => {
      const request = { jobId: crypto.randomUUID(), userId: fixture.userIds[0], now: NOW, reserveCpuSeconds: 60, staleBefore: NOTHING_STALE };
      await fixture.ledger.admit(request, ADMIT);

      await expect(fixture.ledger.admit(request, ADMIT)).rejects.toThrow(/already admitted/);
    });

    it("settle_unknownJob_throws", async () => {
      await expect(fixture.ledger.settle(crypto.randomUUID(), 1)).rejects.toThrow(/never admitted/);
    });

    it("admit_rejectedDecision_recordsNothing", async () => {
      await observe(fixture.ledger, fixture.userIds[0]);

      const usage = await observe(fixture.ledger, fixture.userIds[0]);

      expect([usage.jobsToday, usage.reservedCpuSeconds]).toEqual([0, 0]);
    });

    it("admit_admittedJob_reservesUntilSettled", async () => {
      await fixture.ledger.admit({ jobId: crypto.randomUUID(), userId: fixture.userIds[0], now: NOW, reserveCpuSeconds: 60, staleBefore: NOTHING_STALE }, ADMIT);

      const usage = await observe(fixture.ledger, fixture.userIds[0]);

      expect(usage).toMatchObject({ jobsToday: 1, jobsThisMonth: 1, reservedCpuSeconds: 60, settledCpuSecondsThisMonth: 0, activeJobsForUser: 1 });
    });

    it("admit_otherUsersActiveJob_countsGloballyButNotForThisUser", async () => {
      await fixture.ledger.admit({ jobId: crypto.randomUUID(), userId: fixture.userIds[1], now: NOW, reserveCpuSeconds: 60, staleBefore: NOTHING_STALE }, ADMIT);

      const usage = await observe(fixture.ledger, fixture.userIds[0]);

      expect([usage.jobsToday, usage.reservedCpuSeconds, usage.activeJobsForUser]).toEqual([1, 60, 0]);
    });

    it("settle_twice_keepsFirstValueAndReleasesReservation", async () => {
      const jobId = crypto.randomUUID();
      await fixture.ledger.admit({ jobId, userId: fixture.userIds[0], now: NOW, reserveCpuSeconds: 60, staleBefore: NOTHING_STALE }, ADMIT);
      await fixture.ledger.settle(jobId, 4.5);
      await fixture.ledger.settle(jobId, 500);

      const usage = await observe(fixture.ledger, fixture.userIds[0]);

      expect([usage.settledCpuSecondsThisMonth, usage.reservedCpuSeconds, usage.activeJobsForUser]).toEqual([4.5, 0, 0]);
    });

    it("snapshot_jobFromYesterday_countsForMonthNotDay", async () => {
      const yesterday = new Date("2026-10-14T23:59:59Z");
      const jobId = crypto.randomUUID();
      await fixture.ledger.admit({ jobId, userId: fixture.userIds[0], now: yesterday, reserveCpuSeconds: 60, staleBefore: NOTHING_STALE }, ADMIT);
      await fixture.ledger.settle(jobId, 3);

      const usage = await observe(fixture.ledger, fixture.userIds[0]);

      expect([usage.jobsToday, usage.jobsThisMonth, usage.settledCpuSecondsThisMonth]).toEqual([0, 1, 3]);
    });

    it("snapshot_jobFromLastMonth_isNotCounted", async () => {
      const jobId = crypto.randomUUID();
      await fixture.ledger.admit({ jobId, userId: fixture.userIds[0], now: new Date("2026-09-30T23:00:00Z"), reserveCpuSeconds: 60, staleBefore: NOTHING_STALE }, ADMIT);
      await fixture.ledger.settle(jobId, 3);

      const usage = await observe(fixture.ledger, fixture.userIds[0]);

      expect([usage.jobsThisMonth, usage.settledCpuSecondsThisMonth]).toEqual([0, 0]);
    });

    it("pauseUntil_earlierThanExistingPause_keepsLaterPause", async () => {
      const later = new Date("2026-10-20T00:00:00Z");
      await fixture.ledger.pauseUntil(later);
      await fixture.ledger.pauseUntil(new Date("2026-10-16T00:00:00Z"));

      const usage = await observe(fixture.ledger, fixture.userIds[0]);

      expect(usage.pausedUntil?.toISOString()).toBe(later.toISOString());
    });

    it("admit_unsettledJobOlderThanTheCutoff_isSettledAtItsReservationAndFreesTheSlot", async () => {
      const abandoned = new Date("2026-10-15T11:00:00Z");
      await fixture.ledger.admit({ jobId: crypto.randomUUID(), userId: fixture.userIds[0], now: abandoned, reserveCpuSeconds: 60, staleBefore: NOTHING_STALE }, ADMIT);
      let seen: UsageSnapshot | undefined;

      await fixture.ledger.admit({ jobId: crypto.randomUUID(), userId: fixture.userIds[0], now: NOW, reserveCpuSeconds: 60, staleBefore: new Date("2026-10-15T11:55:00Z") }, (usage) => {
        seen = usage;
        return { admitted: false, reason: "daily_job_limit" };
      });

      expect([seen?.activeJobsForUser, seen?.reservedCpuSeconds, seen?.settledCpuSecondsThisMonth]).toEqual([0, 0, 60]);
    });

    it("admit_unsettledJobNewerThanTheCutoff_keepsItsReservation", async () => {
      await fixture.ledger.admit({ jobId: crypto.randomUUID(), userId: fixture.userIds[0], now: NOW, reserveCpuSeconds: 60, staleBefore: NOTHING_STALE }, ADMIT);

      const usage = await fixture.ledger.usage(fixture.userIds[0], NOW, new Date("2026-10-15T11:55:00Z"));

      expect([usage.activeJobsForUser, usage.reservedCpuSeconds]).toEqual([1, 60]);
    });

    it("reclaim_settledJob_keepsItsMeasuredValue", async () => {
      const jobId = crypto.randomUUID();
      await fixture.ledger.admit({ jobId, userId: fixture.userIds[0], now: new Date("2026-10-15T11:00:00Z"), reserveCpuSeconds: 60, staleBefore: NOTHING_STALE }, ADMIT);
      await fixture.ledger.settle(jobId, 2.5);

      const usage = await fixture.ledger.usage(fixture.userIds[0], NOW, NOW);

      expect(usage.settledCpuSecondsThisMonth).toBe(2.5);
    });

    it("usage_readsTheSnapshotWithoutRecordingAJob", async () => {
      await fixture.ledger.usage(fixture.userIds[0], NOW, NOTHING_STALE);

      const usage = await fixture.ledger.usage(fixture.userIds[0], NOW, NOTHING_STALE);

      expect([usage.jobsToday, usage.jobsThisMonth]).toEqual([0, 0]);
    });

    it("admit_concurrentRequestsWithOneSlot_admitsExactlyOne", async () => {
      const oneActiveJobPerUser = (usage: UsageSnapshot): AdmissionDecision =>
        usage.activeJobsForUser >= 1 ? { admitted: false, reason: "concurrent_job_limit" } : { admitted: true };

      const decisions = await Promise.all(
        Array.from({ length: 8 }, () =>
          fixture.ledger.admit({ jobId: crypto.randomUUID(), userId: fixture.userIds[0], now: NOW, reserveCpuSeconds: 60, staleBefore: NOTHING_STALE }, oneActiveJobPerUser),
        ),
      );

      expect(decisions.filter((decision) => decision.admitted)).toHaveLength(1);
    });
  });
}
