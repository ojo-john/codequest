import type { ExecutionOutcome } from "@/lib/execution/outcome";

/**
 * Mastery evidence and per-skill estimates (spec §21, §61, §70).
 *
 * Deliberately simple, transparent rules (spec §61: start with rules; trained models only when
 * enough evidence exists). Estimates are learning estimates, not calibrated probabilities.
 */

export const MASTERY_MODEL_VERSION = "rules-v1";
export const SCHEDULER_VERSION = "ladder-v1";

export type SkillDimension = "concept" | "recognition" | "implementation" | "complexity" | "explanation" | "testing" | "communication" | "design";
export type Independence = "independent" | "hinted" | "solution_revealed" | "accessibility_supported";
export type EvidenceOutcome = "pass" | "partial" | "fail";

export interface SkillTag {
  readonly skill: string;
  readonly dimension: SkillDimension;
}

export interface EvidenceRow {
  readonly skillId: string;
  readonly dimension: SkillDimension;
  readonly outcome: EvidenceOutcome;
  readonly independence: Independence;
  readonly modelVersion: string;
}

/** Hint tier 5 is the full solution; any lower tier counts as hinted (spec §15, §70). */
export const SOLUTION_HINT_TIER = 5;

export function independenceFor(hintLevel: number): Independence {
  if (hintLevel >= SOLUTION_HINT_TIER) return "solution_revealed";
  if (hintLevel > 0) return "hinted";
  return "independent";
}

/**
 * Evidence from a graded submission. Infrastructure failures and cancellations produce NO
 * evidence: they never count against the learner (spec §47, §70).
 */
export function evidenceFor(
  outcome: ExecutionOutcome,
  tags: readonly SkillTag[],
  independence: Independence,
  /**
   * For quests that grade the learner's own tests: the outcome for "testing"-dimension tags, which
   * comes from test quality rather than from the code passing. undefined there = no evidence.
   */
  testing?: { readonly outcome: EvidenceOutcome | undefined },
): EvidenceRow[] {
  if (outcome === "infrastructure-error" || outcome === "cancelled") return [];
  const result: EvidenceOutcome = outcome === "succeeded" ? "pass" : "fail";
  return tags.flatMap((tag) => {
    const tagOutcome = tag.dimension === "testing" && testing !== undefined ? testing.outcome : result;
    return tagOutcome === undefined ? [] : [{ skillId: tag.skill, dimension: tag.dimension, outcome: tagOutcome, independence, modelVersion: MASTERY_MODEL_VERSION }];
  });
}

export interface SkillState {
  readonly skillId: string;
  readonly dimension: SkillDimension;
  readonly estimate: number;
  readonly evidenceCount: number;
  readonly reviewDueAt: Date;
}

/** Estimate change per evidence: independent success moves it most; a revealed solution not at all. */
const ESTIMATE_DELTA: Record<EvidenceOutcome, Record<Independence, number>> = {
  pass: { independent: 0.25, accessibility_supported: 0.25, hinted: 0.1, solution_revealed: 0 },
  partial: { independent: 0.1, accessibility_supported: 0.1, hinted: 0.05, solution_revealed: 0 },
  fail: { independent: -0.1, accessibility_supported: -0.1, hinted: -0.1, solution_revealed: -0.1 },
};

/**
 * Review ladder (spec §22: initial intervals 1, 3, 7, 14, 30, 60 days). The rung comes from the
 * estimate; a failure always comes back the next day; an assisted success at most in 3 days.
 */
const LADDER: ReadonlyArray<{ readonly below: number; readonly days: number }> = [
  { below: 0.25, days: 1 },
  { below: 0.5, days: 3 },
  { below: 0.7, days: 7 },
  { below: 0.85, days: 14 },
  { below: 0.95, days: 30 },
  { below: Number.POSITIVE_INFINITY, days: 60 },
];
const MS_PER_DAY = 86_400_000;
const ASSISTED_MAX_DAYS = 3;

export type ReviewReason = "failed_recently" | "assisted_success" | "spaced_review";

export interface SkillStateUpdate extends SkillState {
  readonly reason: ReviewReason;
  readonly intervalDays: number;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function updateSkillState(previous: SkillState | undefined, evidence: EvidenceRow, now: Date): SkillStateUpdate {
  const before = previous?.estimate ?? 0;
  const estimate = round3(Math.min(1, Math.max(0, before + ESTIMATE_DELTA[evidence.outcome][evidence.independence])));
  let intervalDays = LADDER.find((rung) => estimate < rung.below)!.days;
  let reason: ReviewReason = "spaced_review";
  if (evidence.outcome === "fail") {
    intervalDays = 1;
    reason = "failed_recently";
  } else if (evidence.independence === "hinted" || evidence.independence === "solution_revealed") {
    intervalDays = Math.min(intervalDays, ASSISTED_MAX_DAYS);
    reason = "assisted_success";
  }
  return {
    skillId: evidence.skillId,
    dimension: evidence.dimension,
    estimate,
    evidenceCount: (previous?.evidenceCount ?? 0) + 1,
    reviewDueAt: new Date(now.getTime() + intervalDays * MS_PER_DAY),
    reason,
    intervalDays,
  };
}

/** Mastery states shown to the learner (spec §21). Insufficient evidence is said, not guessed. */
export type MasteryState = "new" | "learning" | "developing" | "strong" | "mastered" | "rusty";

export const MIN_EVIDENCE_FOR_MASTERY = 3;

export function masteryState(state: SkillState | undefined, now: Date): MasteryState {
  if (state === undefined || state.evidenceCount === 0) return "new";
  const overdueDays = (now.getTime() - state.reviewDueAt.getTime()) / MS_PER_DAY;
  if (state.estimate >= 0.7 && overdueDays > 14) return "rusty";
  if (state.estimate >= 0.85 && state.evidenceCount >= MIN_EVIDENCE_FOR_MASTERY) return "mastered";
  if (state.estimate >= 0.7) return "strong";
  if (state.estimate >= 0.4) return "developing";
  return "learning";
}
