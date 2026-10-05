import { describe, expect, it } from "vitest";
import {
  contractDefinitionSchema,
  gradeContract,
  parseContractResults,
  publicContractSpec,
  valuesMatch,
  type ContractDefinition,
} from "@/lib/execution/contract";

const LINE_ITEM = "shop.LineItem";
const CALC = "shop.PriceCalculator";

/** tea (250 × 3) + cake (400 × 1) => 1150; plus a case expecting a constructor to reject quantity 0. */
function contract(): ContractDefinition {
  return contractDefinitionSchema.parse({
    version: 1,
    cases: [
      {
        id: "two-items",
        steps: [
          { new: LINE_ITEM, args: ["tea", 250, 3], paramTypes: ["java.lang.String", "long", "int"], as: "tea" },
          { new: LINE_ITEM, args: ["cake", 400, 1], paramTypes: ["java.lang.String", "long", "int"], as: "cake" },
          {
            call: "totalCents",
            static: CALC,
            args: [[{ $ref: "tea" }, { $ref: "cake" }]],
            paramTypes: ["java.util.List"],
            expect: { value: 1150 },
          },
        ],
      },
      {
        id: "rejects-zero-quantity",
        steps: [{ new: LINE_ITEM, args: ["tea", 250, 0], paramTypes: ["java.lang.String", "long", "int"], expect: { throws: "java.lang.IllegalArgumentException" } }],
      },
    ],
  });
}

const created = (caseId: string, step: number) => JSON.stringify({ case: caseId, step, status: "created" });
const returned = (caseId: string, step: number, value: unknown) => JSON.stringify({ case: caseId, step, status: "returned", value });
const threw = (caseId: string, step: number, exception: string, hierarchy: string[]) =>
  JSON.stringify({ case: caseId, step, status: "threw", exception, hierarchy, message: "m" });
const DONE = JSON.stringify({ done: true });
const IAE = ["java.lang.IllegalArgumentException", "java.lang.RuntimeException", "java.lang.Exception", "java.lang.Throwable", "java.lang.Object"];

function resultsFor(total: unknown, zeroQuantityLine = threw("rejects-zero-quantity", 0, IAE[0], IAE)): string {
  return [created("two-items", 0), created("two-items", 1), returned("two-items", 2, total), zeroQuantityLine, DONE].join("\n");
}

describe("contractDefinitionSchema", () => {
  const base = { version: 1, cases: [{ id: "c", steps: [] as unknown[] }] };
  const withSteps = (steps: unknown[]) => ({ ...base, cases: [{ id: "c", steps }] });

  it("parse_targetNotBoundEarlier_rejects", () => {
    expect(contractDefinitionSchema.safeParse(withSteps([{ call: "size", target: "cart", args: [], paramTypes: [] }])).success).toBe(false);
  });

  it("parse_refNotBoundEarlier_rejects", () => {
    const step = { call: "f", static: "A", args: [{ $ref: "later" }], paramTypes: ["B"] };
    expect(contractDefinitionSchema.safeParse(withSteps([step])).success).toBe(false);
  });

  it("parse_argsAndParamTypesDifferInLength_rejects", () => {
    expect(contractDefinitionSchema.safeParse(withSteps([{ call: "f", static: "A", args: [1], paramTypes: [] }])).success).toBe(false);
  });

  it("parse_missingParamTypes_rejects", () => {
    expect(contractDefinitionSchema.safeParse(withSteps([{ call: "f", static: "A", args: [] }])).success).toBe(false);
  });

  it("parse_callWithBothStaticAndTarget_rejects", () => {
    const steps = [{ new: "A", paramTypes: [], as: "a" }, { call: "f", static: "A", target: "a", paramTypes: [] }];
    expect(contractDefinitionSchema.safeParse(withSteps(steps)).success).toBe(false);
  });

  it("parse_constructorExpectingValue_rejects", () => {
    expect(contractDefinitionSchema.safeParse(withSteps([{ new: "A", paramTypes: [], expect: { value: 1 } }])).success).toBe(false);
  });

  it("parse_duplicateCaseIds_rejects", () => {
    const step = { call: "f", static: "A", paramTypes: [] };
    expect(contractDefinitionSchema.safeParse({ version: 1, cases: [{ id: "c", steps: [step] }, { id: "c", steps: [step] }] }).success).toBe(false);
  });

  it("parse_shellMetacharactersInClassName_rejects", () => {
    expect(contractDefinitionSchema.safeParse(withSteps([{ new: "A;rm -rf", paramTypes: [] }])).success).toBe(false);
  });

  it("parse_validScenario_defaultsComparisonToExact", () => {
    const step = contract().cases[0].steps[2];
    expect(step.expect).toEqual({ value: 1150, compare: "exact" });
  });
});

describe("publicContractSpec", () => {
  it("publicContractSpec_validContract_containsNoExpectedValues", () => {
    const spec = JSON.stringify(publicContractSpec(contract()));

    expect([spec.includes("expect"), spec.includes("1150"), spec.includes("IllegalArgumentException")]).toEqual([false, false, false]);
  });
});

describe("parseContractResults", () => {
  it("parseContractResults_garbageLine_flagsMalformedButKeepsValidRecords", () => {
    const parsed = parseContractResults(`${created("c", 0)}\nnot json\n{"case":"c","step":1,"status":"passed"}\n${DONE}`);

    expect([parsed.records.size, parsed.malformed, parsed.done]).toEqual([1, true, true]);
  });

  it("parseContractResults_duplicateRecord_firstOneWins", () => {
    const parsed = parseContractResults([returned("c", 0, 1), returned("c", 0, 999)].join("\n"));

    expect(parsed.records.get("c#0")).toMatchObject({ value: 1 });
  });

  it("parseContractResults_emptyText_isIncomplete", () => {
    expect(parseContractResults("")).toMatchObject({ done: false, malformed: false });
  });
});

describe("valuesMatch", () => {
  it("valuesMatch_unorderedSameMultiset_matches", () => {
    expect(valuesMatch([3, 1, 2, 1], [1, 1, 2, 3], "unordered")).toBe(true);
  });

  it("valuesMatch_unorderedDifferentMultiplicity_doesNotMatch", () => {
    expect(valuesMatch([1, 2, 2], [1, 1, 2], "unordered")).toBe(false);
  });

  it("valuesMatch_exactDifferentOrder_doesNotMatch", () => {
    expect(valuesMatch([2, 1], [1, 2], "exact")).toBe(false);
  });

  it("valuesMatch_withinTolerance_matchesNested", () => {
    expect(valuesMatch({ ratio: [0.30000000000000004] }, { ratio: [0.3] }, { tolerance: 1e-9 })).toBe(true);
  });

  it("valuesMatch_objectKeyOrder_isIgnored", () => {
    expect(valuesMatch({ a: 1, b: 2 }, { b: 2, a: 1 }, "exact")).toBe(true);
  });

  it("valuesMatch_extraKeyInActual_doesNotMatch", () => {
    expect(valuesMatch({ a: 1, b: 2 }, { a: 1 }, "exact")).toBe(false);
  });

  it("valuesMatch_nullVersusObject_doesNotMatch", () => {
    expect(valuesMatch(null, {}, "exact")).toBe(false);
  });

  it("valuesMatch_bigintMarkers_compareByDigits", () => {
    expect(valuesMatch({ $bigint: "18014398509481984" }, { $bigint: "18014398509481984" }, "exact")).toBe(true);
  });
});

describe("gradeContract", () => {
  it("gradeContract_resultsCutOffWithoutDone_returnsIncompleteRuntimeError", () => {
    const grade = gradeContract(contract(), parseContractResults([created("two-items", 0)].join("\n")), 0);

    expect([grade.outcome, grade.detail]).toEqual(["runtime-error", "incomplete_results"]);
  });

  it("gradeContract_forgedLinesOnly_returnsUnreadableResults", () => {
    const forged = '{"case":"two-items","step":2,"status":"passed"}\n{"done":true}';

    expect(gradeContract(contract(), parseContractResults(forged), 0).detail).toBe("unreadable_results");
  });

  it("gradeContract_forgedWrongValueWithDoneMarker_returnsWrongAnswer", () => {
    expect(gradeContract(contract(), parseContractResults(resultsFor(999_999)), 0).outcome).toBe("wrong-answer");
  });

  it("gradeContract_unexpectedException_returnsUncaughtExceptionAndSkipsCase", () => {
    const lines = [
      created("two-items", 0),
      created("two-items", 1),
      threw("two-items", 2, "java.lang.NullPointerException", ["java.lang.NullPointerException"]),
      threw("rejects-zero-quantity", 0, IAE[0], IAE),
      DONE,
    ].join("\n");

    const grade = gradeContract(contract(), parseContractResults(lines), 0);

    expect([grade.outcome, grade.detail, grade.summary.failedTests]).toEqual(["runtime-error", "uncaught_exception", ["two-items#2"]]);
  });

  it("gradeContract_setupStepThrows_countsAsErrorAndSkippedStepAsFailure", () => {
    const lines = [
      threw("two-items", 0, "java.lang.IllegalStateException", ["java.lang.IllegalStateException"]),
      JSON.stringify({ case: "two-items", step: 1, status: "skipped" }),
      JSON.stringify({ case: "two-items", step: 2, status: "skipped" }),
      threw("rejects-zero-quantity", 0, IAE[0], IAE),
      DONE,
    ].join("\n");

    const grade = gradeContract(contract(), parseContractResults(lines), 0);

    expect([grade.outcome, grade.summary.tests, grade.summary.errors, grade.summary.failures]).toEqual(["runtime-error", 3, 1, 1]);
  });

  it("gradeContract_missingMember_returnsWrongAnswerMissingMember", () => {
    const lines = [
      JSON.stringify({ case: "two-items", step: 0, status: "error", error: "missing_member", message: "shop.LineItem" }),
      JSON.stringify({ case: "two-items", step: 1, status: "skipped" }),
      JSON.stringify({ case: "two-items", step: 2, status: "skipped" }),
      threw("rejects-zero-quantity", 0, IAE[0], IAE),
      DONE,
    ].join("\n");

    expect(gradeContract(contract(), parseContractResults(lines), 0).detail).toBe("missing_member");
  });

  it("gradeContract_returnedNullUsedLater_badArgumentIsLearnerFailure", () => {
    const lines = [
      created("two-items", 0),
      created("two-items", 1),
      JSON.stringify({ case: "two-items", step: 2, status: "error", error: "bad_argument", message: "target is null" }),
      threw("rejects-zero-quantity", 0, IAE[0], IAE),
      DONE,
    ].join("\n");

    expect(gradeContract(contract(), parseContractResults(lines), 0).outcome).toBe("wrong-answer");
  });

  it("gradeContract_expectedExceptionNotThrown_returnsWrongAnswer", () => {
    expect(gradeContract(contract(), parseContractResults(resultsFor(1150, created("rejects-zero-quantity", 0))), 0).outcome).toBe("wrong-answer");
  });

  it("gradeContract_subclassOfExpectedException_passes", () => {
    const nfe = ["java.lang.NumberFormatException", ...IAE];

    const grade = gradeContract(contract(), parseContractResults(resultsFor(1150, threw("rejects-zero-quantity", 0, nfe[0], nfe))), 0);

    expect(grade.outcome).toBe("succeeded");
  });

  it("gradeContract_allPassedButNonZeroExit_returnsExitStatusMismatch", () => {
    expect(gradeContract(contract(), parseContractResults(resultsFor(1150)), 1).detail).toBe("exit_status_mismatch");
  });

  it("gradeContract_allStepsPass_succeedsCountingOnlyGradedSteps", () => {
    const grade = gradeContract(contract(), parseContractResults(resultsFor(1150)), 0);

    expect([grade.outcome, grade.summary.tests, grade.summary.failures]).toEqual(["succeeded", 2, 0]);
  });
});
