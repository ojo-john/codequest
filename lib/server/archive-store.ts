import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ArchiveData } from "@/lib/archive/archive-schema";
import { MissingReferencesError, type ArchiveStore, type ImportReport, type ProjectExport } from "./archive-service";
import { StoreError } from "./learning-store";

/**
 * ArchiveStore over Supabase with the server (secret) key. The SQL functions
 * (migrations/20261008000100_data_portability.sql) take the authenticated user's id from the
 * server and scope every read and write to it.
 */

const MISSING_REFERENCES = "CQ422";

const reportSchema = z.record(z.string(), z.object({ imported: z.number().int(), skipped: z.number().int() }));
const projectSchema = z.object({ title: z.string() });
const filesSchema = z.array(z.object({ path: z.string(), source: z.string() }));

type RpcError = { message: string; code?: string; details?: string | null };

function check<T>(operation: string, result: { data: T; error: RpcError | null }): T {
  if (result.error) throw new StoreError(operation, result.error.message, { cause: result.error });
  return result.data;
}

export class SupabaseArchiveStore implements ArchiveStore {
  constructor(private readonly db: SupabaseClient) {}

  async exportUserData(userId: string): Promise<unknown> {
    return check("export_user_data", await this.db.rpc("export_user_data", { p_user_id: userId }));
  }

  async importUserData(userId: string, data: ArchiveData, includeProgress: boolean): Promise<ImportReport> {
    const result = await this.db.rpc("import_user_data", { p_user_id: userId, p_data: data, p_include_progress: includeProgress });
    if (result.error?.code === MISSING_REFERENCES) {
      throw new MissingReferencesError((result.error.details ?? "").split(", ").filter((reference) => reference !== ""));
    }
    return reportSchema.parse(check("import_user_data", result));
  }

  async deleteUserData(userId: string): Promise<void> {
    check("delete_user_data", await this.db.rpc("delete_user_data", { p_user_id: userId }));
  }

  async getProject(userId: string, projectId: string): Promise<ProjectExport | undefined> {
    const project = check("project", await this.db.from("projects").select("title").eq("id", projectId).eq("user_id", userId).maybeSingle());
    if (project === null) return undefined;
    const files = check(
      "project_files",
      await this.db.from("project_files").select("path, source").eq("project_id", projectId).eq("user_id", userId).order("path"),
    );
    return {
      title: projectSchema.parse(project).title,
      files: filesSchema.parse(files).map((file) => ({ path: file.path, content: file.source })),
    };
  }
}
