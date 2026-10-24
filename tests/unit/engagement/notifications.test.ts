import { describe, expect, it } from "vitest";
import { localTime } from "@/lib/engagement/dates";
import { DEFAULT_PREFS, inQuietHours, notificationPrefsSchema, readNotificationPrefs, reminder, type NotificationPrefs } from "@/lib/engagement/notifications";
import { nextReview } from "@/lib/learning/flashcards";

const NOW = new Date("2026-10-24T12:00:00Z");
const ON: NotificationPrefs = { level: "gentle", consent: true, quietStart: "21:00", quietEnd: "08:00" };
const base = { prefs: ON, localTime: "12:00", dueConcepts: 0, dueCards: 0 };

describe("reminder", () => {
  it("reminder_off_saysNothingEvenWithReviewsDue", () => {
    expect(reminder({ ...base, prefs: { ...ON, level: "off" }, dueConcepts: 3 })).toBeUndefined();
  });

  it("reminder_withoutConsent_saysNothing", () => {
    expect(reminder({ ...base, prefs: { ...ON, level: "normal", consent: false }, dueConcepts: 3 })).toBeUndefined();
  });

  it("reminder_duringQuietHours_saysNothing", () => {
    expect(reminder({ ...base, localTime: "23:30", dueConcepts: 3 })).toBeUndefined();
  });

  it("reminder_reviewsDue_givesTheCountAndAnEstimate", () => {
    expect(reminder({ ...base, dueConcepts: 3, dueCards: 2 })).toBe("3 concepts and 2 flashcards ready for review, about 7 minutes.");
  });

  it("reminder_gentleWithNothingDue_saysNothing", () => {
    expect(reminder({ ...base, streakNudge: "Keep going" })).toBeUndefined();
  });

  it("reminder_normalWithNothingDue_usesTheSupportiveStreakNudge", () => {
    expect(reminder({ ...base, prefs: { ...ON, level: "normal" }, streakNudge: "About 5 minutes today starts a streak." })).toBe("About 5 minutes today starts a streak.");
  });

  it("reminder_oneCard_isAtLeastOneMinute", () => {
    expect(reminder({ ...base, dueCards: 1 })).toBe("1 flashcard ready for review, about 1 minute.");
  });
});

describe("quiet hours and preferences", () => {
  it("inQuietHours_wrapsPastMidnight", () => {
    expect(["20:59", "21:00", "23:59", "00:00", "07:59", "08:00"].map((time) => inQuietHours(time, ON))).toEqual([false, true, true, true, true, false]);
  });

  it("inQuietHours_sameStartAndEnd_isNeverQuiet", () => {
    expect(inQuietHours("03:00", { quietStart: "00:00", quietEnd: "00:00" })).toBe(false);
  });

  it("prefs_remindersWithoutConsent_areRejected", () => {
    expect(notificationPrefsSchema.safeParse({ ...ON, consent: false }).success).toBe(false);
  });

  it("prefs_offWithoutConsent_isFine", () => {
    expect(notificationPrefsSchema.safeParse({ ...ON, level: "off", consent: false }).success).toBe(true);
  });

  it("readNotificationPrefs_malformedSettings_fallBackToOff", () => {
    expect([readNotificationPrefs(null), readNotificationPrefs({ notifications: { level: "loud" } })]).toEqual([DEFAULT_PREFS, DEFAULT_PREFS]);
  });

  it("localTime_usesTheLearnersZone", () => {
    expect(localTime(NOW, "Asia/Tokyo")).toBe("21:00");
  });
});

describe("nextReview (leitner-v1)", () => {
  const days = (date: Date) => (date.getTime() - NOW.getTime()) / 86_400_000;

  it("nextReview_knewIt_movesUpABoxWithItsInterval", () => {
    const next = nextReview(2, true, NOW);

    expect([next.box, days(next.dueAt)]).toEqual([3, 4]);
  });

  it("nextReview_knewItInTheLastBox_staysThere", () => {
    const next = nextReview(5, true, NOW);

    expect([next.box, days(next.dueAt)]).toEqual([5, 16]);
  });

  it("nextReview_notYet_goesBackToBoxOneForTomorrow", () => {
    const next = nextReview(4, false, NOW);

    expect([next.box, days(next.dueAt)]).toEqual([1, 1]);
  });
});
