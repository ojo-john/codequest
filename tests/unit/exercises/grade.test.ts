import { describe, expect, it } from "vitest";
import { gradeAnswer, InvalidResponseError, normalizeFragment, normalizeOutput } from "@/lib/exercises/grade";
import type { PrivateAnswer, PublicQuestion } from "@/lib/exercises/schema";

const BASE = { why: "Because it is so.", skill: "java.collections", dimension: "concept" as const };

function grade(question: PublicQuestion, answer: PrivateAnswer, response: unknown) {
  return gradeAnswer(question, answer, response).outcome;
}

describe("gradeAnswer: shape checks", () => {
  const single: PublicQuestion = { id: "q", type: "single_choice", prompt: "Pick one", options: ["a", "b"] };
  const singleAnswer: PrivateAnswer = { type: "single_choice", answer: 1, ...BASE };

  it("gradeAnswer_responseOfTheWrongShape_isInvalidNotWrong", () => {
    expect(() => gradeAnswer(single, singleAnswer, { text: "b" })).toThrow(InvalidResponseError);
  });

  it("gradeAnswer_choiceOutOfRange_isInvalid", () => {
    expect(() => gradeAnswer(single, singleAnswer, { choice: 2 })).toThrow(InvalidResponseError);
  });

  it("gradeAnswer_extraFieldsInResponse_areInvalid", () => {
    expect(() => gradeAnswer(single, singleAnswer, { choice: 1, cheat: true })).toThrow(InvalidResponseError);
  });

  it("gradeAnswer_answerTypeMismatch_isAContentBug", () => {
    expect(() => gradeAnswer(single, { type: "true_false", answer: true, ...BASE }, { choice: 0 })).toThrow(/single_choice but its answer is true_false/);
  });
});

describe("gradeAnswer: by type", () => {
  it("singleChoice_rightAndWrong", () => {
    const q: PublicQuestion = { id: "q", type: "single_choice", prompt: "Pick one", options: ["a", "b"] };
    const a: PrivateAnswer = { type: "single_choice", answer: 1, ...BASE };

    expect([grade(q, a, { choice: 1 }), grade(q, a, { choice: 0 })]).toEqual(["pass", "fail"]);
  });

  it("multiChoice_exactSetPasses_subsetIsPartial_anyWrongPickFails", () => {
    const q: PublicQuestion = { id: "q", type: "multi_choice", prompt: "Pick all", options: ["a", "b", "c"] };
    const a: PrivateAnswer = { type: "multi_choice", answer: [0, 2], ...BASE };

    expect([grade(q, a, { choices: [2, 0] }), grade(q, a, { choices: [0] }), grade(q, a, { choices: [0, 1, 2] }), grade(q, a, { choices: [] })]).toEqual(["pass", "partial", "fail", "fail"]);
  });

  it("trueFalse_compares", () => {
    const q: PublicQuestion = { id: "q", type: "true_false", prompt: "Is it so?" };

    expect(grade(q, { type: "true_false", answer: false, ...BASE }, { value: false })).toBe("pass");
  });

  it("predictOutput_ignoresTrailingSpacesAndNewlinesButNotLeadingSpaces", () => {
    const q: PublicQuestion = { id: "q", type: "predict_output", prompt: "What prints?", code: "class Main {}" };
    const a: PrivateAnswer = { type: "predict_output", answer: "1\n  2\n", ...BASE };

    expect([grade(q, a, { text: "1  \r\n  2" }), grade(q, a, { text: "1\n2" })]).toEqual(["pass", "fail"]);
  });

  it("bigO_mustBeOneOfTheOffered", () => {
    const q: PublicQuestion = { id: "q", type: "big_o", prompt: "Time?", ask: "time" };
    const a: PrivateAnswer = { type: "big_o", answer: "O(n^2)", ...BASE };

    expect([grade(q, a, { choice: "O(n^2)" }), grade(q, a, { choice: "O(n)" })]).toEqual(["pass", "fail"]);
    expect(() => gradeAnswer(q, a, { choice: "O(n^4)" })).toThrow(InvalidResponseError);
  });

  it("bigO_customOptions_replaceTheCanonicalList", () => {
    const q: PublicQuestion = { id: "q", type: "big_o", prompt: "Time?", ask: "time", options: ["O(n + m)", "O(n * m)"] };

    expect(grade(q, { type: "big_o", answer: "O(n + m)", ...BASE }, { choice: "O(n + m)" })).toBe("pass");
  });

  it("pattern_optimalPasses_validIsPartial_incorrectFails", () => {
    const q: PublicQuestion = { id: "q", type: "pattern", prompt: "Which approach?", options: ["window", "brute force", "binary search"] };
    const a: PrivateAnswer = { type: "pattern", grades: ["optimal", "valid", "incorrect"], ...BASE };

    expect([grade(q, a, { choice: 0 }), grade(q, a, { choice: 1 }), grade(q, a, { choice: 2 })]).toEqual(["pass", "partial", "fail"]);
  });

  it("order_exactPasses_mostlyRightIsPartial_notAPermutationIsInvalid", () => {
    const q: PublicQuestion = { id: "q", type: "order", prompt: "Order them", steps: ["c", "a", "b", "d", "e"] };
    const a: PrivateAnswer = { type: "order", answer: [1, 2, 0, 3, 4], ...BASE };

    expect([grade(q, a, { order: [1, 2, 0, 3, 4] }), grade(q, a, { order: [1, 2, 0, 4, 3] }), grade(q, a, { order: [0, 1, 2, 3, 4] })]).toEqual(["pass", "partial", "fail"]);
    expect(() => gradeAnswer(q, a, { order: [1, 1, 0, 3, 4] })).toThrow(InvalidResponseError);
  });

  it("fillBlank_acceptsAlternativesAndSpacing_butNotCase", () => {
    const q: PublicQuestion = { id: "q", type: "fill_blank", prompt: "Fill in", code: "map.____(key, ____)" };
    const a: PrivateAnswer = { type: "fill_blank", answer: [["getOrDefault"], ["0", "0L"]], ...BASE };

    expect([grade(q, a, { blanks: [" getOrDefault ", "0L"] }), grade(q, a, { blanks: ["getordefault", "0"] }), grade(q, a, { blanks: ["get", "1"] })]).toEqual(["pass", "partial", "fail"]);
    expect(() => gradeAnswer(q, a, { blanks: ["getOrDefault"] })).toThrow(/Fill in all 2 blanks/);
  });
});

describe("normalizers", () => {
  it("normalizeOutput_emptyOutput_isEmpty", () => {
    expect(normalizeOutput("\n\n")).toBe("");
  });

  it("normalizeFragment_collapsesInnerWhitespace", () => {
    expect(normalizeFragment("  i <   n ")).toBe("i < n");
  });
});
