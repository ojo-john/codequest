import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { StoreError } from "./learning-store";

/** Persistence for personal flashcards (spec §51) with the server key; every query is scoped to the user. */

export interface Flashcard {
  readonly id: string;
  readonly contentId: string;
  readonly front: string;
  readonly back: string;
  readonly box: number;
  readonly dueAt: string;
}

export interface FlashcardStore {
  list(userId: string): Promise<Flashcard[]>;
  get(userId: string, id: string): Promise<Flashcard | undefined>;
  count(userId: string): Promise<number>;
  dueCount(userId: string, now: Date): Promise<number>;
  create(userId: string, card: { contentId: string; front: string; back: string }): Promise<Flashcard>;
  schedule(userId: string, id: string, box: number, dueAt: Date): Promise<boolean>;
  remove(userId: string, id: string): Promise<boolean>;
}

const COLUMNS = "id, content_id, front, back, box, due_at";
type Row = { id: string; content_id: string; front: string; back: string; box: number; due_at: string };
const toCard = (row: Row): Flashcard => ({ id: row.id, contentId: row.content_id, front: row.front, back: row.back, box: Number(row.box), dueAt: new Date(row.due_at).toISOString() });
const MAX_LISTED = 500;

function check<T>(operation: string, result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new StoreError(operation, result.error.message, { cause: result.error });
  return result.data;
}

export class SupabaseFlashcardStore implements FlashcardStore {
  constructor(private readonly db: SupabaseClient) {}

  async list(userId: string) {
    const rows = check("flashcards_list", await this.db.from("flashcards").select(COLUMNS).eq("user_id", userId).order("due_at").limit(MAX_LISTED));
    return (rows as Row[]).map(toCard);
  }

  async get(userId: string, id: string) {
    const row = check("flashcards_get", await this.db.from("flashcards").select(COLUMNS).eq("user_id", userId).eq("id", id).maybeSingle());
    return row ? toCard(row as Row) : undefined;
  }

  async count(userId: string) {
    const result = await this.db.from("flashcards").select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (result.error) throw new StoreError("flashcards_count", result.error.message, { cause: result.error });
    return result.count ?? 0;
  }

  async dueCount(userId: string, now: Date) {
    const result = await this.db.from("flashcards").select("id", { count: "exact", head: true }).eq("user_id", userId).lte("due_at", now.toISOString());
    if (result.error) throw new StoreError("flashcards_due", result.error.message, { cause: result.error });
    return result.count ?? 0;
  }

  async create(userId: string, card: { contentId: string; front: string; back: string }) {
    const row = check("flashcards_create", await this.db.from("flashcards").insert({ user_id: userId, content_id: card.contentId, front: card.front, back: card.back }).select(COLUMNS).single());
    return toCard(row as Row);
  }

  async schedule(userId: string, id: string, box: number, dueAt: Date) {
    const rows = check("flashcards_schedule", await this.db.from("flashcards").update({ box, due_at: dueAt.toISOString(), updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", id).select("id"));
    return (rows ?? []).length > 0;
  }

  async remove(userId: string, id: string) {
    const rows = check("flashcards_remove", await this.db.from("flashcards").delete().eq("user_id", userId).eq("id", id).select("id"));
    return (rows ?? []).length > 0;
  }
}
