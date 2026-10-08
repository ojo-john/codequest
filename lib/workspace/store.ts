"use client";

import { create } from "zustand";

/**
 * Editor state shared across the workspace (spec §63: Zustand only for cross-workspace editor
 * state). One file per path; `savedSource`/`savedRevision` track what the server has.
 */

export type FileStatus = "saved" | "dirty" | "saving" | "offline" | "conflict";

export interface WorkspaceFile {
  readonly path: string;
  readonly source: string;
  readonly savedSource: string;
  readonly savedRevision: number;
  readonly status: FileStatus;
  /** Present while a conflict awaits the learner's choice. */
  readonly conflict?: { readonly serverSource: string; readonly serverRevision: number };
}

interface WorkspaceState {
  projectId: string;
  files: Record<string, WorkspaceFile>;
  order: string[];
  activePath: string;
  init(projectId: string, files: ReadonlyArray<{ path: string; source: string; revision: number }>): void;
  setActive(path: string): void;
  edit(path: string, source: string): void;
  setStatus(path: string, status: FileStatus): void;
  saved(path: string, revision: number, savedSource: string): void;
  conflict(path: string, serverSource: string, serverRevision: number): void;
  /** Conflict resolution: keep the local version (saved on top of the server's latest revision). */
  keepLocal(path: string): void;
  /** Conflict resolution: take the saved version, dropping the local edits to this file. */
  acceptSaved(path: string): void;
  /** Adds a new, not-yet-saved file (revision 0) and opens it; no-op if the path exists. */
  addFile(path: string, source: string): void;
}

function patch(files: Record<string, WorkspaceFile>, path: string, change: Partial<WorkspaceFile>): Record<string, WorkspaceFile> {
  const current = files[path];
  return current ? { ...files, [path]: { ...current, ...change } } : files;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  projectId: "",
  files: {},
  order: [],
  activePath: "",
  init(projectId, files) {
    const map: Record<string, WorkspaceFile> = {};
    for (const file of files) map[file.path] = { path: file.path, source: file.source, savedSource: file.source, savedRevision: file.revision, status: "saved" };
    const order = files.map((file) => file.path);
    set({ projectId, files: map, order, activePath: order.find((path) => path.includes("/main/")) ?? order[0] ?? "" });
  },
  setActive(path) {
    set({ activePath: path });
  },
  edit(path, source) {
    set((state) => {
      const file = state.files[path];
      if (!file) return state;
      // While a conflict is open, edits stay local until the learner chooses.
      const status: FileStatus = file.status === "conflict" ? "conflict" : source === file.savedSource ? "saved" : "dirty";
      return { files: patch(state.files, path, { source, status }) };
    });
  },
  setStatus(path, status) {
    set((state) => ({ files: patch(state.files, path, { status }) }));
  },
  saved(path, revision, savedSource) {
    set((state) => {
      const file = state.files[path];
      if (!file) return state;
      return { files: patch(state.files, path, { savedRevision: revision, savedSource, status: file.source === savedSource ? "saved" : "dirty" }) };
    });
  },
  conflict(path, serverSource, serverRevision) {
    set((state) => ({ files: patch(state.files, path, { status: "conflict", conflict: { serverSource, serverRevision } }) }));
  },
  keepLocal(path) {
    // Save the local version on top of the server's latest revision.
    set((state) => {
      const file = state.files[path];
      if (!file?.conflict) return state;
      return { files: patch(state.files, path, { savedRevision: file.conflict.serverRevision, savedSource: file.conflict.serverSource, status: "dirty", conflict: undefined }) };
    });
  },
  addFile(path, source) {
    set((state) => {
      if (state.files[path]) return state;
      const file: WorkspaceFile = { path, source, savedSource: "", savedRevision: 0, status: "dirty" };
      return { files: { ...state.files, [path]: file }, order: [...state.order, path], activePath: path };
    });
  },
  acceptSaved(path) {
    set((state) => {
      const file = state.files[path];
      if (!file?.conflict) return state;
      const { serverSource, serverRevision } = file.conflict;
      return { files: patch(state.files, path, { source: serverSource, savedSource: serverSource, savedRevision: serverRevision, status: "saved", conflict: undefined }) };
    });
  },
}));
