import { describe, expect, it } from "vitest";
import type { AchievementCounts } from "@/lib/engagement/achievements";
import type { Pause } from "@/lib/engagement/streaks";
import type { SkillState } from "@/lib/learning/mastery";
import { EngagementService } from "@/lib/server/engagement-service";
import type { EngagementStore } from "@/lib/server/engagement-store";
import { ApiError } from "@/lib/server/http";

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-15T12:00:00Z");
const ZERO: AchievementCounts = { complexityPasses: 0, recognitionPasses: 0, bugsFixed: 0, designsCompleted: 0, fastMocks: 0 };

class FakeEngagementStore implements EngagementStore {
  timeZone = "UTC";
  pauses: Pause[] = [];
  counts: AchievementCounts = ZERO;
  awarded = new Map<string, string>();
  awardCalls: string[][] = [];
  async profile() { return { timeZone: this.timeZone, settings: { streak_pauses: this.pauses, notifications: this.notifications } }; }
  async dailyActivity() { return new Map<string, number>(); }
  async achievementCounts() { return this.counts; }
  async awards() { return new Map(this.awarded); }
  async award(_userId: string, ids: readonly string[]) {
    this.awardCalls.push([...ids]);
    for (const id of ids) if (!this.awarded.has(id)) this.awarded.set(id, NOW.toISOString());
  }
  async savePauses(_userId: string, pauses: readonly Pause[]) { this.pauses = [...pauses]; }
  notifications: unknown = undefined;
  async saveNotificationPrefs(_userId: string, prefs: unknown) { this.notifications = prefs; }
  async setTimeZone(_userId: string, timeZone: string) { this.timeZone = timeZone; }
}

function service(store: FakeEngagementStore, states: SkillState[] = []) {
  return new EngagementService(store, { skillStates: async () => states }, () => NOW);
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error(`expected ApiError, got ${String(error)}`);
  return error;
}

describe("EngagementService", () => {
  it("overview_newlyEarned_isAwardedOnceAndKeptWhenProgressLaterDrops", async () => {
    const store = new FakeEngagementStore();
    store.counts = { ...ZERO, fastMocks: 1 };
    await service(store).overview(USER);
    store.counts = ZERO;

    const view = await service(store).overview(USER);

    expect([store.awardCalls, view.achievements.find((a) => a.id === "speedrunner")?.earned]).toEqual([[["speedrunner"], []], true]);
  });

  it("overview_reportsTodayInTheLearnersZone", async () => {
    const store = new FakeEngagementStore();
    store.timeZone = "Pacific/Kiritimati";

    expect((await service(store).overview(USER)).today).toBe("2026-10-16");
  });

  it("overview_invalidStoredZone_fallsBackToUtc", async () => {
    const store = new FakeEngagementStore();
    store.timeZone = "Mars/Olympus";

    expect([(await service(store).overview(USER)).timeZone, (await service(store).overview(USER)).today]).toEqual(["UTC", "2026-10-15"]);
  });

  it("addPause_backdated_is400AndSavesNothing", async () => {
    const store = new FakeEngagementStore();

    const error = await apiError(service(store).addPause(USER, { kind: "vacation", from: "2026-10-10", to: "2026-10-20" }));

    expect([error.status, store.pauses]).toEqual([400, []]);
  });

  it("endPause_runningPause_endsYesterday", async () => {
    const store = new FakeEngagementStore();
    store.pauses = [{ kind: "vacation", from: "2026-10-12", to: "2026-10-20" }];

    expect((await service(store).endPause(USER, "2026-10-12")).pauses).toEqual([{ kind: "vacation", from: "2026-10-12", to: "2026-10-14" }]);
  });

  it("endPause_upcomingPause_isRemoved", async () => {
    const store = new FakeEngagementStore();
    store.pauses = [{ kind: "busy_week", from: "2026-10-20", to: "2026-10-26" }];

    expect((await service(store).endPause(USER, "2026-10-20")).pauses).toEqual([]);
  });

  it("endPause_finishedPause_is404AndUnchanged", async () => {
    const store = new FakeEngagementStore();
    store.pauses = [{ kind: "vacation", from: "2026-10-01", to: "2026-10-05" }];

    expect([(await apiError(service(store).endPause(USER, "2026-10-01"))).status, store.pauses.length]).toEqual([404, 1]);
  });

  it("overview_remindersOnAndCardsDue_includesTheReminder", async () => {
    const store = new FakeEngagementStore();
    store.notifications = { level: "gentle", consent: true, quietStart: "00:00", quietEnd: "00:00" };

    const view = await new EngagementService(store, { skillStates: async () => [] }, () => NOW, { dueCount: async () => 2 }).overview(USER);

    expect(view.reminder).toBe("2 flashcards ready for review, about 1 minute.");
  });

  it("overview_remindersOff_hasNoReminder", async () => {
    const view = await new EngagementService(new FakeEngagementStore(), { skillStates: async () => [] }, () => NOW, { dueCount: async () => 2 }).overview(USER);

    expect(view.reminder).toBeUndefined();
  });

  it("saveNotificationPrefs_withoutConsent_isRejectedAndNotSaved", async () => {
    const store = new FakeEngagementStore();

    await expect(service(store).saveNotificationPrefs(USER, { level: "normal", consent: false, quietStart: "21:00", quietEnd: "08:00" })).rejects.toThrow();
    expect(store.notifications).toBeUndefined();
  });

  it("setTimeZone_unknownZone_is400", async () => {
    expect((await apiError(service(new FakeEngagementStore()).setTimeZone(USER, "Mars/Olympus"))).code).toBe("invalid_timezone");
  });
});
