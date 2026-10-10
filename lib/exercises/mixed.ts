import type { PublicQuestion } from "./schema";

/**
 * Mixed practice (spec §25): questions drawn from several sets and interleaved, shown under
 * neutral names with no set title or topic, so the learner has to recognise the approach.
 * Unpassed questions come first; each set contributes in turn so no topic dominates.
 */

export const MIXED_SIZE = 8;

export interface MixedSource {
  readonly contentVersionId: string;
  readonly questions: readonly PublicQuestion[];
  /** Questions this learner has already answered correctly. */
  readonly passed: ReadonlySet<string>;
}

export interface MixedItem {
  readonly contentVersionId: string;
  readonly question: PublicQuestion;
}

/** Fisher–Yates with an injected random source (tests pass a seeded one). */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function selectMixed(sources: readonly MixedSource[], random: () => number, size = MIXED_SIZE): MixedItem[] {
  const queues = shuffle(sources, random).map((source) => {
    const ordered = shuffle(source.questions, random).sort((a, b) => Number(source.passed.has(a.id)) - Number(source.passed.has(b.id)));
    return ordered.map((question) => ({ contentVersionId: source.contentVersionId, question, passed: source.passed.has(question.id) }));
  });
  const picked: Array<MixedItem & { passed: boolean }> = [];
  // Round-robin: unpassed questions from every set before any passed ones.
  for (const wantPassed of [false, true]) {
    let progressed = true;
    while (picked.length < size && progressed) {
      progressed = false;
      for (const queue of queues) {
        const index = queue.findIndex((entry) => entry.passed === wantPassed);
        if (index === -1 || picked.length >= size) continue;
        picked.push(queue.splice(index, 1)[0]);
        progressed = true;
      }
    }
  }
  return shuffle(picked, random).map(({ contentVersionId, question }) => ({ contentVersionId, question }));
}
