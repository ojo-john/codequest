import { z } from "zod";

/**
 * Reminder preferences and copy (spec §49), "reminders-v1". Off unless the learner consents.
 * Gentle: only when reviews are ready. Normal: also a supportive nudge to keep a streak. Never
 * during quiet hours (in the learner's time zone), never guilt. Delivery is in-app for now; email
 * or push needs a provider the owner sets up.
 */

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const notificationPrefsSchema = z
  .object({
    level: z.enum(["off", "gentle", "normal"]),
    consent: z.boolean(),
    quietStart: z.string().regex(TIME),
    quietEnd: z.string().regex(TIME),
  })
  .strict()
  .refine((prefs) => prefs.level === "off" || prefs.consent, "Reminders need your consent; choose Off otherwise.");

export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>;

export const DEFAULT_PREFS: NotificationPrefs = { level: "off", consent: false, quietStart: "21:00", quietEnd: "08:00" };

/** Settings may be edited directly (RLS); anything unreadable falls back to "off". */
export function readNotificationPrefs(settings: unknown): NotificationPrefs {
  const parsed = notificationPrefsSchema.safeParse((settings as { notifications?: unknown } | null)?.notifications);
  return parsed.success ? parsed.data : DEFAULT_PREFS;
}

/** Whether a local "HH:MM" time falls in quiet hours (which may wrap past midnight). */
export function inQuietHours(time: string, prefs: Pick<NotificationPrefs, "quietStart" | "quietEnd">): boolean {
  if (prefs.quietStart === prefs.quietEnd) return false;
  return prefs.quietStart < prefs.quietEnd ? time >= prefs.quietStart && time < prefs.quietEnd : time >= prefs.quietStart || time < prefs.quietEnd;
}

/** Rough review cost, for the "about N minutes" estimate. */
const MINUTES_PER_CONCEPT = 2;
const MINUTES_PER_CARD = 0.5;

export interface ReminderInput {
  readonly prefs: NotificationPrefs;
  readonly localTime: string;
  readonly dueConcepts: number;
  readonly dueCards: number;
  /** Supportive streak copy (lib/engagement/streaks), used by "normal" when nothing is due. */
  readonly streakNudge?: string;
}

export function reminder(input: ReminderInput): string | undefined {
  const { prefs } = input;
  if (prefs.level === "off" || !prefs.consent || inQuietHours(input.localTime, prefs)) return undefined;
  const parts: string[] = [];
  if (input.dueConcepts > 0) parts.push(`${input.dueConcepts} concept${input.dueConcepts === 1 ? "" : "s"}`);
  if (input.dueCards > 0) parts.push(`${input.dueCards} flashcard${input.dueCards === 1 ? "" : "s"}`);
  if (parts.length > 0) {
    const minutes = Math.max(1, Math.ceil(input.dueConcepts * MINUTES_PER_CONCEPT + input.dueCards * MINUTES_PER_CARD));
    return `${parts.join(" and ")} ready for review, about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return prefs.level === "normal" ? input.streakNudge : undefined;
}
