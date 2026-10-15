import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Story, StoryInput } from "@/lib/behavioral/stories";
import { StoreError } from "./learning-store";

/** Persistence for behavioral stories (spec §35) with the server key; every query is scoped to the user. */

export interface StoryStore {
  list(userId: string): Promise<Story[]>;
  get(userId: string, id: string): Promise<Story | undefined>;
  count(userId: string): Promise<number>;
  create(userId: string, story: StoryInput): Promise<Story>;
  /** False when the story doesn't exist or isn't the user's. */
  update(userId: string, id: string, story: StoryInput): Promise<Story | undefined>;
  remove(userId: string, id: string): Promise<boolean>;
}

const COLUMNS = "id, title, competencies, situation, task, action, result, learned, updated_at";

interface Row {
  id: string;
  title: string;
  competencies: string[];
  situation: string;
  task: string;
  action: string;
  result: string;
  learned: string;
  updated_at: string;
}

function toStory(row: Row): Story {
  return {
    id: row.id,
    title: row.title,
    competencies: row.competencies as Story["competencies"],
    situation: row.situation,
    task: row.task,
    action: row.action,
    result: row.result,
    learned: row.learned,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function check<T>(operation: string, result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new StoreError(operation, result.error.message, { cause: result.error });
  return result.data;
}

export class SupabaseStoryStore implements StoryStore {
  constructor(private readonly db: SupabaseClient) {}

  async list(userId: string): Promise<Story[]> {
    const rows = check("stories_list", await this.db.from("behavioral_stories").select(COLUMNS).eq("user_id", userId).order("updated_at", { ascending: false }));
    return (rows as Row[]).map(toStory);
  }

  async get(userId: string, id: string): Promise<Story | undefined> {
    const row = check("stories_get", await this.db.from("behavioral_stories").select(COLUMNS).eq("user_id", userId).eq("id", id).maybeSingle());
    return row ? toStory(row as Row) : undefined;
  }

  async count(userId: string): Promise<number> {
    const result = await this.db.from("behavioral_stories").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (result.error) throw new StoreError("stories_count", result.error.message, { cause: result.error });
    return result.count ?? 0;
  }

  async create(userId: string, story: StoryInput): Promise<Story> {
    const row = check("stories_create", await this.db.from("behavioral_stories").insert({ user_id: userId, ...story }).select(COLUMNS).single());
    return toStory(row as Row);
  }

  async update(userId: string, id: string, story: StoryInput): Promise<Story | undefined> {
    const rows = check(
      "stories_update",
      await this.db.from("behavioral_stories").update({ ...story, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", id).select(COLUMNS),
    );
    const [row] = (rows ?? []) as Row[];
    return row ? toStory(row) : undefined;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const rows = check("stories_remove", await this.db.from("behavioral_stories").delete().eq("user_id", userId).eq("id", id).select("id"));
    return (rows ?? []).length > 0;
  }
}
