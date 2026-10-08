"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { MAX_REFLECTION_ANSWER_CHARS, REFLECTION_PROMPTS, RETRIEVAL_AFTER_DAYS, type ReflectionKey } from "@/lib/learning/reflection";

type State = "open" | "saving" | "saved" | "skipped";

/** Shown after a graded submission (spec §56). Optional: skipping costs nothing. */
export function ReflectionCard({ jobId }: { jobId: string }) {
  const [answers, setAnswers] = useState<Partial<Record<ReflectionKey, string>>>({});
  const [state, setState] = useState<State>("open");
  const [error, setError] = useState<string | undefined>();
  const hasAnswer = Object.values(answers).some((value) => value !== undefined && value.trim() !== "");

  async function save() {
    setState("saving");
    setError(undefined);
    try {
      await apiCall("/api/v1/reflections", { method: "POST", body: { jobId, answers } });
      setState("saved");
    } catch (caught) {
      setState("open");
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't save your reflection.");
    }
  }

  if (state === "skipped") return null;
  if (state === "saved") {
    return (
      <p role="status" className="rounded-lg border border-emerald-600/40 bg-emerald-50 p-3 text-sm text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100">
        Reflection saved. When you come back to this quest in {RETRIEVAL_AFTER_DAYS}+ days, you&apos;ll be asked to recall it first.
      </p>
    );
  }

  return (
    <section aria-labelledby="reflection-title" className="rounded-lg border border-indigo-200 p-4 dark:border-indigo-900">
      <h2 id="reflection-title" className="font-semibold">
        Reflect for a minute
      </h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Optional. A sentence each is plenty; answer any you like.</p>
      <div className="mt-3 flex flex-col gap-3">
        {REFLECTION_PROMPTS.map((prompt) => (
          <div key={prompt.key}>
            <label htmlFor={`reflection-${prompt.key}`} className="text-sm font-medium">
              {prompt.question}
            </label>
            <textarea
              id={`reflection-${prompt.key}`}
              rows={2}
              maxLength={MAX_REFLECTION_ANSWER_CHARS}
              value={answers[prompt.key] ?? ""}
              onChange={(event) => setAnswers((current) => ({ ...current, [prompt.key]: event.target.value }))}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
            />
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={!hasAnswer || state === "saving"} onClick={() => void save()}>
          {state === "saving" ? "Saving…" : "Save reflection"}
        </Button>
        <Button onClick={() => setState("skipped")}>Skip</Button>
      </div>
    </section>
  );
}
