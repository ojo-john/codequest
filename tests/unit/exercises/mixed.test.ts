import { describe, expect, it } from "vitest";
import { selectMixed, type MixedSource } from "@/lib/exercises/mixed";
import type { PublicQuestion } from "@/lib/exercises/schema";

/** Deterministic pseudo-random sequence (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const question = (id: string): PublicQuestion => ({ id, type: "true_false", prompt: `Is ${id} true?` });
const source = (id: string, count: number, passed: string[] = []): MixedSource => ({
  contentVersionId: id,
  questions: Array.from({ length: count }, (_, index) => question(`${id}-${index}`)),
  passed: new Set(passed),
});

describe("selectMixed", () => {
  it("selectMixed_takesFromEverySetBeforeRepeatingOne", () => {
    const picked = selectMixed([source("a", 6), source("b", 6), source("c", 6)], seeded(1), 3);

    expect(new Set(picked.map((item) => item.contentVersionId))).toEqual(new Set(["a", "b", "c"]));
  });

  it("selectMixed_prefersQuestionsNotYetPassed", () => {
    const picked = selectMixed([source("a", 4, ["a-0", "a-1", "a-2"])], seeded(2), 1);

    expect(picked.map((item) => item.question.id)).toEqual(["a-3"]);
  });

  it("selectMixed_usesPassedQuestionsOnlyWhenOthersRunOut", () => {
    const picked = selectMixed([source("a", 2, ["a-0"]), source("b", 1)], seeded(3), 3);

    expect(picked.map((item) => item.question.id).sort()).toEqual(["a-0", "a-1", "b-0"]);
  });

  it("selectMixed_fewerQuestionsThanTheSize_returnsAllOfThem", () => {
    expect(selectMixed([source("a", 2)], seeded(4), 8)).toHaveLength(2);
  });

  it("selectMixed_noSources_isEmpty", () => {
    expect(selectMixed([], seeded(5))).toEqual([]);
  });

  it("selectMixed_sameSeed_sameSelection", () => {
    const sources = [source("a", 5), source("b", 5)];

    expect(selectMixed(sources, seeded(9))).toEqual(selectMixed(sources, seeded(9)));
  });
});
