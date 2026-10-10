"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { apiCall, ClientApiError } from "@/lib/client/api";
import { useActiveSeconds } from "@/lib/client/use-active-seconds";
import { nextDiagnosticQuestion } from "@/lib/exercises/diagnostic";
import type { CorrectAnswer, ExerciseOutcome } from "@/lib/exercises/grade";
import type { ExerciseSection, PublicQuestion } from "@/lib/exercises/schema";
import { describeCorrect } from "./exercise-runner";
import { initialValue, isComplete, QuestionCode, QuestionInput, responseFor, type ResponseValue } from "./question-input";

interface AnswerResult {
  readonly outcome: ExerciseOutcome;
  readonly correct: CorrectAnswer;
  readonly why: string;
}

/** Base Camp's adaptive run (spec §3): the next question depends on how each section is going. */
export function DiagnosticRunner({ contentVersionId, questions, sections }: { contentVersionId: string; questions: readonly PublicQuestion[]; sections: readonly ExerciseSection[] }) {
  const router = useRouter();
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, ExerciseOutcome>>(new Map());
  const [current, setCurrent] = useState(() => nextDiagnosticQuestion(sections, new Map()));
  const question = questions.find((candidate) => candidate.id === current?.questionId);
  const [value, setValue] = useState<ResponseValue>(() => (question ? initialValue(question) : undefined));
  const [result, setResult] = useState<AnswerResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const activeTime = useActiveSeconds();
  const section = sections.find((candidate) => candidate.id === current?.sectionId);

  async function check() {
    if (!question) return;
    setPending(true);
    setError(undefined);
    try {
      const response = await apiCall<AnswerResult>("/api/v1/exercises/answers", {
        method: "POST",
        body: { requestKey: crypto.randomUUID(), contentVersionId, questionId: question.id, answer: responseFor(question, value), activeSeconds: Math.min(3600, activeTime.take()) },
      });
      setResult(response);
      setOutcomes((previous) => new Map(previous).set(question.id, response.outcome));
    } catch (caught) {
      setError(caught instanceof ClientApiError ? caught.message : "Couldn't check your answer.");
    } finally {
      setPending(false);
    }
  }

  function next() {
    const following = nextDiagnosticQuestion(sections, outcomes);
    setResult(undefined);
    if (following === undefined) {
      router.replace("/base-camp");
      router.refresh();
      return;
    }
    setCurrent(following);
    const nextQuestion = questions.find((candidate) => candidate.id === following.questionId);
    setValue(nextQuestion ? initialValue(nextQuestion) : undefined);
  }

  if (!question || !section) return null;
  return (
    <section aria-labelledby="question-prompt" className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {section.name} · {outcomes.size} answered so far
      </p>
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
          <Badge tone={result.outcome === "pass" ? "success" : result.outcome === "partial" ? "warning" : "danger"}>
            {result.outcome === "pass" ? "✓ Correct" : result.outcome === "partial" ? "◐ Partly right" : "✗ Not this time"}
          </Badge>
          {result.outcome !== "pass" && <p className="font-mono text-xs whitespace-pre-wrap">{describeCorrect(question, result.correct).join("\n")}</p>}
          <p>{result.why}</p>
          <Button variant="primary" className="self-start" onClick={next}>
            Continue
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
