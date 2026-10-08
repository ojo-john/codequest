import { z } from "zod";

/**
 * The reflection card (spec §56): four short prompts after a problem, in the learner's own words.
 * Prompts are versioned so a stored reflection can always be shown with the questions it answered.
 * Weeks later the quest asks the learner to recall before showing what they wrote (retrieval
 * practice), rather than just re-displaying it.
 */

export const REFLECTION_VERSION = "reflection-v1";

export const REFLECTION_PROMPTS = [
  { key: "cue", question: "What in the requirements told you what to do?" },
  { key: "mistake", question: "What mistake did you make, or nearly make?" },
  { key: "complexity", question: "How much work did you expect the code to do (e.g. one pass over the cart)? Was that right?" },
  { key: "reuse", question: "When would you use this approach again?" },
] as const;

export type ReflectionKey = (typeof REFLECTION_PROMPTS)[number]["key"];

export const MAX_REFLECTION_ANSWER_CHARS = 2000;

/** Show the recall prompt once a reflection is at least this old. */
export const RETRIEVAL_AFTER_DAYS = 7;

const answer = z.string().trim().max(MAX_REFLECTION_ANSWER_CHARS).optional();

export const reflectionAnswersSchema = z
  .object({ cue: answer, mistake: answer, complexity: answer, reuse: answer })
  .strict()
  .refine((answers) => Object.values(answers).some((value) => value !== undefined && value !== ""), "Answer at least one question.");

export type ReflectionAnswers = z.infer<typeof reflectionAnswersSchema>;

export interface ReflectionBody {
  readonly version: typeof REFLECTION_VERSION;
  readonly answers: Partial<Record<ReflectionKey, string>>;
}

/** Stored form: empty answers are dropped so "skipped" and "blank" look the same. */
export function reflectionBody(answers: ReflectionAnswers): ReflectionBody {
  const kept = Object.fromEntries(Object.entries(answers).filter(([, value]) => value !== undefined && value !== ""));
  return { version: REFLECTION_VERSION, answers: kept };
}

export function isRetrievalDue(reflectedAt: Date, now: Date): boolean {
  return now.getTime() - reflectedAt.getTime() >= RETRIEVAL_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
