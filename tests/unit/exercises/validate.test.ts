import { describe, expect, it } from "vitest";
import type { LoadedExerciseSet } from "@/lib/content/repository";
import type { PrivateAnswer, PublicQuestion } from "@/lib/exercises/schema";
import { validateExerciseSets } from "@/lib/exercises/validate";

const BASE = { why: "Because it is so.", skill: "java.a", dimension: "concept" as const };

function set(questions: PublicQuestion[], answers: Record<string, PrivateAnswer>, sections?: LoadedExerciseSet["manifest"]["sections"]): LoadedExerciseSet {
  return {
    manifest: {
      kind: "exercise-set",
      id: "java.set",
      version: 1,
      title: "A set",
      summary: "A summary long enough.",
      world: { id: "world.test", order: 1 },
      estimatedMinutes: 5,
      questions,
      ...(sections && { sections }),
      review: { status: "draft" },
      provenance: { author: "t", license: "t", source: "original" },
    },
    privateData: { answers },
  };
}

const messages = (sets: LoadedExerciseSet[], taken: string[] = []) => validateExerciseSets(sets, new Set(["java.a"]), new Set(taken)).map((issue) => issue.message);
const CHOICE: PublicQuestion = { id: "c", type: "single_choice", prompt: "Pick one", options: ["a", "b"] };

describe("validateExerciseSets", () => {
  it("validate_wellFormedSet_hasNoIssues", () => {
    expect(messages([set([CHOICE], { c: { type: "single_choice", answer: 1, ...BASE } })])).toEqual([]);
  });

  it("validate_questionWithoutAnswer_andAnswerWithoutQuestion_areReported", () => {
    expect(messages([set([CHOICE], { other: { type: "true_false", answer: true, ...BASE } })])).toEqual(["question c has no answer", "answer other has no question"]);
  });

  it("validate_answerOfTheWrongType_isReported", () => {
    expect(messages([set([CHOICE], { c: { type: "true_false", answer: true, ...BASE } })]).join()).toMatch(/is single_choice but its answer is true_false/);
  });

  it("validate_choiceOutOfRange_isReported", () => {
    expect(messages([set([CHOICE], { c: { type: "single_choice", answer: 2, ...BASE } })]).join()).toMatch(/answer 2 is not an option/);
  });

  it("validate_patternWithoutAnOptimalApproach_isReported", () => {
    const pattern: PublicQuestion = { id: "p", type: "pattern", prompt: "Which approach?", options: ["a", "b"] };

    expect(messages([set([pattern], { p: { type: "pattern", grades: ["valid", "incorrect"], ...BASE } })]).join()).toMatch(/at least one optimal/);
  });

  it("validate_orderAlreadyInTheRightOrder_isReported", () => {
    const order: PublicQuestion = { id: "o", type: "order", prompt: "Order these", steps: ["a", "b", "c"] };

    expect(messages([set([order], { o: { type: "order", answer: [0, 1, 2], ...BASE } })]).join()).toMatch(/already shown in the correct order/);
  });

  it("validate_blankCountMismatch_isReported", () => {
    const blank: PublicQuestion = { id: "f", type: "fill_blank", prompt: "Fill it in", code: "x.____(____)" };

    expect(messages([set([blank], { f: { type: "fill_blank", answer: [["a"]], ...BASE } })]).join()).toMatch(/2 blanks but 1/);
  });

  it("validate_predictOutputWithoutAMainClass_isReported", () => {
    const output: PublicQuestion = { id: "t", type: "predict_output", prompt: "What prints?", code: "System.out.println(1);" };

    expect(messages([set([output], { t: { type: "predict_output", answer: "1", ...BASE } })]).join()).toMatch(/complete program/);
  });

  it("validate_unknownSkill_isReported", () => {
    expect(messages([set([CHOICE], { c: { type: "single_choice", answer: 0, ...BASE, skill: "java.zzz" } })]).join()).toMatch(/unknown skill java.zzz/);
  });

  it("validate_idUsedByAQuest_isReported", () => {
    expect(messages([set([CHOICE], { c: { type: "single_choice", answer: 0, ...BASE } })], ["java.set"]).join()).toMatch(/also used by a quest/);
  });

  it("validate_questionInNoSectionOrTwo_isReported", () => {
    const second: PublicQuestion = { ...CHOICE, id: "d" };
    const answers = { c: { type: "single_choice" as const, answer: 0, ...BASE }, d: { type: "single_choice" as const, answer: 0, ...BASE } };

    const found = messages([set([CHOICE, second], answers, [{ id: "s1", name: "One", questions: ["c"] }, { id: "s2", name: "Two", questions: ["c", "x"] }])]);

    expect(found).toEqual(["section lists unknown question x", "question c is in 2 sections (needs exactly one)", "question d is in 0 sections (needs exactly one)"]);
  });
});
