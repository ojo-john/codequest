"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { QuestWorkspace } from "@/components/workspace/quest-workspace";
import { Button } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { PLAN_PROMPTS, type MockPlan } from "@/lib/interview/mock-scoring";

/**
 * A running mock interview (spec §33, §34): plan first (the interview workflow), then code with
 * study aids off. The timer is the server's deadline; at zero the mock finishes itself.
 */

const PLAN_SAVE_DEBOUNCE_MS = 800;

function useRemainingSeconds(endsAt: string): number {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / 1000)));
  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.max(0, Math.ceil((Date.parse(endsAt) - Date.now()) / 1000))), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  return remaining;
}

function PlanForm({ mockId, initial }: { mockId: string; initial: MockPlan }) {
  const [plan, setPlan] = useState(initial);
  const [status, setStatus] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = useCallback(
    async (next: MockPlan) => {
      setStatus("saving");
      try {
        await apiCall(`/api/v1/mocks/${mockId}/plan`, { method: "PUT", body: next });
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    },
    [mockId],
  );

  function change(id: keyof MockPlan, value: string) {
    const next = { ...plan, [id]: value };
    setPlan(next);
    setStatus("unsaved");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(next), PLAN_SAVE_DEBOUNCE_MS);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <section aria-labelledby="plan-title" className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="plan-title" className="text-lg font-semibold">
          Talk it through first
        </h2>
        <span id="plan-status" className="text-xs text-neutral-500 dark:text-neutral-400" aria-live="polite">
          {{ saved: "Saved", unsaved: "Unsaved", saving: "Saving…", error: "Couldn't save; keep typing and it will retry" }[status]}
        </span>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        Write what you would say to the interviewer. You can switch between this and the code at any time; sensible variations of the order are fine.
      </p>
      {PLAN_PROMPTS.map((prompt) => (
        <div key={prompt.id}>
          <label htmlFor={`plan-${prompt.id}`} className="font-medium">
            {prompt.title}
          </label>
          <p id={`plan-${prompt.id}-hint`} className="text-sm text-neutral-600 dark:text-neutral-400">
            {prompt.guidance}
          </p>
          <textarea
            id={`plan-${prompt.id}`}
            aria-describedby={`plan-${prompt.id}-hint`}
            rows={3}
            maxLength={2000}
            value={plan[prompt.id]}
            onChange={(event) => change(prompt.id, event.target.value)}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
          />
        </div>
      ))}
    </section>
  );
}

export function MockRoom({
  mockId,
  endsAt,
  plan,
  workspace,
}: {
  mockId: string;
  endsAt: string;
  plan: MockPlan;
  workspace: Omit<ComponentProps<typeof QuestWorkspace>, "studyAidsOff">;
}) {
  const router = useRouter();
  const remaining = useRemainingSeconds(endsAt);
  const [view, setView] = useState<"plan" | "code">("plan");
  const [finishing, setFinishing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const finish = useCallback(async () => {
    setFinishing(true);
    setError(undefined);
    try {
      await apiCall(`/api/v1/mocks/${mockId}/finish`, { method: "POST" });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't finish the mock; try again.");
      setFinishing(false);
    }
  }, [mockId, router]);

  // Time's up: finish once, as an interviewer would.
  const finishedByTimer = useRef(false);
  useEffect(() => {
    if (remaining === 0 && !finishedByTimer.current) {
      finishedByTimer.current = true;
      void finish();
    }
  }, [remaining, finish]);

  const minutes = Math.floor(remaining / 60);
  const lowTime = remaining <= 5 * 60;

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-[env(safe-area-inset-top,0px)] z-10 flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
        <span className="font-semibold">Mock interview</span>
        <span role="timer" aria-label="Time remaining" className={`font-mono ${lowTime ? "font-semibold text-amber-700 dark:text-amber-300" : ""}`}>
          {minutes}:{String(remaining % 60).padStart(2, "0")}
        </span>
        <div role="tablist" aria-label="Mock view" className="flex gap-1">
          {(["plan", "code"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`rounded-md px-3 py-1 text-sm ${view === id ? "bg-indigo-600 font-medium text-white" : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"}`}
            >
              {id === "plan" ? "Plan" : "Code"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {confirm ? (
            <>
              <span className="text-sm">End the interview now?</span>
              <Button variant="danger" disabled={finishing} onClick={() => void finish()}>
                {finishing ? "Scoring…" : "Yes, finish"}
              </Button>
              <Button onClick={() => setConfirm(false)}>Keep going</Button>
            </>
          ) : (
            <Button disabled={finishing} onClick={() => setConfirm(true)}>
              {finishing ? "Scoring…" : "Finish interview"}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="w-full text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
      <div hidden={view !== "plan"}>
        <PlanForm mockId={mockId} initial={plan} />
      </div>
      <div hidden={view !== "code"} className="flex flex-1 flex-col">
        <QuestWorkspace {...workspace} studyAidsOff />
      </div>
    </div>
  );
}
