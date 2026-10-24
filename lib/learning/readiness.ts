import { masteryState, MIN_EVIDENCE_FOR_MASTERY, type SkillState } from "./mastery";

/**
 * Readiness (spec §40, §41), kept apart from XP. Per track, a difficulty-weighted average of skill
 * estimates in which a skill with no evidence counts as zero, so breadth is required and easy
 * skills carry less weight: grinding one easy item can't inflate it. A rusty skill (review long
 * overdue) counts at half. Until enough of a track's skills have real evidence, the track reports
 * "insufficient evidence" instead of a number.
 */

export const READINESS_VERSION = "readiness-v1";
/** Share of a track's skills that need MIN_EVIDENCE_FOR_MASTERY pieces of evidence before scoring. */
export const MIN_COVERAGE = 0.5;
const RUSTY_FACTOR = 0.5;

export const TRACKS = [
  { id: "java", name: "Java", categories: ["java"] },
  { id: "big-o", name: "Complexity (Big-O)", categories: ["big-o"] },
  { id: "data-structures", name: "Data structures", categories: ["data-structures"] },
  { id: "patterns", name: "Patterns and recognition", categories: ["patterns"] },
  { id: "debugging", name: "Debugging", categories: ["debugging"] },
  { id: "system-design", name: "System design", categories: ["system-design"] },
  { id: "practical", name: "Practical Java", categories: ["practical"] },
  { id: "lld", name: "Low-level design", categories: ["lld"] },
  { id: "behavioral", name: "Behavioral", categories: ["behavioral"] },
] as const;

/** Tracks the spec asks for whose content doesn't exist yet: shown, never scored. Mock
 *  interviews now count through the interview-ready criteria (lib/learning/ready-criteria). */
export const UNAVAILABLE_TRACKS: readonly string[] = [];

export type ReadinessLevel = "building" | "developing" | "strong";

export interface TrackReadiness {
  readonly id: string;
  readonly name: string;
  readonly skillCount: number;
  /** Skills with at least MIN_EVIDENCE_FOR_MASTERY pieces of evidence. */
  readonly evidencedSkills: number;
  readonly status: "scored" | "insufficient_evidence";
  /** 0–1; only when scored. */
  readonly score?: number;
  readonly level?: ReadinessLevel;
  /** How many more skills need evidence before the track is scored. */
  readonly skillsStillNeeded: number;
}

export interface ReadinessSkill {
  readonly id: string;
  readonly category: string;
  readonly difficulty: number;
}

function levelFor(score: number): ReadinessLevel {
  if (score >= 0.65) return "strong";
  return score >= 0.35 ? "developing" : "building";
}

export function computeReadiness(skills: readonly ReadinessSkill[], states: readonly SkillState[], now: Date): TrackReadiness[] {
  return TRACKS.map((track) => {
    const members = skills.filter((skill) => (track.categories as readonly string[]).includes(skill.category));
    let weighted = 0;
    let weights = 0;
    let evidenced = 0;
    for (const skill of members) {
      const own = states.filter((state) => state.skillId === skill.id);
      const evidence = own.reduce((sum, state) => sum + state.evidenceCount, 0);
      if (evidence >= MIN_EVIDENCE_FOR_MASTERY) evidenced += 1;
      const estimate = own.length === 0 ? 0 : own.reduce((sum, state) => sum + state.estimate, 0) / own.length;
      const rusty = own.some((state) => masteryState(state, now) === "rusty");
      weighted += skill.difficulty * estimate * (rusty ? RUSTY_FACTOR : 1);
      weights += skill.difficulty;
    }
    const needed = Math.max(0, Math.ceil(MIN_COVERAGE * members.length) - evidenced);
    const base = { id: track.id, name: track.name, skillCount: members.length, evidencedSkills: evidenced, skillsStillNeeded: needed };
    if (members.length === 0 || needed > 0) return { ...base, status: "insufficient_evidence" as const };
    const score = Math.round((weighted / weights) * 100) / 100;
    return { ...base, status: "scored" as const, score, level: levelFor(score) };
  });
}
