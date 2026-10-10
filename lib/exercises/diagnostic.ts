import type { ExerciseOutcome } from "./grade";
import type { ExerciseSection } from "./schema";

/**
 * Base Camp diagnostic (spec §3): a transparent adaptive rule. Sections (areas) are taken in
 * order and each section's questions run from easiest to hardest; a section ends after
 * MISSES_TO_STOP wrong answers or when it runs out. Placement never skips fundamentals: a strong
 * area is suggested as a quick review, not hidden.
 */

export const DIAGNOSTIC_WORLD = "world.base-camp";
export const MISSES_TO_STOP = 2;
/** At least this share right (partial counts half), on at least MIN_ASKED questions, reads as strong. */
export const STRONG_SHARE = 0.75;
export const MIN_ASKED = 3;

export type Outcomes = ReadonlyMap<string, ExerciseOutcome>;

/** The next question to ask, or undefined when every section is finished. */
export function nextDiagnosticQuestion(sections: readonly ExerciseSection[], outcomes: Outcomes): { sectionId: string; questionId: string } | undefined {
  for (const section of sections) {
    const misses = section.questions.filter((id) => outcomes.get(id) === "fail").length;
    if (misses >= MISSES_TO_STOP) continue;
    const next = section.questions.find((id) => !outcomes.has(id));
    if (next !== undefined) return { sectionId: section.id, questionId: next };
  }
  return undefined;
}

export type Placement = "strong" | "start_here" | "not_assessed";

export interface SectionResult {
  readonly sectionId: string;
  readonly name: string;
  readonly asked: number;
  readonly correct: number;
  readonly partial: number;
  readonly placement: Placement;
}

export function placementSummary(sections: readonly ExerciseSection[], outcomes: Outcomes): SectionResult[] {
  return sections.map((section) => {
    const answered = section.questions.flatMap((id) => {
      const outcome = outcomes.get(id);
      return outcome === undefined ? [] : [outcome];
    });
    const correct = answered.filter((outcome) => outcome === "pass").length;
    const partial = answered.filter((outcome) => outcome === "partial").length;
    const share = answered.length === 0 ? 0 : (correct + partial / 2) / answered.length;
    const placement: Placement = answered.length === 0 ? "not_assessed" : answered.length >= MIN_ASKED && share >= STRONG_SHARE ? "strong" : "start_here";
    return { sectionId: section.id, name: section.name, asked: answered.length, correct, partial, placement };
  });
}
