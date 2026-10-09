import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { SkillDimension } from "@/lib/learning/mastery";
import { StoreError } from "./learning-store";

/** Read model for the skill tree (spec §2, §39) over Supabase with the server (secret) key. */

export interface WorldRecord {
  readonly id: string;
  readonly number: number;
  readonly name: string;
  readonly summary: string;
  readonly available: boolean;
}

export interface SkillRecord {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly definition: string;
  readonly difficulty: number;
  readonly worldId: string | null;
}

export interface SkillEdge {
  readonly skillId: string;
  readonly prerequisiteId: string;
  readonly kind: "strict" | "recommended";
}

export interface PracticeSummary {
  readonly skillId: string;
  readonly dimension: SkillDimension;
  readonly evidenceCount: number;
  readonly lastPracticedAt: Date;
}

export interface SkillTreeStore {
  worlds(): Promise<WorldRecord[]>;
  skills(): Promise<SkillRecord[]>;
  edges(): Promise<SkillEdge[]>;
  practice(userId: string): Promise<PracticeSummary[]>;
  /** Skill tags of the given content versions. */
  tags(contentVersionIds: readonly string[]): Promise<Array<{ contentVersionId: string; skillId: string }>>;
}

function check<T>(operation: string, result: { data: T; error: { message: string; code?: string } | null }): T {
  if (result.error) throw new StoreError(operation, result.error.message, { cause: result.error });
  return result.data;
}

const worldSchema = z.object({ id: z.string(), number: z.number(), name: z.string(), summary: z.string(), available: z.boolean() });
const skillSchema = z.object({ id: z.string(), name: z.string(), category: z.string(), definition: z.string(), difficulty: z.number(), world_id: z.string().nullable() });
const edgeSchema = z.object({ skill_id: z.string(), prerequisite_id: z.string(), edge_kind: z.enum(["strict", "recommended"]) });
const practiceSchema = z.object({ skill_id: z.string(), dimension: z.string(), evidence_count: z.coerce.number(), last_practiced_at: z.string() });
const tagSchema = z.object({ content_version_id: z.string(), skill_id: z.string() });

export class SupabaseSkillTreeStore implements SkillTreeStore {
  constructor(private readonly db: SupabaseClient) {}

  async worlds(): Promise<WorldRecord[]> {
    return z.array(worldSchema).parse(check("worlds", await this.db.from("worlds").select("id, number, name, summary, available").order("number")));
  }

  async skills(): Promise<SkillRecord[]> {
    const rows = z.array(skillSchema).parse(check("skills", await this.db.from("skills").select("id, name, category, definition, difficulty, world_id").order("difficulty").order("id")));
    return rows.map((row) => ({ id: row.id, name: row.name, category: row.category, definition: row.definition, difficulty: row.difficulty, worldId: row.world_id }));
  }

  async edges(): Promise<SkillEdge[]> {
    const rows = z.array(edgeSchema).parse(check("skill_edges", await this.db.from("skill_edges").select("skill_id, prerequisite_id, edge_kind")));
    return rows.map((row) => ({ skillId: row.skill_id, prerequisiteId: row.prerequisite_id, kind: row.edge_kind }));
  }

  async practice(userId: string): Promise<PracticeSummary[]> {
    const rows = z.array(practiceSchema).parse(check("skill_practice", await this.db.rpc("skill_practice", { p_user_id: userId })));
    return rows.map((row) => ({ skillId: row.skill_id, dimension: row.dimension as SkillDimension, evidenceCount: row.evidence_count, lastPracticedAt: new Date(row.last_practiced_at) }));
  }

  async tags(contentVersionIds: readonly string[]): Promise<Array<{ contentVersionId: string; skillId: string }>> {
    if (contentVersionIds.length === 0) return [];
    const rows = z.array(tagSchema).parse(check("content_tags", await this.db.from("content_skill_tags").select("content_version_id, skill_id").in("content_version_id", [...contentVersionIds])));
    return rows.map((row) => ({ contentVersionId: row.content_version_id, skillId: row.skill_id }));
  }
}
