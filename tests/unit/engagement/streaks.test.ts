import { describe, expect, it } from "vitest";
import { addDays, localDate } from "@/lib/engagement/dates";
import { computeStreak, DAILY_SECONDS, BUSY_SECONDS, HISTORY_DAYS, newPause, readPauses, streakMessage, type Pause } from "@/lib/engagement/streaks";

const TODAY = "2026-10-15";
const FULL = DAILY_SECONDS;

/** Activity on each of the given days-before-today offsets. */
function days(offsets: number[], seconds = FULL): Map<string, number> {
  return new Map(offsets.map((offset) => [addDays(TODAY, -offset), seconds]));
}

const streak = (activity: Map<string, number>, pauses: Pause[] = [], today = TODAY) => computeStreak({ activity, today, pauses });

describe("computeStreak", () => {
  it("computeStreak_noActivity_isZeroWithAllFreezes", () => {
    expect([streak(new Map()).current, streak(new Map()).freezesLeft]).toEqual([0, 2]);
  });

  it("computeStreak_todayNotDoneYet_doesNotBreakYesterdaysStreak", () => {
    expect(streak(days([1, 2, 3])).current).toBe(3);
  });

  it("computeStreak_todayDone_counts", () => {
    expect(streak(days([0, 1, 2])).current).toBe(3);
  });

  it("computeStreak_justBelowTheDailyTarget_doesNotCount_atTheTargetDoes", () => {
    expect([streak(days([1], FULL - 1)).current, streak(days([1], FULL)).current]).toEqual([0, 1]);
  });

  it("computeStreak_oneMissedDay_usesAFreezeAndKeepsTheStreak", () => {
    const result = streak(days([1, 3, 4]));

    expect([result.current, result.freezesLeft, result.frozenDays]).toEqual([3, 1, [addDays(TODAY, -2)]]);
  });

  it("computeStreak_threeMissedDaysInAMonth_twoFreezesThenReset", () => {
    expect(streak(days([1, 5, 6])).current).toBe(1);
  });

  it("computeStreak_freezesDontCarryOverBetweenMonths", () => {
    // Missed Sep 29 and Sep 30 (two September freezes), then Oct 2 uses an October freeze.
    const activity = new Map([["2026-09-28", FULL], ["2026-10-01", FULL], ["2026-10-03", FULL]]);
    const result = computeStreak({ activity, today: "2026-10-03", pauses: [] });

    expect([result.current, result.freezesLeft]).toEqual([3, 1]);
  });

  it("computeStreak_afterAReset_furtherMissedDaysSpendNoFreezes", () => {
    // Sep 26 and 27 use September's freezes, Sep 28 resets; October's misses happen with no streak.
    const result = computeStreak({ activity: new Map([["2026-09-25", FULL]]), today: TODAY, pauses: [] });

    expect([result.current, result.freezesLeft]).toEqual([0, 2]);
  });

  it("computeStreak_vacationDays_neitherCountNorBreak", () => {
    const vacation: Pause = { kind: "vacation", from: addDays(TODAY, -6), to: addDays(TODAY, -2) };

    const result = streak(days([1, 7, 8]), [vacation]);

    expect([result.current, result.freezesLeft]).toEqual([3, 2]);
  });

  it("computeStreak_busyWeek_lowersTheDailyTarget", () => {
    const busy: Pause = { kind: "busy_week", from: addDays(TODAY, -3), to: addDays(TODAY, 3) };

    expect([streak(days([1, 2], BUSY_SECONDS), [busy]).current, streak(days([1, 2], BUSY_SECONDS)).current]).toEqual([2, 0]);
  });

  it("computeStreak_longestSurvivesAReset", () => {
    const result = streak(days([1, 2, 10, 11, 12, 13, 14]));

    expect([result.current, result.longest]).toEqual([2, 5]);
  });

  it("computeStreak_activityOlderThanTheHistoryWindow_isIgnored", () => {
    expect(streak(days([HISTORY_DAYS + 5])).longest).toBe(0);
  });
});

describe("pauses", () => {
  it("newPause_backdated_isRefused", () => {
    expect(newPause("vacation", addDays(TODAY, -1), TODAY, TODAY, [])).toMatch(/not in the past/);
  });

  it("newPause_busyWeek_alwaysLastsSevenDays", () => {
    expect(newPause("busy_week", TODAY, undefined, TODAY, [])).toEqual({ kind: "busy_week", from: TODAY, to: addDays(TODAY, 6) });
  });

  it("newPause_vacationLongerThanThirtyDays_isRefused", () => {
    expect([typeof newPause("vacation", TODAY, addDays(TODAY, 29), TODAY, []), newPause("vacation", TODAY, addDays(TODAY, 30), TODAY, [])]).toEqual(["object", expect.stringMatching(/at most 30 days/)]);
  });

  it("newPause_endBeforeStart_isRefused", () => {
    expect(newPause("vacation", addDays(TODAY, 3), addDays(TODAY, 2), TODAY, [])).toMatch(/on or after/);
  });

  it("newPause_overlappingAnother_isRefused", () => {
    const existing: Pause[] = [{ kind: "vacation", from: addDays(TODAY, 2), to: addDays(TODAY, 5) }];

    expect(newPause("busy_week", TODAY, undefined, TODAY, existing)).toMatch(/overlaps/);
  });

  it("readPauses_ignoresAnythingMalformed", () => {
    const settings = { streak_pauses: [{ kind: "vacation", from: "2026-11-01", to: "2026-11-03" }, { kind: "forever", from: "x" }, "junk", { kind: "vacation", from: "2026-11-09", to: "2026-11-02" }] };

    expect(readPauses(settings)).toEqual([{ kind: "vacation", from: "2026-11-01", to: "2026-11-03" }]);
  });

  it("readPauses_noSettings_isEmpty", () => {
    expect([readPauses(null), readPauses({}), readPauses({ streak_pauses: "x" })]).toEqual([[], [], []]);
  });
});

describe("streakMessage and dates", () => {
  it("streakMessage_neverUsesGuiltCopy", () => {
    const messages = [streak(new Map()), streak(days([1, 2])), streak(days([0])), streak(days([0, 1]))].map(streakMessage);

    expect(messages.some((message) => /lose|lost|broke|fail|don't miss|shame/i.test(message))).toBe(false);
  });

  it("streakMessage_onVacation_saysPaused", () => {
    expect(streakMessage(streak(new Map(), [{ kind: "vacation", from: TODAY, to: addDays(TODAY, 2) }]))).toMatch(/paused/);
  });

  it("localDate_usesTheLearnersZone", () => {
    expect(localDate(new Date("2026-10-15T02:00:00Z"), "America/Los_Angeles")).toBe("2026-10-14");
  });

  it("localDate_unknownZone_fallsBackToUtc", () => {
    expect(localDate(new Date("2026-10-15T02:00:00Z"), "Not/AZone")).toBe("2026-10-15");
  });
});
