"use client";

import { useEffect, useRef } from "react";
import { clearDraft, draftsForProject, saveDraft } from "@/lib/offline/drafts";
import { browserClient } from "@/lib/supabase/browser";
import { classifySave, reconcileDraft, retryDelayMs } from "./sync-rules";
import { useWorkspace } from "./store";

const SAVE_DEBOUNCE_MS = 800;

/**
 * Keeps the workspace and the saved project in step: every edit goes to IndexedDB immediately;
 * dirty files are saved after a short pause with their expected revision; a stale revision
 * becomes an explicit conflict; network failures keep the draft and retry with backoff.
 */
export function useProjectSync(): void {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const attempts = useRef(new Map<string, number>());
  // One save per file at a time: a second save with the same expected revision would be a false conflict.
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    const { projectId } = useWorkspace.getState();
    let cancelled = false;

    async function save(path: string): Promise<void> {
      const file = useWorkspace.getState().files[path];
      if (!file || inFlight.current.has(path) || file.status === "conflict" || file.source === file.savedSource) return;
      const sent = file.source;
      inFlight.current.add(path);
      useWorkspace.getState().setStatus(path, "saving");
      let response;
      try {
        response = await browserClient().rpc("save_project_file", {
          p_project_id: projectId,
          p_path: path,
          p_expected_revision: file.savedRevision,
          p_source: sent,
          p_mutation_id: crypto.randomUUID(),
        });
      } finally {
        inFlight.current.delete(path);
      }
      if (cancelled) return;
      const outcome = classifySave(response);
      if (outcome.kind === "saved") {
        attempts.current.delete(path);
        useWorkspace.getState().saved(path, outcome.revision, sent);
        const now = useWorkspace.getState().files[path];
        if (now && now.source === sent) await clearDraft(projectId, path);
        else schedule(path);
        return;
      }
      if (outcome.kind === "conflict") {
        const latest = await browserClient().from("project_files").select("source, revision").eq("project_id", projectId).eq("path", path).maybeSingle();
        if (!cancelled && latest.data) useWorkspace.getState().conflict(path, latest.data.source as string, Number(latest.data.revision));
        return;
      }
      const attempt = (attempts.current.get(path) ?? 0) + 1;
      attempts.current.set(path, attempt);
      useWorkspace.getState().setStatus(path, "offline");
      timers.current.set(path, setTimeout(() => void save(path), retryDelayMs(attempt)));
    }

    function schedule(path: string): void {
      clearTimeout(timers.current.get(path));
      timers.current.set(path, setTimeout(() => void save(path), SAVE_DEBOUNCE_MS));
    }

    // Restore or flag drafts left from an earlier visit (closed tab, lost network).
    void draftsForProject(projectId).then((drafts) => {
      if (cancelled) return;
      for (const draft of drafts) {
        const file = useWorkspace.getState().files[draft.path];
        const decision = reconcileDraft(file ? { source: file.savedSource, revision: file.savedRevision } : undefined, draft);
        if (decision.kind === "discard") void clearDraft(projectId, draft.path);
        else if (decision.kind === "restore" && file) useWorkspace.getState().edit(draft.path, decision.source);
        else if (decision.kind === "conflict" && file) {
          useWorkspace.getState().edit(draft.path, decision.local);
          useWorkspace.getState().conflict(draft.path, decision.server.source, decision.server.revision);
        }
      }
    });

    // Persist every change locally at once; save to the server after a pause.
    const unsubscribe = useWorkspace.subscribe((state, previous) => {
      for (const path of state.order) {
        const file = state.files[path];
        const before = previous.files[path];
        if (!file || file === before) continue;
        if (file.source !== before?.source) void saveDraft({ projectId, path, source: file.source, baseRevision: file.savedRevision });
        if (file.status === "dirty") schedule(path);
      }
    });

    const retryOffline = () => {
      for (const file of Object.values(useWorkspace.getState().files)) if (file.status === "offline") void save(file.path);
    };
    window.addEventListener("online", retryOffline);
    const pending = timers.current;

    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("online", retryOffline);
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);
}
