import type { LoadedExerciseSet } from "@/lib/content/repository";
import { bigOOptions } from "./grade";
import { BLANK, type PrivateAnswer, type PublicQuestion } from "./schema";

/**
 * Static content gate for exercise sets (spec §44, §71): every question has exactly one canonical
 * answer of its own type that its grader can actually reach. Predict-output answers are verified
 * by running the code (scripts/content-check.ts).
 */

export interface ExerciseIssue {
  readonly item: string;
  readonly message: string;
}

function countBlanks(code: string): number {
  return code.split(BLANK).length - 1;
}

function checkAnswer(question: PublicQuestion, answer: PrivateAnswer): string | undefined {
  if (question.type !== answer.type) return `is ${question.type} but its answer is ${answer.type}`;
  switch (question.type) {
    case "single_choice": {
      const index = (answer as Extract<PrivateAnswer, { type: "single_choice" }>).answer;
      return index < question.options.length ? undefined : `answer ${index} is not an option`;
    }
    case "multi_choice": {
      const indices = (answer as Extract<PrivateAnswer, { type: "multi_choice" }>).answer;
      if (new Set(indices).size !== indices.length) return "answer repeats an option";
      return indices.every((index) => index < question.options.length) ? undefined : "answer names an option that doesn't exist";
    }
    case "true_false":
      return undefined;
    case "predict_output":
      return /public\s+class\s+Main\b/.test(question.code) && /static\s+void\s+main\s*\(/.test(question.code)
        ? undefined
        : "code must be a complete program with public class Main and main()";
    case "big_o": {
      const value = (answer as Extract<PrivateAnswer, { type: "big_o" }>).answer;
      return bigOOptions(question).includes(value) ? undefined : `answer ${value} is not one of the offered options`;
    }
    case "pattern": {
      const grades = (answer as Extract<PrivateAnswer, { type: "pattern" }>).grades;
      if (grades.length !== question.options.length) return "needs one grade per approach";
      return grades.includes("optimal") ? undefined : "needs at least one optimal approach";
    }
    case "order": {
      const order = (answer as Extract<PrivateAnswer, { type: "order" }>).answer;
      const isPermutation = order.length === question.steps.length && new Set(order).size === order.length && order.every((index) => index < question.steps.length);
      if (!isPermutation) return "answer must list every step exactly once";
      return order.every((index, position) => index === position) ? "steps are already shown in the correct order" : undefined;
    }
    case "fill_blank": {
      const blanks = countBlanks(question.code);
      const accepted = (answer as Extract<PrivateAnswer, { type: "fill_blank" }>).answer;
      if (blanks === 0) return `code has no ${BLANK} blanks`;
      return blanks === accepted.length ? undefined : `code has ${blanks} blanks but ${accepted.length} accepted-answer lists`;
    }
  }
}

export function validateExerciseSets(sets: readonly LoadedExerciseSet[], skillIds: ReadonlySet<string>, takenIds: ReadonlySet<string>): ExerciseIssue[] {
  const issues: ExerciseIssue[] = [];
  for (const { manifest, privateData } of sets) {
    const item = manifest.id;
    if (takenIds.has(item)) issues.push({ item, message: "id is also used by a quest" });
    const ids = manifest.questions.map((question) => question.id);
    if (new Set(ids).size !== ids.length) issues.push({ item, message: "question ids repeat" });
    for (const question of manifest.questions) {
      const answer = privateData.answers[question.id];
      if (answer === undefined) {
        issues.push({ item, message: `question ${question.id} has no answer` });
        continue;
      }
      const problem = checkAnswer(question, answer);
      if (problem) issues.push({ item, message: `question ${question.id} ${problem}` });
      if (!skillIds.has(answer.skill)) issues.push({ item, message: `question ${question.id} names unknown skill ${answer.skill}` });
    }
    if (manifest.sections) {
      const placed = manifest.sections.flatMap((section) => section.questions);
      if (new Set(manifest.sections.map((section) => section.id)).size !== manifest.sections.length) issues.push({ item, message: "section ids repeat" });
      for (const id of placed) if (!ids.includes(id)) issues.push({ item, message: `section lists unknown question ${id}` });
      for (const id of ids) {
        const count = placed.filter((entry) => entry === id).length;
        if (count !== 1) issues.push({ item, message: `question ${id} is in ${count} sections (needs exactly one)` });
      }
    }
    for (const id of Object.keys(privateData.answers)) {
      if (!ids.includes(id)) issues.push({ item, message: `answer ${id} has no question` });
    }
  }
  return issues;
}
