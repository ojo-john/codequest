"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { useActiveSeconds } from "@/lib/client/use-active-seconds";
import type { CorrectAnswer, ExerciseOutcome } from "@/lib/exercises/grade";
import type { PublicQuestion } from "@/lib/exercises/schema";
import { BossResult } from "./boss-result";
import { initialValue, isComplete, QuestionCode, QuestionInput, responseFor, type ResponseValue } from "./question-input";

interface AnswerResult {
  readonly outcome: ExerciseOutcome;
  readonly correct: CorrectAnswer;
  readonly why: string;
  readonly awardedXp: number;
}

const OUTCOME_TEXT: Record<ExerciseOutcome, { text: string; tone: "success" | "warning" | "danger" }> = {
  pass: { text: "✓ Correct", tone: "success" },
  partial: { text: "◐ Partly right", tone: "warning" },
  fail: { text: "✗ Not this time", tone: "danger" },
};

const APPROACH_TEXT = { optimal: "best fit", valid: "works, but not the best fit", incorrect: "doesn't work here" } as const;

/** The canonical answer in words, for after the learner has answered. */
export function describeCorrect(question: PublicQuestion, correct: CorrectAnswer): string[] {
  switch (correct.type) {
    case "choice":
      return correct.indices.map((index) => ("options" in question && question.options ? question.options[index] : String(index)));
    case "boolean":
      return [correct.value ? "True" : "False"];
    case "text":
      return [correct.value];
    case "approaches":
      return question.type === "pattern" ? question.options.map((option, index) => `${option}: ${APPROACH_TEXT[correct.grades[index]]}`) : [];
    case "order":
      return question.type === "order" ? correct.order.map((index, position) => `${position + 1}. ${question.steps[index]}`) : [];
    case "blanks":
      return correct.accepted.map((accepted, index) => `Blank ${index + 1}: ${accepted.join(" or ")}`);
    case "number":
      return [`About ${correct.value.toLocaleString("en")} ${correct.unit} (within ${Math.round(correct.tolerance * 100)}% counts as right)`];
  }
}

/** One question and the set version it belongs to (mixed practice draws from several sets). */
export interface RunnerItem {
  readonly contentVersionId: string;
  readonly question: PublicQuestion;
}

export function ExerciseRunner({
  items,
  title,
  best = {},
  session,
  neutralNames = false,
  boss,
  onFinished,
}: {
  items: readonly RunnerItem[];
  title: string;
  best?: Readonly<Record<string, string>>;
  /** Set when opened from a planned session: finishing completes that item. */
  session?: { readonly id: string; readonly itemId: string };
  /** Mixed mode: "Challenge n" instead of "Question n", no hints about where a question came from. */
  neutralNames?: boolean;
  /** A mastery exam: show the per-section result for this sitting at the end. */
  boss?: { readonly contentVersionId: string; readonly sittingStartedAt: string };
  /** Called once the last question has been answered and the learner moves on. */
  onFinished?: () => void;
}) {
  const questions = items.map((item) => item.question);
  const [sessionDone, setSessionDone] = useState<"item" | "session" | undefined>();
  const [completionError, setCompletionError] = useState<string | undefined>();
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState<ResponseValue>(() => initialValue(questions[0]));
  const [result, setResult] = useState<AnswerResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [outcomes, setOutcomes] = useState<ExerciseOutcome[]>([]);
  // Active time only: idle time is excluded (spec §61).
  const activeTime = useActiveSeconds();
  const question = questions[index];
  const finished = index >= questions.length;

  async function check() {
    setPending(true);
    setError(undefined);
    try {
      const response = await apiCall<AnswerResult>("/api/v1/exercises/answers", {
        method: "POST",
        body: {
          requestKey: crypto.randomUUID(),
          contentVersionId: items[index].contentVersionId,
          questionId: question.id,
          answer: responseFor(question, value),
          activeSeconds: Math.min(3600, activeTime.take()),
        },
      });
      setResult(response);
      setOutcomes((current) => [...current, response.outcome]);
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't check your answer.");
    } finally {
      setPending(false);
    }
  }

  async function completeSessionItem() {
    if (!session) return;
    try {
      const response = await apiCall<{ sessionCompleted: boolean }>(`/api/v1/sessions/${session.id}/items/${session.itemId}/complete`, { method: "POST" });
      setSessionDone(response.sessionCompleted ? "session" : "item");
    } catch (caught) {
      setCompletionError(caught instanceof ClientApiError ? caught.message : "Couldn't update your session.");
    }
  }

  function next() {
    const following = index + 1;
    if (following >= questions.length) {
      void completeSessionItem();
      onFinished?.();
    }
    setIndex(following);
    setResult(undefined);
    if (following < questions.length) setValue(initialValue(questions[following]));
  }

  if (finished) {
    const passed = outcomes.filter((outcome) => outcome === "pass").length;
    return (
      <section aria-labelledby="summary-title" className="flex flex-col gap-3" role="status">
        <h2 id="summary-title" className="text-lg font-semibold">
          Set complete: {passed} of {questions.length} correct
        </h2>
        {boss && <BossResult contentVersionId={boss.contentVersionId} since={boss.sittingStartedAt} />}
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Each answer counted as evidence for its skill. Questions you missed come back in later reviews.</p>
        {sessionDone === "session" && <p className="font-medium">🎉 Session complete.</p>}
        {sessionDone === "item" && <p className="font-medium">✓ Done in your session.</p>}
        {completionError && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {completionError}
          </p>
        )}
        <div className="flex gap-2">
          {session ? (
            <Link href={`/sessions/${session.id}`} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              Back to session
            </Link>
          ) : (
            <Link href="/practice" className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              More practice
            </Link>
          )}
          <Link href="/progress" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium dark:border-neutral-700">
            See progress
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="question-prompt" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <span>
          {neutralNames ? "Challenge" : "Question"} {index + 1} of {questions.length}
        </span>
        {!neutralNames && best[question.id] === "succeeded" && <Badge tone="success">Answered correctly before</Badge>}
        <span className="sr-only">in {title}</span>
      </div>
      <p id="question-prompt" className="font-medium">
        {question.prompt}
      </p>
      {"code" in question && question.code && <QuestionCode code={question.code} />}
      <QuestionInput key={question.id} question={question} value={value} onChange={setValue} disabled={result !== undefined || pending} />
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {result ? (
        <div role="status" className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={OUTCOME_TEXT[result.outcome].tone}>{OUTCOME_TEXT[result.outcome].text}</Badge>
            {result.awardedXp > 0 && <span className="font-medium">+{result.awardedXp} XP</span>}
          </p>
          {result.outcome !== "pass" && (
            <div>
              <p className="font-medium">Answer:</p>
              <ul className="list-disc pl-5 font-mono text-xs">
                {describeCorrect(question, result.correct).map((line) => (
                  <li key={line} className="whitespace-pre-wrap">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p>{result.why}</p>
          <Button variant="primary" className="self-start" onClick={next}>
            {index + 1 < questions.length ? "Next question" : "Finish"}
          </Button>
        </div>
      ) : (
        <Button variant="primary" className="self-start" disabled={!isComplete(question, value) || pending} onClick={() => void check()}>
          {pending ? "Checking…" : "Check"}
        </Button>
      )}
    </section>
  );
}
