import "server-only";
import { zipSync } from "fflate";
import { z } from "zod";
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  archiveDataSchema,
  archiveEnvelopeSchema,
  archiveSchema,
  type Archive,
  type ArchiveData,
} from "@/lib/archive/archive-schema";
import { checkArchiveSignature, signArchive, type ArchiveSigningKey, type SignatureCheck } from "@/lib/archive/archive-signing";
import { remapArchiveIds } from "@/lib/archive/remap";
import type { ExecutionLimits } from "@/lib/execution/limits";
import { validateSourceFiles, type SourceFile } from "@/lib/execution/source-files";
import type { Logger } from "@/lib/observability/log";
import { ApiError } from "./http";

/**
 * Data portability (spec §47, §61, §63, §64, §67, §68): export a signed archive of everything the learner
 * owns, import one back, download a project as a ZIP, and delete progress and projects.
 *
 * Trust rule for imports: projects, files and notes are the learner's own work and are always
 * restored. Grading-derived records (attempts, mastery, XP, …) are restored only from an archive
 * this server signed and nobody has edited — otherwise a learner could award themselves progress.
 */

export type ImportReport = Readonly<Record<string, { readonly imported: number; readonly skipped: number }>>;

/** The archive references content, skills or rubrics this database doesn't have (sync content first). */
export class MissingReferencesError extends Error {
  constructor(readonly references: readonly string[]) {
    super(`archive references records this database does not have: ${references.join(", ")}`);
    this.name = "MissingReferencesError";
  }
}

export interface ProjectExport {
  readonly title: string;
  readonly files: readonly SourceFile[];
}

export interface ArchiveStore {
  exportUserData(userId: string): Promise<unknown>;
  /** One transaction; throws MissingReferencesError when the archive needs content this database lacks. */
  importUserData(userId: string, data: ArchiveData, includeProgress: boolean): Promise<ImportReport>;
  deleteUserData(userId: string): Promise<void>;
  /** The learner's own project, or undefined when it doesn't exist or isn't theirs. */
  getProject(userId: string, projectId: string): Promise<ProjectExport | undefined>;
}

export interface ArchiveServiceDeps {
  readonly store: ArchiveStore;
  readonly signingKey: ArchiveSigningKey | undefined;
  readonly limits: Pick<ExecutionLimits, "maxSourceFiles" | "maxTotalSourceBytes">;
  readonly logger: Logger;
  readonly clock?: () => Date;
}

export interface ImportResult {
  readonly signature: SignatureCheck;
  readonly progressRestored: boolean;
  readonly report: ImportReport;
}

const MAX_REPORTED_ISSUES = 20;

/** Typed by the learner to confirm an irreversible delete (spec §67). */
export const DELETE_CONFIRMATION_PHRASE = "delete my progress";

export const deleteRequestSchema = z.object({ confirm: z.string() }).strict();

export class ArchiveService {
  private readonly clock: () => Date;

  constructor(private readonly deps: ArchiveServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async exportArchive(userId: string): Promise<Archive> {
    const raw = await this.deps.store.exportUserData(userId);
    // Validating our own output means every export is importable; a failure here is a bug.
    const parsed = archiveDataSchema.safeParse(raw);
    if (!parsed.success) {
      this.deps.logger.metric("archive.export_invalid", 1);
      throw new Error(`export_user_data produced an invalid archive: ${parsed.error.issues.slice(0, 3).map((issue) => issue.path.join(".")).join(", ")}`);
    }
    const data = parsed.data;
    const unsigned = { format: ARCHIVE_FORMAT, version: ARCHIVE_VERSION, exportedAt: this.clock().toISOString(), subject: userId, data } as const;
    const signature = this.deps.signingKey === undefined ? null : signArchive(this.deps.signingKey, unsigned);
    if (signature === null) {
      this.deps.logger.log("warn", "archive.export_unsigned", { userId, reason: "ARCHIVE_SIGNING_KEY not set" });
    }
    this.deps.logger.metric("archive.exported", 1, { signed: signature !== null });
    return { ...unsigned, signature };
  }

  async importArchive(userId: string, raw: unknown): Promise<ImportResult> {
    const envelope = archiveEnvelopeSchema.safeParse(raw);
    if (!envelope.success || envelope.data.format !== ARCHIVE_FORMAT) {
      throw new ApiError(422, "not_an_archive", "This file isn't a CodeQuest archive.");
    }
    if (envelope.data.version !== ARCHIVE_VERSION) {
      throw new ApiError(422, "unsupported_archive_version", `This archive is format version ${envelope.data.version}; this CodeQuest reads version ${ARCHIVE_VERSION}.`);
    }
    const parsed = archiveSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
      throw new ApiError(422, "archive_invalid", "This archive is damaged or was edited into an invalid shape.", issues);
    }
    const archive = parsed.data;
    this.assertProjectsRunnable(archive.data);

    const { signature, ...unsigned } = archive;
    const check = checkArchiveSignature(this.deps.signingKey, unsigned, signature);
    const includeProgress = check === "valid";
    const data = remapArchiveIds(archive.data, archive.subject, userId);

    let report: ImportReport;
    try {
      report = await this.deps.store.importUserData(userId, data, includeProgress);
    } catch (error) {
      if (error instanceof MissingReferencesError) {
        throw new ApiError(422, "archive_references_missing", "This archive refers to quests or skills this CodeQuest doesn't have yet.", error.references);
      }
      throw error;
    }
    this.deps.logger.log("info", "archive.imported", { userId, signature: check, progressRestored: includeProgress, sameAccount: archive.subject === userId });
    this.deps.logger.metric("archive.imported", 1, { signature: check, progressRestored: includeProgress });
    return { signature: check, progressRestored: includeProgress, report };
  }

  async deleteAllData(userId: string, confirmation: string): Promise<void> {
    if (confirmation.trim().toLowerCase() !== DELETE_CONFIRMATION_PHRASE) {
      throw new ApiError(400, "confirmation_required", `Type "${DELETE_CONFIRMATION_PHRASE}" to confirm. This can't be undone.`);
    }
    await this.deps.store.deleteUserData(userId);
    this.deps.logger.log("info", "archive.user_data_deleted", { userId });
    this.deps.logger.metric("archive.user_data_deleted", 1);
  }

  /** The project as a ZIP of its Java sources, under a folder named after the project. */
  async projectZip(userId: string, projectId: string): Promise<{ readonly fileName: string; readonly bytes: Uint8Array }> {
    const project = await this.deps.store.getProject(userId, projectId);
    if (project === undefined) throw new ApiError(404, "project_not_found", "That project doesn't exist.");
    const folder = slugify(project.title);
    const entries: Record<string, Uint8Array> = {};
    for (const file of project.files) entries[`${folder}/${file.path}`] = new TextEncoder().encode(file.content);
    // Fixed timestamp: the same project always produces byte-identical ZIPs.
    const bytes = zipSync(entries, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") });
    return { fileName: `${folder}.zip`, bytes };
  }

  /** Every project must stay executable, so imported files obey the same rules as saved ones. */
  private assertProjectsRunnable(data: ArchiveData): void {
    const byProject = new Map<string, SourceFile[]>();
    for (const file of data.project_files) {
      const files = byProject.get(file.project_id) ?? [];
      files.push({ path: file.path, content: file.source });
      byProject.set(file.project_id, files);
    }
    const knownProjects = new Set(data.projects.map((project) => project.id));
    const problems: Array<{ projectId: string; issues: unknown }> = [];
    for (const [projectId, files] of byProject) {
      if (!knownProjects.has(projectId)) {
        problems.push({ projectId, issues: [{ code: "unknown_project" }] });
        continue;
      }
      const result = validateSourceFiles(files, this.deps.limits);
      if (!result.ok) problems.push({ projectId, issues: result.issues });
    }
    if (problems.length > 0) {
      throw new ApiError(422, "archive_projects_invalid", "Some project files in this archive can't be restored.", problems);
    }
  }
}

function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug === "" ? "project" : slug;
}
