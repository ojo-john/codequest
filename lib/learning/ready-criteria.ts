import type { TrackReadiness } from "./readiness";

/**
 * Interview-ready criteria (spec §55), "ready-v1". The thresholds are the spec's initial,
 * configurable values: product heuristics, not validated guarantees. Every criterion needs a
 * minimum amount of evidence before it can be met; below that it reports "not enough evidence"
 * rather than a pass or a fail.
 */

export const READY_CRITERIA_VERSION = "ready-v1";
export const READY_DISCLAIMER =
  "These are practice heuristics, not a guarantee: real interviews vary by role and format, and no score predicts an employer's decision.";

/** Configuration: one place to change a threshold or a minimum sample. */
export const READY_CONFIG = {
  coreDsa: { threshold: 0.8 },
  java: { threshold: 0.85 },
  systemDesign: { threshold: 0.75 },
  recognition: { threshold: 0.85, minSample: 20 },
  bigO: { threshold: 0.9, minSample: 20 },
  unseenSuccess: { threshold: 0.7, minSample: 10 },
  noHintSuccess: { threshold: 0.6, minSample: 10 },
  recentMocks: { minCount: 2, withinDays: 30 },
} as const;

export interface ReadyInputs {
  readonly readiness: readonly TrackReadiness[];
  readonly recognition: { readonly passed: number; readonly total: number };
  readonly complexity: { readonly passed: number; readonly total: number };
  readonly problems: { readonly attempted: number; readonly solved: number; readonly independent: number };
  /** Finished mocks with their overall label, newest first. */
  readonly mocks: ReadonlyArray<{ readonly finishedAt: Date; readonly overall: "strong" | "mixed" | "needs_work" }>;
  readonly now: Date;
}

export type CriterionStatus = "met" | "not_met" | "insufficient_evidence";

export interface Criterion {
  readonly id: string;
  readonly name: string;
  readonly status: CriterionStatus;
  /** What was measured, e.g. "82% (target 80%)" or "3 of 10 problems needed". */
  readonly detail: string;
}

export interface ReadyVerdict {
  readonly version: typeof READY_CRITERIA_VERSION;
  readonly ready: boolean;
  readonly met: number;
  readonly criteria: readonly Criterion[];
  readonly disclaimer: string;
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

function trackCriterion(id: string, name: string, readiness: readonly TrackReadiness[], trackIds: readonly string[], threshold: number): Criterion {
  const tracks = readiness.filter((track) => trackIds.includes(track.id));
  const unscored = tracks.filter((track) => track.status !== "scored");
  if (tracks.length === 0 || unscored.length > 0) {
    const needed = unscored.reduce((sum, track) => sum + track.skillsStillNeeded, 0);
    return { id, name, status: "insufficient_evidence", detail: `${needed} more skill${needed === 1 ? "" : "s"} need evidence before this is scored` };
  }
  const score = Math.min(...tracks.map((track) => track.score ?? 0));
  return { id, name, status: score >= threshold ? "met" : "not_met", detail: `${percent(score)} (target ${percent(threshold)})` };
}

function rateCriterion(id: string, name: string, count: number, outOf: number, config: { threshold: number; minSample: number }, unit: string): Criterion {
  if (outOf < config.minSample) return { id, name, status: "insufficient_evidence", detail: `${outOf} of ${config.minSample} ${unit} needed before this is scored` };
  const rate = count / outOf;
  return { id, name, status: rate >= config.threshold ? "met" : "not_met", detail: `${percent(rate)} of ${outOf} ${unit} (target ${percent(config.threshold)})` };
}

export function evaluateReadyCriteria(input: ReadyInputs): ReadyVerdict {
  const recentSince = input.now.getTime() - READY_CONFIG.recentMocks.withinDays * 86_400_000;
  const recent = input.mocks.filter((mock) => mock.finishedAt.getTime() >= recentSince);
  const acceptable = recent.length >= READY_CONFIG.recentMocks.minCount && recent[0].overall !== "needs_work" && recent.filter((mock) => mock.overall !== "needs_work").length >= READY_CONFIG.recentMocks.minCount;
  const criteria: Criterion[] = [
    trackCriterion("core-dsa", "Core data structures and patterns", input.readiness, ["data-structures", "patterns"], READY_CONFIG.coreDsa.threshold),
    rateCriterion("recognition", "Pattern recognition", input.recognition.passed, input.recognition.total, READY_CONFIG.recognition, "answers"),
    rateCriterion("big-o", "Complexity (Big-O)", input.complexity.passed, input.complexity.total, READY_CONFIG.bigO, "answers"),
    trackCriterion("java", "Java", input.readiness, ["java"], READY_CONFIG.java.threshold),
    // Problems don't carry difficulty labels yet, so these use every problem attempted.
    rateCriterion("unseen-success", "Problems solved (all attempted)", input.problems.solved, input.problems.attempted, READY_CONFIG.unseenSuccess, "problems"),
    rateCriterion("no-hint-success", "Problems solved without hints", input.problems.independent, input.problems.attempted, READY_CONFIG.noHintSuccess, "problems"),
    trackCriterion("system-design", "System design", input.readiness, ["system-design"], READY_CONFIG.systemDesign.threshold),
    recent.length < READY_CONFIG.recentMocks.minCount
      ? { id: "mocks", name: "Recent mock interviews", status: "insufficient_evidence", detail: `${recent.length} of ${READY_CONFIG.recentMocks.minCount} mocks in the last ${READY_CONFIG.recentMocks.withinDays} days` }
      : { id: "mocks", name: "Recent mock interviews", status: acceptable ? "met" : "not_met", detail: `${recent.length} mocks in the last ${READY_CONFIG.recentMocks.withinDays} days; the latest: ${recent[0].overall.replace("_", " ")}` },
  ];
  const met = criteria.filter((criterion) => criterion.status === "met").length;
  return { version: READY_CRITERIA_VERSION, ready: met === criteria.length, met, criteria, disclaimer: READY_DISCLAIMER };
}
