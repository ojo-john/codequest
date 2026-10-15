"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { COMPETENCIES, type Story, type StoryCheck, type StoryInput } from "@/lib/behavioral/stories";

const SAVE_DEBOUNCE_MS = 800;

const PARTS: ReadonlyArray<{ id: keyof Pick<StoryInput, "situation" | "task" | "action" | "result" | "learned">; label: string; hint: string }> = [
  { id: "situation", label: "Situation", hint: "Where you were and what was at stake. Keep it short." },
  { id: "task", label: "Task", hint: "What you were responsible for." },
  { id: "action", label: "Action", hint: "What you did, step by step. Say \"I\" for your part." },
  { id: "result", label: "Result", hint: "How it turned out. Only real numbers; it's fine if it went badly." },
  { id: "learned", label: "What I learned", hint: "What you'd keep or do differently." },
];

export function StoryEditor({ initial, initialChecks }: { initial: Story; initialChecks: StoryCheck[] }) {
  const router = useRouter();
  const [story, setStory] = useState<StoryInput>({
    title: initial.title,
    competencies: initial.competencies,
    situation: initial.situation,
    task: initial.task,
    action: initial.action,
    result: initial.result,
    learned: initial.learned,
  });
  const [checks, setChecks] = useState(initialChecks);
  const [status, setStatus] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function save(next: StoryInput) {
    setStatus("saving");
    try {
      const response = await apiCall<{ checks: StoryCheck[] }>(`/api/v1/stories/${initial.id}`, { method: "PUT", body: next });
      setChecks(response.checks);
      setStatus("saved");
      setError(undefined);
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't save. Your text is still here; keep typing to retry.");
    }
  }

  function change(next: StoryInput) {
    setStory(next);
    setStatus("unsaved");
    clearTimeout(timer.current);
    // An empty title isn't valid; wait until there is one.
    if (next.title.trim() === "") return;
    timer.current = setTimeout(() => void save(next), SAVE_DEBOUNCE_MS);
  }

  function toggle(id: (typeof COMPETENCIES)[number]["id"]) {
    const has = story.competencies.includes(id);
    if (!has && story.competencies.length >= 6) return;
    change({ ...story, competencies: has ? story.competencies.filter((other) => other !== id) : [...story.competencies, id] });
  }

  async function remove() {
    try {
      await apiCall(`/api/v1/stories/${initial.id}`, { method: "DELETE" });
      router.push("/stories");
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't delete the story.");
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 py-6 lg:grid-cols-[3fr_2fr]">
      <section aria-labelledby="story-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 id="story-heading" className="text-2xl font-semibold tracking-tight">
            Your story
          </h1>
          <span id="story-status" className="text-xs text-neutral-500 dark:text-neutral-400" aria-live="polite">
            {{ saved: "Saved", unsaved: "Unsaved", saving: "Saving…", error: "Not saved" }[status]}
          </span>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Write what really happened. CodeQuest checks the structure; it never writes or embellishes your story.
        </p>
        <div>
          <label htmlFor="story-title" className="font-medium">
            Title
          </label>
          <input
            id="story-title"
            maxLength={120}
            value={story.title}
            onChange={(event) => change({ ...story, title: event.target.value })}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
          />
        </div>
        <fieldset>
          <legend className="font-medium">Competencies it shows (up to 6)</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {COMPETENCIES.map((competency) => (
              <label key={competency.id} className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={story.competencies.includes(competency.id)} onChange={() => toggle(competency.id)} />
                {competency.name}
              </label>
            ))}
          </div>
        </fieldset>
        {PARTS.map((part) => (
          <div key={part.id}>
            <label htmlFor={`story-${part.id}`} className="font-medium">
              {part.label}
            </label>
            <p id={`story-${part.id}-hint`} className="text-sm text-neutral-600 dark:text-neutral-400">
              {part.hint}
            </p>
            <textarea
              id={`story-${part.id}`}
              aria-describedby={`story-${part.id}-hint`}
              rows={part.id === "action" ? 7 : 4}
              maxLength={4000}
              value={story[part.id]}
              onChange={(event) => change({ ...story, [part.id]: event.target.value })}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
            />
          </div>
        ))}
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/stories" className="text-sm text-indigo-700 hover:underline dark:text-indigo-300">
            ← All stories
          </Link>
          {confirmDelete ? (
            <span role="alertdialog" aria-label="Confirm delete" className="ml-auto flex items-center gap-2 text-sm">
              Delete this story for good?
              <Button variant="danger" onClick={() => void remove()}>
                Delete
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
            </span>
          ) : (
            <Button variant="ghost" className="ml-auto" onClick={() => setConfirmDelete(true)}>
              Delete story
            </Button>
          )}
        </div>
      </section>
      <aside aria-labelledby="checks-title">
        <Card>
          <h2 id="checks-title" className="mb-2 font-semibold">
            Structure check
          </h2>
          <ul className="flex flex-col gap-2 text-sm" aria-live="polite">
            {checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2">
                <Badge tone={check.status === "ok" ? "success" : "warning"}>{check.status === "ok" ? "OK" : "Try"}</Badge>
                <span>{check.message}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Checks look at structure and length only, not at whether the story is good.</p>
        </Card>
      </aside>
    </main>
  );
}
