import type { TrackReadiness } from "./readiness";

/**
 * The endgame mix (spec §54), "endgame-v1": how a session's time divides between learning
 * (practice sets) and problems as the learner progresses. Early 70/30, middle 40/60, late 10/90.
 * The planner never applies the late mix while reviews are due or skills are weak: fundamentals
 * that need work keep their practice.
 */

export type Stage = "early" | "middle" | "late";

export const LEARNING_SHARE: Record<Stage, number> = { early: 0.7, middle: 0.4, late: 0.1 };

/** The tracks that decide the stage: the fundamentals every coding interview leans on. */
export const CORE_TRACKS = ["java", "big-o", "data-structures", "patterns"] as const;
/** Fewer core tracks than this scored, and the learner is still early. */
const MIN_SCORED_FOR_MIDDLE = 2;

export function stageFor(readiness: readonly TrackReadiness[]): Stage {
  const core = readiness.filter((track) => (CORE_TRACKS as readonly string[]).includes(track.id));
  const scored = core.filter((track) => track.status === "scored");
  if (scored.length < MIN_SCORED_FOR_MIDDLE) return "early";
  if (scored.length === CORE_TRACKS.length && scored.every((track) => track.level === "strong")) return "late";
  return "middle";
}

export const STAGE_TEXT: Record<Stage, string> = {
  early: "Early: mostly learning (about 70% practice sets), with a problem each session.",
  middle: "Middle: a balance (about 40% learning, 60% problems).",
  late: "Late: mostly problems and interview practice (about 10% learning), unless reviews are due.",
};
