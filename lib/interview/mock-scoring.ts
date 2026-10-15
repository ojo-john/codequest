import { z } from "zod";

/**
 * Mock interview scoring (spec §33, §34), rubric "mock-v1". Pure: the same plan, submissions and
 * times always give the same result. Only what the evidence shows is scored; anything that
 * would need a human or a model to judge is reported as not assessed, never as a zero. The
 * overall label is a practice rubric, not a prediction of any employer's decision.
 */

export const MOCK_RUBRIC_VERSION = "mock-v1";
export const MOCK_DURATIONS = [45, 60] as const;
export const MOCK_DISCLAIMER = "A practice rubric from this session's evidence, not a prediction of any employer's hiring decision.";

/** A plan answer counts as written once it has this many non-space characters. */
const MIN_WRITTEN_CHARS = 15;
/** Submissions graded this long after the deadline still count (a submit already in flight). */
export const SUBMISSION_GRACE_MS = 60_000;
/** Below this share of hidden checks passed, a best attempt shows little working code. */
const PARTIAL_PASS_SHARE = 0.5;
/** Failed submissions before the passing one that still count as testing first. */
const TESTED_FIRST_MAX_FAILURES = 1;

const answer = z.string().max(2000).default("");

/** The interview workflow the learner writes down before coding (spec §33). */
export const mockPlanSchema = z
  .object({
    clarify: answer,
    examples: answer,
    bruteForce: answer,
    optimized: answer,
    complexity: answer,
  })
  .strict();

export type MockPlan = z.infer<typeof mockPlanSchema>;

export const PLAN_PROMPTS: ReadonlyArray<{ readonly id: keyof MockPlan; readonly title: string; readonly guidance: string }> = [
  { id: "clarify", title: "Clarify", guidance: "Restate the problem and write the questions you'd ask: input sizes, edge cases, what to return when nothing matches." },
  { id: "examples", title: "Examples", guidance: "Work one or two small examples by hand, including an edge case." },
  { id: "bruteForce", title: "Brute force", guidance: "The simplest correct approach and its cost." },
  { id: "optimized", title: "Better approach", guidance: "How you'll improve on it, and why that works." },
  { id: "complexity", title: "Expected complexity", guidance: "Time and space for the approach you'll code, before you code it." },
];

export type DimensionStatus = "strong" | "partial" | "weak" | "not_assessed";

export interface MockSubmission {
  readonly createdAt: Date;
  readonly outcome: string;
  readonly cases: ReadonlyArray<{ readonly passed: boolean }>;
}

export interface MockResult {
  readonly rubricVersion: typeof MOCK_RUBRIC_VERSION;
  readonly overall: "strong" | "mixed" | "needs_work";
  readonly disclaimer: string;
  readonly solved: boolean;
  readonly submissions: number;
  readonly minutesUsed: number;
  readonly dimensions: ReadonlyArray<{ readonly id: string; readonly name: string; readonly status: DimensionStatus; readonly evidence: string }>;
  readonly nextActions: readonly string[];
}

export interface MockScoringInput {
  readonly plan: MockPlan;
  readonly startedAt: Date;
  readonly endsAt: Date;
  readonly finishedAt: Date;
  /** Graded submissions for the mock's problem, any order. */
  readonly submissions: readonly MockSubmission[];
}

const written = (text: string) => text.replace(/\s/g, "").length >= MIN_WRITTEN_CHARS;
const passShare = (submission: MockSubmission) => (submission.cases.length === 0 ? 0 : submission.cases.filter((c) => c.passed).length / submission.cases.length);

/** Submissions inside the interview window (plus grace), oldest first. */
export function inWindow(input: Pick<MockScoringInput, "startedAt" | "endsAt" | "finishedAt" | "submissions">): MockSubmission[] {
  const close = Math.min(input.finishedAt.getTime(), input.endsAt.getTime() + SUBMISSION_GRACE_MS);
  return input.submissions
    .filter((submission) => submission.createdAt.getTime() >= input.startedAt.getTime() && submission.createdAt.getTime() <= close)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function scoreMock(input: MockScoringInput): MockResult {
  const submissions = inWindow(input);
  const firstPass = submissions.findIndex((submission) => submission.outcome === "succeeded");
  const solved = firstPass >= 0;
  const best = submissions.reduce((max, submission) => Math.max(max, passShare(submission)), 0);
  const end = solved ? submissions[firstPass].createdAt : input.finishedAt;
  const minutesUsed = Math.max(0, Math.round((Math.min(end.getTime(), input.endsAt.getTime()) - input.startedAt.getTime()) / 60_000));

  const coding: DimensionStatus = solved ? "strong" : best >= PARTIAL_PASS_SHARE ? "partial" : "weak";
  const codingEvidence = solved
    ? `Every hidden check passed after ${minutesUsed} minute${minutesUsed === 1 ? "" : "s"}.`
    : submissions.length === 0
      ? "No submission inside the time limit."
      : `Best submission passed ${Math.round(best * 100)}% of the hidden checks.`;

  const testing: DimensionStatus = !solved ? (submissions.length === 0 ? "not_assessed" : "weak") : firstPass <= TESTED_FIRST_MAX_FAILURES ? "strong" : "partial";
  const testingEvidence = !solved
    ? submissions.length === 0
      ? "Nothing was submitted, so there's no evidence either way."
      : "No submission passed, so the testing before submitting didn't catch the failures."
    : `${firstPass} failed submission${firstPass === 1 ? "" : "s"} before the passing one.`;

  const workflow = (["clarify", "examples", "bruteForce", "optimized"] as const).filter((id) => written(input.plan[id]));
  const communication: DimensionStatus = workflow.length >= 3 ? "strong" : workflow.length === 2 ? "partial" : "weak";
  const named = PLAN_PROMPTS.filter((prompt) => (workflow as readonly string[]).includes(prompt.id)).map((prompt) => prompt.title.toLowerCase());
  const communicationEvidence = `Wrote ${workflow.length} of 4 workflow steps${named.length > 0 ? ` (${named.join(", ")})` : ""}. Completeness only: the quality of what you'd say isn't judged automatically.`;

  const complexity: DimensionStatus = written(input.plan.complexity) ? "partial" : "weak";
  const complexityEvidence = written(input.plan.complexity)
    ? "Stated before coding. Whether it's right isn't checked here; the problem's follow-up questions check it afterwards."
    : "Not stated before coding.";

  const dimensions = [
    { id: "coding", name: "Working code", status: coding, evidence: codingEvidence },
    { id: "testing", name: "Testing before submitting", status: testing, evidence: testingEvidence },
    { id: "communication", name: "Interview workflow", status: communication, evidence: communicationEvidence },
    { id: "complexity", name: "Complexity stated up front", status: complexity, evidence: complexityEvidence },
    { id: "algorithm", name: "Algorithm choice", status: "not_assessed" as const, evidence: "Needs a reviewer to judge; not scored automatically." },
  ];

  const nextActions: string[] = [];
  if (coding !== "strong") nextActions.push("Finish this problem outside the mock, then retry a fresh one: the unsolved problem returns in your reviews.");
  if (testing === "partial" || testing === "weak") nextActions.push("Before submitting, trace your own examples and edge cases through the code.");
  if (communication !== "strong") nextActions.push("Practise the workflow out loud: clarify, examples, brute force, then the better approach, before writing code.");
  if (complexity === "weak") nextActions.push("State time and space complexity before you code, then check it after.");

  const overall = coding === "strong" && communication !== "weak" && testing !== "weak" ? "strong" : coding !== "weak" ? "mixed" : "needs_work";
  return { rubricVersion: MOCK_RUBRIC_VERSION, overall, disclaimer: MOCK_DISCLAIMER, solved, submissions: submissions.length, minutesUsed, dimensions, nextActions };
}
