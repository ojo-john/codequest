/**
 * Decisions for keeping local edits and the saved project in step (spec §48, §71: "explicit
 * revision conflicts; never silently discard competing source edits"). Pure, so every branch is
 * unit-tested; the editor hook only carries them out.
 */

export interface ServerFile {
  readonly source: string;
  readonly revision: number;
}

export interface LocalDraft {
  readonly source: string;
  readonly baseRevision: number;
}

export type DraftDecision =
  /** The draft adds nothing (already saved, or identical). */
  | { readonly kind: "discard" }
  /** Unsaved local work on top of the current server revision: restore it and save it. */
  | { readonly kind: "restore"; readonly source: string }
  /** Both sides changed since the draft's base: the learner must choose. */
  | { readonly kind: "conflict"; readonly local: string; readonly server: ServerFile };

export function reconcileDraft(server: ServerFile | undefined, draft: LocalDraft): DraftDecision {
  const serverRevision = server?.revision ?? 0;
  if (server !== undefined && draft.source === server.source) return { kind: "discard" };
  if (draft.baseRevision === serverRevision) return { kind: "restore", source: draft.source };
  if (draft.baseRevision > serverRevision) {
    // The server is behind the draft's base (e.g. a restore from backup): keep the local work.
    return { kind: "restore", source: draft.source };
  }
  return { kind: "conflict", local: draft.source, server: server ?? { source: "", revision: 0 } };
}

export type SaveOutcome =
  | { readonly kind: "saved"; readonly revision: number }
  | { readonly kind: "conflict" }
  /** Network or service trouble: keep the draft, retry later. */
  | { readonly kind: "retry" };

/** Classifies a save_project_file RPC response. */
export function classifySave(response: { data: unknown; error: { code?: string } | null }): SaveOutcome {
  if (response.error === null) return { kind: "saved", revision: Number(response.data) };
  if (response.error.code === "PT409") return { kind: "conflict" };
  return { kind: "retry" };
}

/** After a save, is the editor still ahead of what was saved? */
export function stillDirty(currentSource: string, savedSource: string): boolean {
  return currentSource !== savedSource;
}

/** Retry delays for saves that failed for network reasons: capped exponential backoff with jitter. */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
  return Math.round(base / 2 + random() * (base / 2));
}
