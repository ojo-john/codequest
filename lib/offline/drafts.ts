"use client";

import Dexie, { type EntityTable } from "dexie";

/**
 * Local draft store (spec §48): every keystroke lands here first, so closing the tab, losing the
 * network or a server error never loses code. A draft records the server revision it was based
 * on, so syncing can detect a competing edit instead of silently overwriting it.
 */

export interface Draft {
  /** `${projectId}:${path}` */
  readonly key: string;
  readonly projectId: string;
  readonly path: string;
  readonly source: string;
  /** Server revision this draft started from (0 = file not yet on the server). */
  readonly baseRevision: number;
  readonly updatedAt: number;
}

class DraftDatabase extends Dexie {
  drafts!: EntityTable<Draft, "key">;

  constructor() {
    super("codequest");
    this.version(1).stores({ drafts: "key, projectId, updatedAt" });
  }
}

let database: DraftDatabase | undefined;

function db(): DraftDatabase {
  database ??= new DraftDatabase();
  return database;
}

export const draftKey = (projectId: string, path: string) => `${projectId}:${path}`;

/** IndexedDB can be unavailable (private browsing, blocked storage): drafts then degrade to memory-only. */
export async function saveDraft(draft: Omit<Draft, "key" | "updatedAt">): Promise<boolean> {
  try {
    await db().drafts.put({ ...draft, key: draftKey(draft.projectId, draft.path), updatedAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

export async function draftsForProject(projectId: string): Promise<Draft[]> {
  try {
    return await db().drafts.where("projectId").equals(projectId).toArray();
  } catch {
    return [];
  }
}

export async function clearDraft(projectId: string, path: string): Promise<void> {
  try {
    await db().drafts.delete(draftKey(projectId, path));
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
