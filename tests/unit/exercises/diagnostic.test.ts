import { describe, expect, it } from "vitest";
import { nextDiagnosticQuestion, placementSummary } from "@/lib/exercises/diagnostic";
import type { ExerciseOutcome } from "@/lib/exercises/grade";

const SECTIONS = [
  { id: "java", name: "Java", questions: ["j1", "j2", "j3", "j4"] },
  { id: "bigo", name: "Big-O", questions: ["b1", "b2", "b3"] },
];
const outcomes = (entries: Array<[string, ExerciseOutcome]>) => new Map(entries);

describe("nextDiagnosticQuestion", () => {
  it("nextDiagnosticQuestion_start_asksTheFirstSectionsEasiestQuestion", () => {
    expect(nextDiagnosticQuestion(SECTIONS, new Map())).toEqual({ sectionId: "java", questionId: "j1" });
  });

  it("nextDiagnosticQuestion_doingWell_keepsClimbingTheSameSection", () => {
    expect(nextDiagnosticQuestion(SECTIONS, outcomes([["j1", "pass"], ["j2", "partial"]]))).toEqual({ sectionId: "java", questionId: "j3" });
  });

  it("nextDiagnosticQuestion_twoMisses_movesToTheNextSection", () => {
    expect(nextDiagnosticQuestion(SECTIONS, outcomes([["j1", "fail"], ["j2", "fail"]]))).toEqual({ sectionId: "bigo", questionId: "b1" });
  });

  it("nextDiagnosticQuestion_oneMiss_doesNotStopTheSection", () => {
    expect(nextDiagnosticQuestion(SECTIONS, outcomes([["j1", "fail"]]))?.questionId).toBe("j2");
  });

  it("nextDiagnosticQuestion_everythingAnsweredOrStopped_isDone", () => {
    expect(nextDiagnosticQuestion(SECTIONS, outcomes([["j1", "fail"], ["j2", "fail"], ["b1", "pass"], ["b2", "pass"], ["b3", "fail"]]))).toBeUndefined();
  });
});

describe("placementSummary", () => {
  it("placementSummary_mostlyRightOnEnoughQuestions_isStrong", () => {
    const [java] = placementSummary(SECTIONS, outcomes([["j1", "pass"], ["j2", "pass"], ["j3", "pass"], ["j4", "fail"]]));

    expect(java).toEqual({ sectionId: "java", name: "Java", asked: 4, correct: 3, partial: 0, placement: "strong" });
  });

  it("placementSummary_tooFewAnswers_isNeverStrong", () => {
    expect(placementSummary(SECTIONS, outcomes([["j1", "pass"], ["j2", "pass"]]))[0].placement).toBe("start_here");
  });

  it("placementSummary_partialsCountHalf", () => {
    // (2 + 2 × 0.5) / 4 = 75 %: exactly the threshold.
    expect(placementSummary(SECTIONS, outcomes([["j1", "pass"], ["j2", "pass"], ["j3", "partial"], ["j4", "partial"]]))[0].placement).toBe("strong");
  });

  it("placementSummary_untouchedSection_isNotAssessed", () => {
    expect(placementSummary(SECTIONS, new Map())[1].placement).toBe("not_assessed");
  });
});
