import { z } from "zod";
import { BIG_O_CLASSES, type PrivateAnswer, type PublicQuestion } from "./schema";

/**
 * One deterministic grader per question type (spec §43, §46). Graders are pure: the same
 * question, canonical answer and response always give the same outcome. A response with the
 * wrong shape for its question is rejected (400), never graded as wrong.
 */

export type ExerciseOutcome = "pass" | "partial" | "fail";

export interface GradedAnswer {
  readonly outcome: ExerciseOutcome;
  /** The canonical answer, for display after answering. */
  readonly correct: CorrectAnswer;
}

export type CorrectAnswer =
  | { readonly type: "choice"; readonly indices: readonly number[] }
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "approaches"; readonly grades: readonly ("optimal" | "valid" | "incorrect")[] }
  | { readonly type: "order"; readonly order: readonly number[] }
  | { readonly type: "blanks"; readonly accepted: readonly (readonly string[])[] };

export class InvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResponseError";
  }
}

/** Share of correctly placed steps that still earns partial credit for an ordering. */
const ORDER_PARTIAL_SHARE = 0.6;

const responseSchemas = {
  single_choice: z.object({ choice: z.number().int().min(0) }).strict(),
  multi_choice: z.object({ choices: z.array(z.number().int().min(0)).max(6) }).strict(),
  true_false: z.object({ value: z.boolean() }).strict(),
  predict_output: z.object({ text: z.string().max(4000) }).strict(),
  big_o: z.object({ choice: z.string().min(1).max(40) }).strict(),
  pattern: z.object({ choice: z.number().int().min(0) }).strict(),
  order: z.object({ order: z.array(z.number().int().min(0)).max(8) }).strict(),
  fill_blank: z.object({ blanks: z.array(z.string().max(200)).max(20) }).strict(),
} as const;

function parse<T extends keyof typeof responseSchemas>(type: T, response: unknown): z.infer<(typeof responseSchemas)[T]> {
  const parsed = responseSchemas[type].safeParse(response);
  if (!parsed.success) throw new InvalidResponseError(`That answer doesn't fit a ${type.replace("_", " ")} question.`);
  return parsed.data as z.infer<(typeof responseSchemas)[T]>;
}

/** Program output as printed: CRLF → LF, trailing spaces per line and trailing blank lines ignored. */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

/** Code fragment typed into a blank: surrounding whitespace dropped, inner runs collapsed. Case matters (Java). */
export function normalizeFragment(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function bigOOptions(question: Extract<PublicQuestion, { type: "big_o" }>): readonly string[] {
  return question.options ?? BIG_O_CLASSES;
}

function inRange(index: number, length: number): void {
  if (index >= length) throw new InvalidResponseError("That option doesn't exist.");
}

export function gradeAnswer(question: PublicQuestion, answer: PrivateAnswer, response: unknown): GradedAnswer {
  if (question.type !== answer.type) throw new Error(`question ${question.id} is ${question.type} but its answer is ${answer.type}`);

  switch (question.type) {
    case "single_choice": {
      const { choice } = parse("single_choice", response);
      inRange(choice, question.options.length);
      const correct = (answer as Extract<PrivateAnswer, { type: "single_choice" }>).answer;
      return { outcome: choice === correct ? "pass" : "fail", correct: { type: "choice", indices: [correct] } };
    }
    case "multi_choice": {
      const { choices } = parse("multi_choice", response);
      for (const choice of choices) inRange(choice, question.options.length);
      const correct = new Set((answer as Extract<PrivateAnswer, { type: "multi_choice" }>).answer);
      const picked = new Set(choices);
      const right = [...picked].filter((choice) => correct.has(choice)).length;
      const wrong = picked.size - right;
      const outcome: ExerciseOutcome = wrong === 0 && right === correct.size ? "pass" : wrong === 0 && right > 0 ? "partial" : "fail";
      return { outcome, correct: { type: "choice", indices: [...correct].sort((a, b) => a - b) } };
    }
    case "true_false": {
      const { value } = parse("true_false", response);
      const correct = (answer as Extract<PrivateAnswer, { type: "true_false" }>).answer;
      return { outcome: value === correct ? "pass" : "fail", correct: { type: "boolean", value: correct } };
    }
    case "predict_output": {
      const { text } = parse("predict_output", response);
      const correct = (answer as Extract<PrivateAnswer, { type: "predict_output" }>).answer;
      return { outcome: normalizeOutput(text) === normalizeOutput(correct) ? "pass" : "fail", correct: { type: "text", value: normalizeOutput(correct) } };
    }
    case "big_o": {
      const { choice } = parse("big_o", response);
      if (!bigOOptions(question).includes(choice)) throw new InvalidResponseError("That option doesn't exist.");
      const correct = (answer as Extract<PrivateAnswer, { type: "big_o" }>).answer;
      return { outcome: choice === correct ? "pass" : "fail", correct: { type: "text", value: correct } };
    }
    case "pattern": {
      const { choice } = parse("pattern", response);
      inRange(choice, question.options.length);
      const grades = (answer as Extract<PrivateAnswer, { type: "pattern" }>).grades;
      const grade = grades[choice];
      return { outcome: grade === "optimal" ? "pass" : grade === "valid" ? "partial" : "fail", correct: { type: "approaches", grades } };
    }
    case "order": {
      const { order } = parse("order", response);
      const correct = (answer as Extract<PrivateAnswer, { type: "order" }>).answer;
      const isPermutation = order.length === question.steps.length && new Set(order).size === order.length && order.every((index) => index < question.steps.length);
      if (!isPermutation) throw new InvalidResponseError("Put every step in the list exactly once.");
      const placed = order.filter((index, position) => correct[position] === index).length;
      const outcome: ExerciseOutcome = placed === correct.length ? "pass" : placed / correct.length >= ORDER_PARTIAL_SHARE ? "partial" : "fail";
      return { outcome, correct: { type: "order", order: correct } };
    }
    case "fill_blank": {
      const { blanks } = parse("fill_blank", response);
      const accepted = (answer as Extract<PrivateAnswer, { type: "fill_blank" }>).answer;
      if (blanks.length !== accepted.length) throw new InvalidResponseError(`Fill in all ${accepted.length} blanks.`);
      const right = blanks.filter((value, index) => accepted[index].some((option) => normalizeFragment(option) === normalizeFragment(value))).length;
      const outcome: ExerciseOutcome = right === accepted.length ? "pass" : right > 0 ? "partial" : "fail";
      return { outcome, correct: { type: "blanks", accepted } };
    }
  }
}
