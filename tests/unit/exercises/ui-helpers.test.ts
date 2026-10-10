import { describe, expect, it } from "vitest";
import { describeCorrect } from "@/components/exercises/exercise-runner";
import { initialValue, isComplete, parseEstimate, responseFor } from "@/components/exercises/question-input";
import type { PublicQuestion } from "@/lib/exercises/schema";

const ORDER: PublicQuestion = { id: "o", type: "order", prompt: "Order these", steps: ["b", "a", "c"] };
const BLANKS: PublicQuestion = { id: "f", type: "fill_blank", prompt: "Fill these", code: "x.____(y, ____)" };
const PATTERN: PublicQuestion = { id: "p", type: "pattern", prompt: "Which approach?", options: ["window", "brute force"] };
const MULTI: PublicQuestion = { id: "m", type: "multi_choice", prompt: "Pick all", options: ["a", "b"] };
const OUTPUT: PublicQuestion = { id: "t", type: "predict_output", prompt: "What prints?", code: "class Main {}" };

describe("initialValue / isComplete", () => {
  it("initialValue_order_startsInTheShownOrderAndIsAnswerable", () => {
    expect([initialValue(ORDER), isComplete(ORDER, initialValue(ORDER))]).toEqual([{ order: [0, 1, 2] }, true]);
  });

  it("initialValue_fillBlank_hasOneEmptyBlankPerMarker", () => {
    expect([initialValue(BLANKS), isComplete(BLANKS, initialValue(BLANKS))]).toEqual([{ blanks: ["", ""] }, false]);
  });

  it("isComplete_multiChoiceWithNothingPicked_isFalse", () => {
    expect([isComplete(MULTI, { choices: [] }), isComplete(MULTI, { choices: [1] })]).toEqual([false, true]);
  });

  it("isComplete_blankOutput_isFalse", () => {
    expect([isComplete(OUTPUT, { text: "  " }), isComplete(OUTPUT, undefined)]).toEqual([false, false]);
  });
});

describe("describeCorrect", () => {
  it("describeCorrect_pattern_gradesEveryApproachInWords", () => {
    expect(describeCorrect(PATTERN, { type: "approaches", grades: ["optimal", "valid"] })).toEqual(["window: best fit", "brute force: works, but not the best fit"]);
  });

  it("describeCorrect_order_listsTheStepsInTheRightOrder", () => {
    expect(describeCorrect(ORDER, { type: "order", order: [1, 0, 2] })).toEqual(["1. a", "2. b", "3. c"]);
  });

  it("describeCorrect_blanks_showAlternatives", () => {
    expect(describeCorrect(BLANKS, { type: "blanks", accepted: [["get"], ["0", "0L"]] })).toEqual(["Blank 1: get", "Blank 2: 0 or 0L"]);
  });

  it("describeCorrect_choice_namesTheOptions", () => {
    expect(describeCorrect(MULTI, { type: "choice", indices: [0, 1] })).toEqual(["a", "b"]);
  });
});

describe("numeric input", () => {
  const NUMERIC: PublicQuestion = { id: "n", type: "numeric", prompt: "How many?", unit: "GB" };

  it.each([
    ["23,148", 23148],
    ["23148.5", 23148.5],
    ["2.3e4", 23000],
    [" 1_000 ", 1000],
    ["-4", -4],
  ])("parseEstimate_%s_is_%s", (raw, expected) => {
    expect(parseEstimate(raw)).toBe(expected);
  });

  it.each(["", "23k", "1.2.3", "abc", "e5"])("parseEstimate_%s_isNotANumber", (raw) => {
    expect(parseEstimate(raw)).toBeUndefined();
  });

  it("numeric_answerableOnlyOnceItParses_andSendsOnlyTheValue", () => {
    expect([isComplete(NUMERIC, { raw: "23k" }), isComplete(NUMERIC, { raw: "23000", value: 23000 }), responseFor(NUMERIC, { raw: "23,000", value: 23000 })]).toEqual([false, true, { value: 23000 }]);
  });

  it("describeCorrect_number_statesUnitAndTolerance", () => {
    expect(describeCorrect(NUMERIC, { type: "number", value: 23148, unit: "QPS", tolerance: 0.1 })).toEqual(["About 23,148 QPS (within 10% counts as right)"]);
  });
});
