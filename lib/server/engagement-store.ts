import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AchievementCounts } from "@/lib/engagement/achievements";
import type { Pause } from "@/lib/engagement/streaks";
import { StoreError } from "./learning-store";

/** Streak and achievement data (spec §37, §38) over Supabase with the server key; scoped to the user. */

export interface EngagementStore {
  profile(userId: string): Promise<{ timeZone: string; settings: unknown }>;
  dailyActivity(userId: string, since: string): Promise<Map<string, number>>;
  achievementCounts(userId: string): Promise<AchievementCounts>;
  awards(userId: string): Promise<Map<string, string>>;
  /** Records awards once; already-earned ones keep their original date. */
  award(userId: string, achievementIds: readonly string[]): Promise<void>;
  savePauses(userId: string, pauses: readonly Pause[]): Promise<void>;
  setTimeZone(userId: string, timeZone: string): Promise<void>;
}

function check<T>(operation: string, result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new StoreError(operation, result.error.message, { cause: result.error });
  return result.data;
}

export class SupabaseEngagementStore implements EngagementStore {
  constructor(private readonly db: SupabaseClient) {}

  async profile(userId: string) {
    const row = check("engagement_profile", await this.db.from("profiles").select("timezone, settings").eq("user_id", userId).single()) as { timezone: string; settings: unknown };
    return { timeZone: row.timezone, settings: row.settings };
  }

  async dailyActivity(userId: string, since: string): Promise<Map<string, number>> {
    const rows = check("daily_activity", await this.db.rpc("daily_activity", { p_user_id: userId, p_since: since })) as Array<{ day: string; active_seconds: number }>;
    return new Map(rows.map((row) => [row.day, Number(row.active_seconds)]));
  }

  async achievementCounts(userId: string): Promise<AchievementCounts> {
    const row = check("achievement_counts", await this.db.rpc("achievement_counts", { p_user_id: userId })) as Record<string, number>;
    return {
      complexityPasses: Number(row.complexity_passes),
      recognitionPasses: Number(row.recognition_passes),
      bugsFixed: Number(row.bugs_fixed),
      designsCompleted: Number(row.designs_completed),
      fastMocks: Number(row.fast_mocks),
    };
  }

  async awards(userId: string): Promise<Map<string, string>> {
    const rows = check("awards", await this.db.from("achievement_awards").select("achievement_id, awarded_at").eq("user_id", userId)) as Array<{ achievement_id: string; awarded_at: string }>;
    return new Map(rows.map((row) => [row.achievement_id, new Date(row.awarded_at).toISOString()]));
  }

  async award(userId: string, achievementIds: readonly string[]): Promise<void> {
    if (achievementIds.length === 0) return;
    check(
      "award",
      await this.db.from("achievement_awards").upsert(
        achievementIds.map((id) => ({ user_id: userId, achievement_id: id })),
        { onConflict: "user_id,achievement_id", ignoreDuplicates: true },
      ),
    );
  }

  async savePauses(userId: string, pauses: readonly Pause[]): Promise<void> {
    check("save_pauses", await this.db.rpc("set_profile_setting", { p_user_id: userId, p_key: "streak_pauses", p_value: pauses }));
  }

  async setTimeZone(userId: string, timeZone: string): Promise<void> {
    check("set_timezone", await this.db.from("profiles").update({ timezone: timeZone }).eq("user_id", userId));
  }
}
