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
    /** Visible samples: graded by Run, with expected values shown to the learner. */
    visible: z.boolean().default(false),
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

/** Only the visible sample cases (what Run grades). Undefined when a contract has none. */
export function visibleSamples(contract: ContractDefinition): ContractDefinition | undefined {
  const cases = contract.cases.filter((testCase) => testCase.visible);
  return cases.length === 0 ? undefined : { ...contract, cases };
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
  z.object({
    case: z.string(),
    step: z.number().int(),
    status: z.literal("returned"),
    // Optional: absent when unserializable. (Zod 4 treats a bare z.unknown() key as required.)
    value: z.unknown().optional(),
    /** The value couldn't be represented as JSON; fine unless the contract expects a value. */
    unserializable: z.literal(true).optional(),
    message: z.string().optional(),
  }),
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
    error: z.enum(["missing_member", "bad_argument"]),
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
    // runtime bad_argument is learner-caused — e.g. a method returned null or the wrong type and
    // a later step used it — and is never reported as an infrastructure error.
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
  if (record.status !== "returned" || record.unserializable) return "fail";
  return valuesMatch(record.value, expectation.value, expectation.compare) ? "pass" : "fail";
}

/** What the learner sees about one step of a VISIBLE sample case. */
export interface SampleStepResult {
  readonly step: number;
  readonly passed: boolean;
  /** Human-readable call, e.g. `Checkout.lineTotalCents(250, 3)`. */
  readonly call: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  /** What happened instead, when not a plain value (thrown exception, missing member, …). */
  readonly note?: string;
}

/**
 * Per-case outcome. Hidden cases expose only their id and pass/fail — never their inputs'
 * expectations; visible samples also carry step details for Run feedback.
 */
export interface CaseResult {
  readonly id: string;
  readonly visible: boolean;
  readonly passed: boolean;
  readonly steps?: readonly SampleStepResult[];
}

export interface ContractGrade extends Classification {
  readonly summary: TestSummary;
  readonly cases: readonly CaseResult[];
}

/** Renders a contract argument like Java source: refs by name, lists as [a, b]. */
function describeArg(arg: unknown): string {
  if (Array.isArray(arg)) return `[${arg.map(describeArg).join(", ")}]`;
  if (arg !== null && typeof arg === "object") {
    const record = arg as Record<string, unknown>;
    if (typeof record.$ref === "string") return record.$ref;
    if (typeof record.$bigint === "string") return `${record.$bigint}L`;
  }
  return JSON.stringify(arg);
}

function describeCall(step: ContractStep): string {
  const args = step.args.map(describeArg);
  if ("new" in step) return `new ${step.new.split(".").pop()}(${args.join(", ")})`;
  const owner = "static" in step ? step.static.split(".").pop() : step.target;
  return `${owner}.${step.call}(${args.join(", ")})`;
}

function describeRecord(record: StepRecord | undefined): Pick<SampleStepResult, "actual" | "note"> {
  if (record === undefined || record.status === "skipped") return { note: "did not run" };
  if (record.status === "returned") return record.unserializable ? { note: "returned a value that can't be shown" } : { actual: record.value };
  if (record.status === "threw") return { note: `threw ${record.exception}: ${record.message}` };
  if (record.status === "error") return { note: record.error === "missing_member" ? `not found: ${record.message}` : record.message };
  if (record.status === "void") return { note: "returned nothing (void)" };
  return { note: "created" };
}

function describeExpected(step: ContractStep): unknown {
  if (step.expect === undefined) return undefined;
  return "throws" in step.expect ? `throws ${step.expect.throws}` : step.expect.value;
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
  const cases: CaseResult[] = [];

  for (const testCase of contract.cases) {
    let casePassed = true;
    const sampleSteps: SampleStepResult[] = [];
    testCase.steps.forEach((step, index) => {
      const record = results.records.get(recordKey(testCase.id, index));
      const verdict = judgeStep(step, record);
      const graded = step.expect !== undefined;
      if (testCase.visible && (graded || verdict !== "pass")) {
        sampleSteps.push({ step: index, passed: verdict === "pass", call: describeCall(step), expected: describeExpected(step), ...describeRecord(record) });
      }
      if (graded) tests += 1;
      if (verdict === "pass") return;
      casePassed = false;
      if (verdict === "missing") {
        // The runner skips the rest of a case after a structural error (missing member, bad
        // argument); those skipped steps are failures already explained by that error.
        const earlierFailed = testCase.steps.slice(0, index).some((_, i) => results.records.get(recordKey(testCase.id, i))?.status === "error");
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
    cases.push(testCase.visible ? { id: testCase.id, visible: true, passed: casePassed, steps: sampleSteps } : { id: testCase.id, visible: false, passed: casePassed });
  }

  const summary: TestSummary = { tests, failures: failures + missingMembers, errors, skipped: 0, failedTests };
  if (missing > 0 || !results.done) {
    return { outcome: "runtime-error", detail: results.malformed ? "unreadable_results" : "incomplete_results", summary, cases };
  }
  if (errors > 0) return { outcome: "runtime-error", detail: "uncaught_exception", summary, cases };
  if (missingMembers > 0) return { outcome: "wrong-answer", detail: "missing_member", summary, cases };
  if (failures > 0) return { outcome: "wrong-answer", detail: "contract_failures", summary, cases };
  if (exitCode !== 0) return { outcome: "runtime-error", detail: "exit_status_mismatch", summary, cases };
  return { outcome: "succeeded", detail: "all_contract_steps_passed", summary, cases };
}
