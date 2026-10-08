"use client";

import { useEffect, useRef, useState } from "react";
import { apiCall, ClientApiError } from "@/lib/client/api";

/** Wait this long after the last keystroke before saving. */
const SAVE_DELAY_MS = 1000;

type Status = "idle" | "saving" | "saved" | "error";

/** The learner's own notes on a quest (spec §51). Saved as typed; never checked or corrected. */
export function NotesPanel({ contentVersionId, initialBody }: { contentVersionId: string; initialBody: string }) {
  const [body, setBody] = useState(initialBody);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | undefined>();
  const saved = useRef(initialBody);

  useEffect(() => {
    if (body === saved.current) return;
    const timer = setTimeout(() => {
      setStatus("saving");
      apiCall(`/api/v1/quests/${contentVersionId}/note`, { method: "PUT", body: { body } })
        .then(() => {
          saved.current = body;
          setStatus("saved");
          setMessage(undefined);
        })
        .catch((caught: unknown) => {
          setStatus("error");
          setMessage(caught instanceof ClientApiError ? caught.message : "Couldn't save your note. It's still here; keep typing to retry.");
        });
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [body, contentVersionId]);

  return (
    <section aria-labelledby="notes-title" className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between gap-2">
        <h2 id="notes-title" className="font-semibold">
          Your notes
        </h2>
        <span className="text-xs text-neutral-500 dark:text-neutral-400" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
        </span>
      </div>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">In your own words. CodeQuest keeps them exactly as written and doesn&apos;t check them.</p>
      <label htmlFor="quest-notes" className="sr-only">
        Notes on this quest
      </label>
      <textarea
        id="quest-notes"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={20_000}
        rows={4}
        className="mt-2 w-full rounded-md border border-neutral-300 bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
      />
      {status === "error" && message && (
        <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
          {message}
        </p>
      )}
    </section>
  );
}
