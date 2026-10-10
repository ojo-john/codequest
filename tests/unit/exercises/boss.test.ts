import { describe, expect, it } from "vitest";
import { bossResult } from "@/lib/exercises/boss";
import type { ExerciseOutcome } from "@/lib/exercises/grade";

const SECTIONS = [
  { id: "loops", name: "Loops", questions: ["a", "b", "c", "d"] },
  { id: "space", name: "Space", questions: ["e", "f"] },
];
const outcomes = (entries: Array<[string, ExerciseOutcome]>) => new Map(entries);

describe("bossResult", () => {
  it("bossResult_everySectionAtTheShare_passes", () => {
    const result = bossResult(SECTIONS, outcomes([["a", "pass"], ["b", "pass"], ["c", "pass"], ["d", "fail"], ["e", "pass"], ["f", "pass"]]), 0.75);

    expect([result.passed, result.sections.map((section) => [section.share, section.passed])]).toEqual([true, [[0.75, true], [1, true]]]);
  });

  it("bossResult_oneWeakSection_failsOverallEvenIfTheAverageIsHigh", () => {
    const result = bossResult(SECTIONS, outcomes([["a", "pass"], ["b", "pass"], ["c", "pass"], ["d", "pass"], ["e", "fail"], ["f", "pass"]]), 0.7);

    expect([result.passed, result.sections[1].passed]).toEqual([false, false]);
  });

  it("bossResult_unansweredQuestions_countAsWrong", () => {
    const result = bossResult(SECTIONS, outcomes([["a", "pass"]]), 0.25);

    expect([result.sections[0].share, result.sections[0].answered, result.sections[1].passed]).toEqual([0.25, 1, false]);
  });

  it("bossResult_partialAnswers_countHalf", () => {
    expect(bossResult(SECTIONS, outcomes([["e", "partial"], ["f", "pass"]]), 0.7).sections[1].share).toBe(0.75);
  });

  it("bossResult_noSections_neverPasses", () => {
    expect(bossResult([], new Map(), 0.5).passed).toBe(false);
  });
});
