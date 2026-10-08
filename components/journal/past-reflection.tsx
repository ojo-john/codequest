import { REFLECTION_PROMPTS, type ReflectionKey } from "@/lib/learning/reflection";

export interface PastReflectionView {
  readonly answers: Partial<Record<ReflectionKey, string>>;
  readonly createdAt: string;
  readonly retrievalDue: boolean;
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

/**
 * The learner's last reflection on this quest. Once it's old enough, it's a retrieval prompt:
 * recall first, then reveal what you wrote (spec §56).
 */
export function PastReflection({ reflection }: { reflection: PastReflectionView }) {
  const answered = REFLECTION_PROMPTS.filter((prompt) => reflection.answers[prompt.key]);
  const written = dateFormat.format(new Date(reflection.createdAt));

  return (
    <section aria-labelledby="past-reflection-title" className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <h2 id="past-reflection-title" className="font-semibold">
        {reflection.retrievalDue ? "Before you start: what do you remember?" : "Your reflection"}
      </h2>
      {reflection.retrievalDue && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {answered.map((prompt) => (
            <li key={prompt.key}>{prompt.question}</li>
          ))}
        </ul>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-neutral-700 dark:text-neutral-300">
          {reflection.retrievalDue ? `Think it through, then reveal what you wrote on ${written}` : `What you wrote on ${written}`}
        </summary>
        <dl className="mt-2 space-y-2">
          {answered.map((prompt) => (
            <div key={prompt.key}>
              <dt className="font-medium">{prompt.question}</dt>
              <dd className="whitespace-pre-wrap">{reflection.answers[prompt.key]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
