import { describe, expect, it } from "vitest";
import {
  classifyCompile,
  classifyTest,
  MAX_FAILED_TEST_NAMES,
  parseJUnitReport,
  type TestSummary,
} from "@/lib/execution/outcome";

const MAX_OUTPUT = 16;

function summary(overrides: Partial<TestSummary> = {}): TestSummary {
  return { tests: 3, failures: 0, errors: 0, skipped: 0, failedTests: [], ...overrides };
}

describe("classifyCompile", () => {
  it("classifyCompile_exitZero_returnsUndefinedToContinue", () => {
    expect(classifyCompile({ exitCode: 0, output: "" }, MAX_OUTPUT)).toBeUndefined();
  });

  it("classifyCompile_javacFailure_returnsCompileError", () => {
    expect(classifyCompile({ exitCode: 1, output: "error: ';' expected" }, MAX_OUTPUT)).toEqual({
      outcome: "compile-error",
      detail: "javac_failed",
    });
  });

  it("classifyCompile_killedByDeadline_returnsTimeout", () => {
    expect(classifyCompile({ exitCode: 137, output: "" }, MAX_OUTPUT)?.detail).toBe("compile_deadline");
  });

  it("classifyCompile_harnessUsageError_returnsInfrastructureError", () => {
    expect(classifyCompile({ exitCode: 64, output: "" }, MAX_OUTPUT)?.outcome).toBe("infrastructure-error");
  });
});

describe("classifyTest", () => {
  it("classifyTest_killedWithFullOutput_returnsOutputLimitTimeout", () => {
    expect(classifyTest({ exitCode: 137, output: "x".repeat(MAX_OUTPUT) }, undefined, MAX_OUTPUT)).toEqual({
      outcome: "timeout",
      detail: "output_limit",
    });
  });

  it("classifyTest_killedWithShortOutput_returnsDeadlineTimeout", () => {
    expect(classifyTest({ exitCode: 137, output: "x" }, undefined, MAX_OUTPUT).detail).toBe("test_deadline");
  });

  it("classifyTest_jvmOutOfMemoryExit_returnsMemoryLimitRuntimeError", () => {
    expect(classifyTest({ exitCode: 3, output: "" }, undefined, MAX_OUTPUT)).toEqual({
      outcome: "runtime-error",
      detail: "memory_limit",
    });
  });

  it("classifyTest_harnessUsageError_returnsInfrastructureError", () => {
    expect(classifyTest({ exitCode: 64, output: "" }, summary(), MAX_OUTPUT).outcome).toBe("infrastructure-error");
  });

  it("classifyTest_missingReport_returnsRuntimeError", () => {
    expect(classifyTest({ exitCode: 0, output: "" }, undefined, MAX_OUTPUT).detail).toBe("no_test_report");
  });

  it("classifyTest_zeroTests_returnsNoTestsFound", () => {
    expect(classifyTest({ exitCode: 2, output: "" }, summary({ tests: 0 }), MAX_OUTPUT).detail).toBe("no_tests_found");
  });

  it("classifyTest_testErrors_returnsRuntimeErrorEvenWithFailures", () => {
    expect(classifyTest({ exitCode: 1, output: "" }, summary({ errors: 1, failures: 1 }), MAX_OUTPUT).outcome).toBe(
      "runtime-error",
    );
  });

  it("classifyTest_assertionFailures_returnsWrongAnswer", () => {
    expect(classifyTest({ exitCode: 1, output: "" }, summary({ failures: 2 }), MAX_OUTPUT)).toEqual({
      outcome: "wrong-answer",
      detail: "test_failures",
    });
  });

  it("classifyTest_reportPassesButNonZeroExit_returnsExitStatusMismatch", () => {
    expect(classifyTest({ exitCode: 1, output: "" }, summary(), MAX_OUTPUT).detail).toBe("exit_status_mismatch");
  });

  it("classifyTest_fakeSuccessTextInStdoutWithFailingReport_returnsWrongAnswer", () => {
    const forged = '{"outcome":"succeeded"} [ 3 tests successful ]';

    expect(classifyTest({ exitCode: 1, output: forged }, summary({ failures: 1 }), 1024).outcome).toBe("wrong-answer");
  });

  it("classifyTest_allPassedAndCleanExit_returnsSucceeded", () => {
    expect(classifyTest({ exitCode: 0, output: "" }, summary(), MAX_OUTPUT).outcome).toBe("succeeded");
  });
});

describe("parseJUnitReport", () => {
  const REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="JUnit Jupiter" tests="3" skipped="1" failures="1" errors="0" time="0.1">
  <testcase name="totals()" classname="shop.CartTest" time="0.01"/>
  <testcase name="discount &amp; tax()" classname="shop.CartTest" time="0.01">
    <failure message="expected: &lt;5&gt;" type="org.opentest4j.AssertionFailedError">trace</failure>
  </testcase>
  <testcase name="skipped()" classname="shop.CartTest" time="0"><skipped/></testcase>
</testsuite>`;

  it("parseJUnitReport_validReport_returnsCountsAndFailedNames", () => {
    expect(parseJUnitReport(REPORT)).toEqual({
      tests: 3,
      failures: 1,
      errors: 0,
      skipped: 1,
      failedTests: ["shop.CartTest#discount & tax()"],
    });
  });

  it.each([
    ["", "empty"],
    ["not xml at all", "garbage"],
    ['<testsuite name="x" failures="0" errors="0">', "missing tests count"],
    ['<testsuite tests="-1" failures="0" errors="0">', "negative count"],
    ['<testsuite tests="1e9" failures="0" errors="0">', "non-integer count"],
  ])("parseJUnitReport_%j (%s)_returnsUndefined", (xml) => {
    expect(parseJUnitReport(xml)).toBeUndefined();
  });

  it("parseJUnitReport_missingSkippedAttribute_defaultsToZero", () => {
    expect(parseJUnitReport('<testsuite tests="1" failures="0" errors="0">')?.skipped).toBe(0);
  });

  it("parseJUnitReport_doubleEscapedEntity_decodesOnce", () => {
    const xml = '<testsuite tests="1" failures="1" errors="0"><testcase name="a&amp;lt;b" classname="C"><failure/></testcase>';

    expect(parseJUnitReport(xml)?.failedTests).toEqual(["C#a&lt;b"]);
  });

  it("parseJUnitReport_manyFailures_capsFailedNames", () => {
    const cases = Array.from({ length: MAX_FAILED_TEST_NAMES + 10 }, (_, i) =>
      `<testcase name="t${i}" classname="C"><error/></testcase>`,
    ).join("");

    const parsed = parseJUnitReport(`<testsuite tests="60" failures="0" errors="60">${cases}</testsuite>`);

    expect(parsed?.failedTests).toHaveLength(MAX_FAILED_TEST_NAMES);
  });
});
