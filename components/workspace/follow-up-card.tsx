"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import type { RubricResult } from "@/lib/grading/rubric";

export interface FollowUpView {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly string[];
}

interface Outcome {
  readonly results: ReadonlyArray<{ readonly id: string; readonly choice: number; readonly correct: boolean; readonly answer: number; readonly why: string }>;
  readonly rubric: RubricResult;
}

/**
 * "Check your understanding" (spec §14, §43): objective questions after a pass, graded on the
 * server against canonical answers. The first answers count; the explanation shows afterwards.
 */
export function FollowUpCard({ jobId, questions, onRubric }: { jobId: string; questions: readonly FollowUpView[]; onRubric: (rubric: RubricResult) => void }) {
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [outcome, setOutcome] = useState<Outcome | undefined>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const complete = questions.every((question) => choices[question.id] !== undefined);

  async function check() {
    setPending(true);
    setError(undefined);
    try {
      const response = await apiCall<Outcome>("/api/v1/followups", { method: "POST", body: { jobId, answers: choices } });
      setOutcome(response);
      onRubric(response.rubric);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't check your answers.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="follow-ups-title" className="rounded-md border border-indigo-200 p-3 dark:border-indigo-900">
      <h3 id="follow-ups-title" className="font-medium">
        Check your understanding
      </h3>
      <p className="text-neutral-600 dark:text-neutral-400">These count toward explanation and complexity, which passing code alone doesn&apos;t show. Your first answers count.</p>
      <div className="mt-2 flex flex-col gap-3">
        {questions.map((question) => {
          const result = outcome?.results.find((entry) => entry.id === question.id);
          return (
            <fieldset key={question.id} disabled={outcome !== undefined || pending}>
              <legend className="font-medium">{question.prompt}</legend>
              <div className="mt-1 flex flex-col gap-1">
                {question.options.map((option, index) => {
                  const chosen = (result?.choice ?? choices[question.id]) === index;
                  const isAnswer = result !== undefined && result.answer === index;
                  return (
                    <label key={option} className={`flex items-start gap-2 rounded px-1 ${isAnswer ? "bg-emerald-50 dark:bg-emerald-950/40" : ""}`}>
                      <input type="radio" name={`follow-up-${question.id}`} checked={chosen} onChange={() => setChoices((current) => ({ ...current, [question.id]: index }))} className="mt-1" />
                      <span>
                        {option}
                        {isAnswer && <span className="sr-only"> (correct answer)</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              {result && (
                <p className="mt-1" role="status">
                  <span className="font-medium">{result.correct ? "✓ Correct." : "✗ Not quite."}</span> {result.why}
                </p>
              )}
            </fieldset>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {!outcome && (
        <Button className="mt-2" variant="primary" disabled={!complete || pending} onClick={() => void check()}>
          {pending ? "Checking…" : "Check answers"}
        </Button>
      )}
    </section>
  );
}
