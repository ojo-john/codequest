import { describe, expect, it } from "vitest";
import { isLearnerTest, scoreTestQuality, testingOutcome, type TestQualityReport, type TestQualitySpec } from "@/lib/execution/test-quality";

const SPEC: TestQualitySpec = {
  target: "src/main/java/shop/Parser.java",
  baseline: "ref",
  mutants: [
    { id: "a", description: "bug a", content: "a" },
    { id: "b", description: "bug b", content: "b" },
    { id: "c", description: "bug c", content: "c" },
    { id: "d", description: "bug d", content: "d" },
    { id: "e", description: "bug e", content: "e" },
  ],
  passRatio: 0.8,
};
const PASSED = { kind: "tests_passed" } as const;
const FAILED = { kind: "tests_failed", failedTests: [] } as const;

function graded(caught: number, total = 5): TestQualityReport {
  return { status: "graded", caught: Array.from({ length: caught }, (_, i) => `m${i}`), missed: [], total };
}

describe("scoreTestQuality", () => {
  it("scoreTestQuality_baselineNotRun_isIncomplete", () => {
    expect(scoreTestQuality(SPEC, { kind: "not_run" }, []).status).toBe("incomplete");
  });

  it("scoreTestQuality_testsDontCompileAgainstReference_isInvalid", () => {
    expect(scoreTestQuality(SPEC, { kind: "compile_error" }, []).status).toBe("invalid_tests");
  });

  it("scoreTestQuality_fewerVerdictsThanMutants_isIncomplete", () => {
    expect(scoreTestQuality(SPEC, PASSED, [FAILED, FAILED]).status).toBe("incomplete");
  });

  it("scoreTestQuality_everyMutantRun_countsCaughtAndMissedInOrder", () => {
    const report = scoreTestQuality(SPEC, PASSED, [FAILED, PASSED, FAILED, FAILED, PASSED]);

    expect([report.caught, report.missed.map((mutant) => mutant.id), report.total]).toEqual([["a", "c", "d"], ["b", "e"], 5]);
  });
});

describe("testingOutcome", () => {
  it("testingOutcome_atPassRatio_isPass", () => {
    expect(testingOutcome(graded(4), 0.8)).toBe("pass");
  });

  it("testingOutcome_belowRatioButSomeCaught_isPartial", () => {
    expect(testingOutcome(graded(3), 0.8)).toBe("partial");
  });

  it("testingOutcome_noneCaught_isFail", () => {
    expect(testingOutcome(graded(0), 0.8)).toBe("fail");
  });

  it("testingOutcome_noTests_isFail", () => {
    expect(testingOutcome({ status: "no_tests", caught: [], missed: [], total: 5 }, 0.8)).toBe("fail");
  });

  it("testingOutcome_incomplete_isNoEvidence", () => {
    expect(testingOutcome({ status: "incomplete", caught: [], missed: [], total: 5 }, 0.8)).toBeUndefined();
  });

  it("testingOutcome_noJudgeableMutants_isNoEvidence", () => {
    expect(testingOutcome(graded(0, 0), 0.8)).toBeUndefined();
  });
});

describe("paths", () => {
  it("isLearnerTest_mainSource_isFalse", () => {
    expect([isLearnerTest("src/test/java/shop/PTest.java"), isLearnerTest("src/main/java/shop/P.java")]).toEqual([true, false]);
  });

});
