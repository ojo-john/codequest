"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { BUDGET_CHOICES } from "@/lib/learning/session-planner";

const LABELS: Record<number, string> = { 5: "5 min", 15: "15 min", 30: "30 min", 45: "45 min", 60: "60 min", 90: "60+ min" };

/** "How much time do you have?" — the budget drives the session (spec §4–5). */
export function BudgetPicker() {
  const router = useRouter();
  const [pending, setPending] = useState<number | undefined>();
  const [error, setError] = useState<string | undefined>();

  async function start(budgetMinutes: number) {
    setPending(budgetMinutes);
    setError(undefined);
    try {
      const { sessionId } = await apiCall<{ sessionId: string }>("/api/v1/sessions", {
        method: "POST",
        body: { budgetMinutes, clientRequestKey: crypto.randomUUID() },
      });
      router.push(`/sessions/${sessionId}`);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't start a session.");
      setPending(undefined);
    }
  }

  return (
    <div>
      <div role="group" aria-label="Time available" className="flex flex-wrap gap-2">
        {BUDGET_CHOICES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => void start(minutes)}
            disabled={pending !== undefined}
            className="rounded-lg border border-neutral-300 px-4 py-3 text-sm font-medium hover:border-indigo-500 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-indigo-950/40"
          >
            {pending === minutes ? "Planning…" : LABELS[minutes]}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
