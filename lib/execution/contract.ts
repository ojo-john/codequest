import { z } from "zod";
import type { Classification, TestSummary } from "./outcome";
import { MAX_FAILED_TEST_NAMES } from "./outcome";

/**
 * Method-contract grading (spec §65): the server keeps every expected value; the sandbox only
 * receives the public scenario (constructor/method calls and their arguments) and reports what
 * the learner's code returned or threw. Forging the results file therefore gains nothing without
 * already knowing the hidden answers — unlike JUnit grading, where assertions run in the same
 * JVM as learner code.
 */

const JAVA_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const CLASS_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*(\$[A-Za-z0-9_$]+)*$/;
const TYPE_NAME = /^[A-Za-z_$][A-Za-z0-9_$.]*(\$[A-Za-z0-9_$]+)*(\[\])*$/;
const BINDING = /^[a-z][A-Za-z0-9_]{0,31}$/;

const comparisonSchema = z.union([
  z.literal("exact"),
  /** Arrays compared as multisets (e.g. results from a HashSet). */
  z.literal("unordered"),
  z.object({ tolerance: z.number().nonnegative() }),
]);

const expectationSchema = z.union([
  z.object({ value: z.unknown(), compare: comparisonSchema.default("exact") }).strict(),
  /** Passes if the thrown exception is this class or a subclass of it. */
  z.object({ throws: z.string().regex(CLASS_NAME) }).strict(),
]);

const stepCommon = {
  args: z.array(z.unknown()).default([]),
  /** Required: an exact signature means learner overloads can never make a lookup ambiguous. */
  paramTypes: z.array(z.string().regex(TYPE_NAME)),
  as: z.string().regex(BINDING).optional(),
  /** Server-only. Steps without one must merely complete (setup steps). */
  expect: expectationSchema.optional(),
};

const newStepSchema = z.object({ new: z.string().regex(CLASS_NAME), ...stepCommon }).strict();
const staticCallSchema = z.object({ call: z.string().regex(JAVA_IDENTIFIER), static: z.string().regex(CLASS_NAME), ...stepCommon }).strict();
const instanceCallSchema = z.object({ call: z.string().regex(JAVA_IDENTIFIER), target: z.string().regex(BINDING), ...stepCommon }).strict();
const stepSchema = z.union([newStepSchema, staticCallSchema, instanceCallSchema]);

const contractCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    steps: z.array(stepSchema).min(1).max(50),
  })
  .strict();

export const contractDefinitionSchema = z
  .object({
    version: z.literal(1),
    cases: z.array(contractCaseSchema).min(1).max(200),
  })
  .strict()
  .superRefine((contract, ctx) => {
    const ids = new Set<string>();
    contract.cases.forEach((testCase, caseIndex) => {
      if (ids.has(testCase.id)) ctx.addIssue({ code: "custom", message: `duplicate case id ${testCase.id}`, path: ["cases", caseIndex, "id"] });
      ids.add(testCase.id);
      const bound = new Set<string>();
      testCase.steps.forEach((step, stepIndex) => {
        const path = ["cases", caseIndex, "steps", stepIndex];
        if (step.args.length !== step.paramTypes.length) {
          ctx.addIssue({ code: "custom", message: "args and paramTypes differ in length", path });
        }
        if ("target" in step && !bound.has(step.target)) {
          ctx.addIssue({ code: "custom", message: `target ${step.target} is not bound by an earlier step`, path });
        }
        for (const ref of collectRefs(step.args)) {
          if (!bound.has(ref)) ctx.addIssue({ code: "custom", message: `$ref ${ref} is not bound by an earlier step`, path });
        }
        if ("new" in step && step.expect !== undefined && "value" in step.expect) {
          ctx.addIssue({ code: "custom", message: "a constructor step can only expect `throws`", path });
        }
        if (step.as !== undefined) bound.add(step.as);
      });
    });
  });

export type ContractDefinition = z.infer<typeof contractDefinitionSchema>;
type ContractStep = ContractDefinition["cases"][number]["steps"][number];
type Expectation = z.infer<typeof expectationSchema>;
type Comparison = z.infer<typeof comparisonSchema>;

function collectRefs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectRefs);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.$ref === "string") return [record.$ref];
    return Object.values(record).flatMap(collectRefs);
  }
  return [];
}

/** The only part of a contract that ever enters the sandbox: every `expect` removed. */
export function publicContractSpec(contract: ContractDefinition): unknown {
  return {
    cases: contract.cases.map((testCase) => ({
      id: testCase.id,
      steps: testCase.steps.map((step) => Object.fromEntries(Object.entries(step).filter(([key]) => key !== "expect"))),
    })),
  };
}

// ---- Results from the runner -----------------------------------------------------------------

const stepRecordSchema = z.discriminatedUnion("status", [
  z.object({ case: z.string(), step: z.number().int(), status: z.literal("created") }),
  z.object({ case: z.string(), step: z.number().int(), status: z.literal("void") }),
  z.object({ case: z.string(), step: z.number().int(), status: z.literal("returned"), value: z.unknown() }),
  z.object({
    case: z.string(),
    step: z.number().int(),
    status: z.literal("threw"),
    exception: z.string(),
    hierarchy: z.array(z.string()),
    message: z.string(),
  }),
  z.object({
    case: z.string(),
    step: z.number().int(),
    status: z.literal("error"),
    error: z.enum(["missing_member", "bad_argument", "unserializable"]),
    message: z.string(),
  }),
  z.object({ case: z.string(), step: z.number().int(), status: z.literal("skipped") }),
]);

type StepRecord = z.infer<typeof stepRecordSchema>;

export interface ParsedContractResults {
  readonly records: ReadonlyMap<string, StepRecord>;
  readonly done: boolean;
  /** A line that was neither a step record nor the done marker (learner tampering or a crash mid-write). */
  readonly malformed: boolean;
}

const recordKey = (caseId: string, step: number) => `${caseId}#${step}`;

export function parseContractResults(text: string): ParsedContractResults {
  const records = new Map<string, StepRecord>();
  let done = false;
  let malformed = false;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      malformed = true;
      continue;
    }
    if (json !== null && typeof json === "object" && (json as { done?: unknown }).done === true) {
      done = true;
      continue;
    }
    const parsed = stepRecordSchema.safeParse(json);
    if (!parsed.success) {
      malformed = true;
      continue;
    }
    // First record wins: a later duplicate can only come from something other than the runner.
    const key = recordKey(parsed.data.case, parsed.data.step);
    if (!records.has(key)) records.set(key, parsed.data);
  }
  return { records, done, malformed };
}

// ---- Comparison ------------------------------------------------------------------------------

export function valuesMatch(actual: unknown, expected: unknown, comparison: Comparison): boolean {
  if (typeof comparison === "object") return deepEqual(actual, expected, comparison.tolerance);
  if (comparison === "unordered") {
    if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false;
    const remaining = [...expected];
    for (const item of actual) {
      const index = remaining.findIndex((candidate) => deepEqual(item, candidate, 0));
      if (index === -1) return false;
      remaining.splice(index, 1);
    }
    return true;
  }
  return deepEqual(actual, expected, 0);
}

function deepEqual(actual: unknown, expected: unknown, tolerance: number): boolean {
  if (typeof actual === "number" && typeof expected === "number") {
    return tolerance === 0 ? actual === expected : Math.abs(actual - expected) <= tolerance;
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((item, i) => deepEqual(item, expected[i], tolerance))
    );
  }
  if (actual !== null && expected !== null && typeof actual === "object" && typeof expected === "object") {
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    const keys = Object.keys(e);
    return Object.keys(a).length === keys.length && keys.every((key) => key in a && deepEqual(a[key], e[key], tolerance));
  }
  return actual === expected;
}

// ---- Grading ---------------------------------------------------------------------------------

type StepVerdict = "pass" | "fail" | "error" | "missing_member" | "missing";

function judgeStep(step: ContractStep, record: StepRecord | undefined): StepVerdict {
  if (record === undefined || record.status === "skipped") return "missing";
  if (record.status === "error") {
    // Every published contract must pass against its reference solution (content gate), so a
    // runtime bad_argument/unserializable is learner-caused — e.g. a method returned null or the
    // wrong type and a later step used it — and is never reported as an infrastructure error.
    return record.error === "missing_member" ? "missing_member" : "fail";
  }
  const expectation: Expectation | undefined = step.expect;
  if (record.status === "threw") {
    if (expectation !== undefined && "throws" in expectation) {
      return record.hierarchy.includes(expectation.throws) ? "pass" : "fail";
    }
    return "error";
  }
  if (expectation === undefined) return "pass";
  if ("throws" in expectation) return "fail";
  if (record.status !== "returned") return "fail";
  return valuesMatch(record.value, expectation.value, expectation.compare) ? "pass" : "fail";
}

export interface ContractGrade extends Classification {
  readonly summary: TestSummary;
}

/**
 * Grades runner results against the hidden expectations. Every step with an `expect` counts as
 * one test; setup steps count only when they fail (they invalidate the case).
 */
export function gradeContract(contract: ContractDefinition, results: ParsedContractResults, exitCode: number): ContractGrade {
  let tests = 0;
  let failures = 0;
  let errors = 0;
  let missingMembers = 0;
  let missing = 0;
  const failedTests: string[] = [];

  for (const testCase of contract.cases) {
    testCase.steps.forEach((step, index) => {
      const verdict = judgeStep(step, results.records.get(recordKey(testCase.id, index)));
      const graded = step.expect !== undefined;
      if (graded) tests += 1;
      if (verdict === "pass") return;
      if (verdict === "missing") {
        // A step skipped after an earlier failure in the same case is already accounted for.
        const earlierFailed = testCase.steps.slice(0, index).some((_, i) => {
          const record = results.records.get(recordKey(testCase.id, i));
          return record?.status === "threw" || record?.status === "error";
        });
        if (earlierFailed) {
          if (graded) failures += 1;
          return;
        }
        missing += 1;
        return;
      }
      if (verdict === "error") errors += 1;
      else if (verdict === "missing_member") missingMembers += 1;
      else failures += 1;
      if (!graded) tests += 1;
      if (failedTests.length < MAX_FAILED_TEST_NAMES) failedTests.push(`${testCase.id}#${index}`);
    });
  }

  const summary: TestSummary = { tests, failures: failures + missingMembers, errors, skipped: 0, failedTests };
  if (missing > 0 || !results.done) {
    return { outcome: "runtime-error", detail: results.malformed ? "unreadable_results" : "incomplete_results", summary };
  }
  if (errors > 0) return { outcome: "runtime-error", detail: "uncaught_exception", summary };
  if (missingMembers > 0) return { outcome: "wrong-answer", detail: "missing_member", summary };
  if (failures > 0) return { outcome: "wrong-answer", detail: "contract_failures", summary };
  if (exitCode !== 0) return { outcome: "runtime-error", detail: "exit_status_mismatch", summary };
  return { outcome: "succeeded", detail: "all_contract_steps_passed", summary };
}
