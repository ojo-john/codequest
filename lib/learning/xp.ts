import type { ExecutionOutcome } from "@/lib/execution/outcome";
import type { Independence } from "./mastery";

/**
 * XP awards (spec §36, §70). Every award has a business event key, and the database keeps one
 * row per (user, event key) forever — so retries, reprocessing and grinding the same quest can
 * never award twice. XP is never deducted for asking for help; the independent bonus is simply
 * reserved for a later unassisted success.
 */

export const XP = Object.freeze({
  codingChallenge: 30,
  noHintBonus: 20,
  /** Own tests that catch the planted bugs (spec §19); earned once per quest like the others. */
  testQuality: 20,
});

export interface XpAward {
  readonly eventKey: string;
  readonly delta: number;
}

export function xpAwardsFor(contentId: string, outcome: ExecutionOutcome, independence: Independence, testsCaughtTheBugs = false): XpAward[] {
  if (outcome !== "succeeded") return [];
  const awards: XpAward[] = [{ eventKey: `quest-pass:${contentId}`, delta: XP.codingChallenge }];
  if (independence === "independent" || independence === "accessibility_supported") {
    awards.push({ eventKey: `quest-independent:${contentId}`, delta: XP.noHintBonus });
  }
  if (testsCaughtTheBugs) awards.push({ eventKey: `quest-tests:${contentId}`, delta: XP.testQuality });
  return awards;
}
