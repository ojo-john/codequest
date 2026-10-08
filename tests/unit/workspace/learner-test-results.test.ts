import { describe, expect, it } from "vitest";
import { learnerTestsHeadline } from "@/components/workspace/learner-test-results";

const base = { output: "", detail: "" };

describe("learnerTestsHeadline", () => {
  it("learnerTestsHeadline_allPassed_countsThem", () => {
    expect(learnerTestsHeadline({ ...base, outcome: "succeeded", tests: 21 })).toBe("Your tests: all 21 passed.");
  });

  it("learnerTestsHeadline_someFailed_countsFailures", () => {
    expect(learnerTestsHeadline({ ...base, outcome: "wrong-answer", tests: 5, failedTests: ["a#x()", "a#y()"] })).toBe("Your tests: 2 of 5 failed.");
  });

  it("learnerTestsHeadline_noTestMethods_saysSo", () => {
    expect(learnerTestsHeadline({ ...base, outcome: "runtime-error", detail: "no_tests_found" })).toBe("No @Test methods found in your test files.");
  });

  it("learnerTestsHeadline_timeout_pointsAtLoops", () => {
    expect(learnerTestsHeadline({ ...base, outcome: "timeout" })).toContain("took too long");
  });
});
