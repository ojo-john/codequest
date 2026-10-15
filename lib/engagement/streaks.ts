import { z } from "zod";
import { addDays, daysBetween, isLocalDate, monthOf } from "./dates";

/**
 * Streak rules (spec §37), "streak-v1". Pure: the same activity, pauses and date always give the
 * same streak.
 *
 *  - A day counts once it has DAILY_SECONDS of graded active time, in the learner's timezone
 *    (BUSY_SECONDS during a busy week).
 *  - A missed day uses a freeze automatically while one is left that calendar month (two a
 *    month); after that, a missed day resets the streak. Freezes don't carry over.
 *  - Vacation days are paused: they neither count nor break the streak.
 *  - Today never breaks the streak; it only counts once done.
 *  - Pauses can't be backdated, so they can't repair a broken streak after the fact.
 */

export const STREAK_RULES_VERSION = "streak-v1";
export const DAILY_SECONDS = 5 * 60;
export const BUSY_SECONDS = 2 * 60;
export const FREEZES_PER_MONTH = 2;
export const BUSY_WEEK_DAYS = 7;
export const MAX_VACATION_DAYS = 30;
/** How far back the streak is computed. */
export const HISTORY_DAYS = 400;
const MAX_PAUSES = 24;

const localDateSchema = z.string().refine(isLocalDate, "a date as YYYY-MM-DD");

export const pauseSchema = z
  .object({ kind: z.enum(["vacation", "busy_week"]), from: localDateSchema, to: localDateSchema })
  .strict()
  .refine((pause) => pause.from <= pause.to, "a pause ends on or after it starts");

export type Pause = z.infer<typeof pauseSchema>;

/** Profile settings may be edited directly (RLS); anything unreadable is ignored, never trusted. */
export function readPauses(settings: unknown): Pause[] {
  const raw = (settings as { streak_pauses?: unknown } | null)?.streak_pauses;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = pauseSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  }).slice(-MAX_PAUSES);
}

/** A new pause, validated against today: no backdating, bounded length, no overlap with another. */
export function newPause(kind: Pause["kind"], from: string, to: string | undefined, today: string, existing: readonly Pause[]): Pause | string {
  if (!isLocalDate(from)) return "Choose a start date.";
  if (from < today) return "Pauses can start today or later, not in the past.";
  const end = kind === "busy_week" ? addDays(from, BUSY_WEEK_DAYS - 1) : to;
  if (end === undefined || !isLocalDate(end) || end < from) return "Choose an end date on or after the start.";
  if (kind === "vacation" && daysBetween(from, end) + 1 > MAX_VACATION_DAYS) return `A vacation pause lasts at most ${MAX_VACATION_DAYS} days.`;
  if (existing.some((pause) => pause.from <= end && from <= pause.to)) return "That overlaps a pause you already have.";
  if (existing.length >= MAX_PAUSES) return "You have too many pauses saved; remove an old one first.";
  return { kind, from, to: end };
}

export interface StreakInput {
  /** Active seconds per local date (days with none may be absent). */
  readonly activity: ReadonlyMap<string, number>;
  readonly today: string;
  readonly pauses: readonly Pause[];
}

export interface Streak {
  readonly rulesVersion: typeof STREAK_RULES_VERSION;
  readonly current: number;
  readonly longest: number;
  readonly todaySeconds: number;
  readonly todayTarget: number;
  readonly todayDone: boolean;
  readonly freezesLeft: number;
  /** Days kept by a freeze, most recent first (up to 10). */
  readonly frozenDays: readonly string[];
  readonly activePause?: Pause;
}

const pauseOn = (pauses: readonly Pause[], date: string, kind: Pause["kind"]) => pauses.find((pause) => pause.kind === kind && pause.from <= date && date <= pause.to);

export function computeStreak(input: StreakInput): Streak {
  const start = addDays(input.today, -(HISTORY_DAYS - 1));
  const activeDays = [...input.activity.keys()].filter((date) => date >= start && date <= input.today).sort();
  const freezesUsed = new Map<string, number>();
  const frozen: string[] = [];
  let current = 0;
  let longest = 0;

  for (let date = activeDays[0] ?? input.today; date <= input.today; date = addDays(date, 1)) {
    const seconds = input.activity.get(date) ?? 0;
    const target = pauseOn(input.pauses, date, "busy_week") ? BUSY_SECONDS : DAILY_SECONDS;
    if (seconds >= target) {
      current++;
      longest = Math.max(longest, current);
    } else if (date === input.today || pauseOn(input.pauses, date, "vacation")) {
      // Today isn't over; vacation days are paused.
    } else if (current > 0 && (freezesUsed.get(monthOf(date)) ?? 0) < FREEZES_PER_MONTH) {
      freezesUsed.set(monthOf(date), (freezesUsed.get(monthOf(date)) ?? 0) + 1);
      frozen.push(date);
    } else {
      current = 0;
    }
  }

  const todaySeconds = input.activity.get(input.today) ?? 0;
  const todayTarget = pauseOn(input.pauses, input.today, "busy_week") ? BUSY_SECONDS : DAILY_SECONDS;
  const activePause = input.pauses.find((pause) => pause.from <= input.today && input.today <= pause.to);
  return {
    rulesVersion: STREAK_RULES_VERSION,
    current,
    longest,
    todaySeconds,
    todayTarget,
    todayDone: todaySeconds >= todayTarget,
    freezesLeft: FREEZES_PER_MONTH - (freezesUsed.get(monthOf(input.today)) ?? 0),
    frozenDays: frozen.reverse().slice(0, 10),
    ...(activePause && { activePause }),
  };
}

/** Supportive status copy (spec §37): never guilt, always a next step. */
export function streakMessage(streak: Streak): string {
  if (streak.activePause?.kind === "vacation") return "Your streak is paused for vacation. Enjoy the break.";
  if (streak.todayDone) return streak.current === 1 ? "Day one done. Nice start." : `Done for today: ${streak.current} days running.`;
  const minutes = Math.ceil((streak.todayTarget - streak.todaySeconds) / 60);
  if (streak.current === 0) return `About ${minutes} minute${minutes === 1 ? "" : "s"} of practice today starts a streak.`;
  return `About ${minutes} more minute${minutes === 1 ? "" : "s"} today keeps your ${streak.current}-day streak going.`;
}
