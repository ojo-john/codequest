import "server-only";
import { z } from "zod";
import { evaluateAchievements, type AchievementProgress } from "@/lib/engagement/achievements";
import { addDays, isTimeZone, localDate } from "@/lib/engagement/dates";
import { computeStreak, HISTORY_DAYS, newPause, readPauses, streakMessage, type Pause, type Streak } from "@/lib/engagement/streaks";
import type { LearningStore } from "./learning-store";
import type { EngagementStore } from "./engagement-store";
import { ApiError } from "./http";

/** Streaks and achievements (spec §37, §38), computed on read from the learner's own records. */

export const addPauseSchema = z
  .object({ kind: z.enum(["vacation", "busy_week"]), from: z.string().max(10), to: z.string().max(10).optional() })
  .strict();
export const timeZoneSchema = z.object({ timeZone: z.string().min(1).max(64) }).strict();

export interface EngagementView {
  readonly timeZone: string;
  readonly today: string;
  readonly streak: Streak;
  readonly message: string;
  readonly pauses: readonly Pause[];
  readonly achievements: ReadonlyArray<AchievementProgress & { readonly awardedAt?: string }>;
}

export class EngagementService {
  private readonly clock: () => Date;

  constructor(
    private readonly store: EngagementStore,
    private readonly learning: Pick<LearningStore, "skillStates">,
    clock?: () => Date,
  ) {
    this.clock = clock ?? (() => new Date());
  }

  async overview(userId: string): Promise<EngagementView> {
    const now = this.clock();
    const { timeZone, settings } = await this.store.profile(userId);
    const today = localDate(now, timeZone);
    const pauses = readPauses(settings);
    const [activity, counts, states, awards] = await Promise.all([
      this.store.dailyActivity(userId, addDays(today, -(HISTORY_DAYS - 1))),
      this.store.achievementCounts(userId),
      this.learning.skillStates(userId),
      this.store.awards(userId),
    ]);
    const streak = computeStreak({ activity, today, pauses });
    const evaluated = evaluateAchievements(counts, states, now);
    const fresh = evaluated.filter((achievement) => achievement.earned && !awards.has(achievement.id)).map((achievement) => achievement.id);
    await this.store.award(userId, fresh);
    const awardedNow = now.toISOString();
    return {
      timeZone: isTimeZone(timeZone) ? timeZone : "UTC",
      today,
      streak,
      message: streakMessage(streak),
      pauses: pauses.filter((pause) => pause.to >= today),
      // Earned once, kept: a skill going rusty later doesn't take an award away.
      achievements: evaluated.map((achievement) => {
        const awardedAt = awards.get(achievement.id) ?? (fresh.includes(achievement.id) ? awardedNow : undefined);
        return awardedAt ? { ...achievement, earned: true, progress: achievement.target, awardedAt } : achievement;
      }),
    };
  }

  async addPause(userId: string, request: z.infer<typeof addPauseSchema>): Promise<{ pauses: Pause[] }> {
    const { timeZone, settings } = await this.store.profile(userId);
    const today = localDate(this.clock(), timeZone);
    const existing = readPauses(settings);
    const pause = newPause(request.kind, request.from, request.to, today, existing);
    if (typeof pause === "string") throw new ApiError(400, "invalid_pause", pause);
    const pauses = [...existing, pause].sort((a, b) => a.from.localeCompare(b.from));
    await this.store.savePauses(userId, pauses);
    return { pauses };
  }

  /** Cancels a pause that hasn't started, or ends a running one yesterday; past pauses stay as they were. */
  async endPause(userId: string, from: string): Promise<{ pauses: Pause[] }> {
    const { timeZone, settings } = await this.store.profile(userId);
    const today = localDate(this.clock(), timeZone);
    const existing = readPauses(settings);
    const target = existing.find((pause) => pause.from === from && pause.to >= today);
    if (!target) throw new ApiError(404, "not_found", "There's no current or upcoming pause starting then.");
    const pauses = existing.flatMap((pause) => {
      if (pause !== target) return [pause];
      if (pause.from >= today) return [];
      return [{ ...pause, to: addDays(today, -1) }];
    });
    await this.store.savePauses(userId, pauses);
    return { pauses };
  }

  async setTimeZone(userId: string, timeZone: string): Promise<{ timeZone: string }> {
    if (!isTimeZone(timeZone)) throw new ApiError(400, "invalid_timezone", "That isn't a time zone this server recognises.");
    await this.store.setTimeZone(userId, timeZone);
    return { timeZone };
  }
}
