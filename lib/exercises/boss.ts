import type { ExerciseOutcome } from "./grade";
import type { ExerciseSection } from "./schema";

/**
 * World mastery exams (spec §53): every section (dimension) is judged on its own against the
 * pass share, so a strong area can't hide a weak one, and the result names the sections to work
 * on. Partial answers count half. Perfection is unnecessary: the share is below 1 by design.
 */

export interface BossSectionResult {
  readonly sectionId: string;
  readonly name: string;
  readonly answered: number;
  readonly total: number;
  /** 0–1 over the section's questions; unanswered questions count as wrong. */
  readonly share: number;
  readonly passed: boolean;
}

export interface BossResult {
  readonly passed: boolean;
  readonly sections: readonly BossSectionResult[];
}

const CREDIT: Record<ExerciseOutcome, number> = { pass: 1, partial: 0.5, fail: 0 };

export function bossResult(sections: readonly ExerciseSection[], outcomes: ReadonlyMap<string, ExerciseOutcome>, passShare: number): BossResult {
  const results = sections.map((section) => {
    const credit = section.questions.reduce((sum, id) => sum + (outcomes.has(id) ? CREDIT[outcomes.get(id)!] : 0), 0);
    const share = section.questions.length === 0 ? 0 : credit / section.questions.length;
    return {
      sectionId: section.id,
      name: section.name,
      answered: section.questions.filter((id) => outcomes.has(id)).length,
      total: section.questions.length,
      share: Math.round(share * 100) / 100,
      passed: share >= passShare,
    };
  });
  return { passed: results.length > 0 && results.every((result) => result.passed), sections: results };
}
