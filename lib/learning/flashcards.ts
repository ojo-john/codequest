import { z } from "zod";

/**
 * Personal flashcards (spec §51), "leitner-v1": five boxes. A card the learner knew moves up a box
 * and comes back after that box's interval; a card they didn't goes back to box 1. Cards hold
 * the learner's own words and are never treated as canonical facts.
 */

export const LEITNER_VERSION = "leitner-v1";
/** Days until a card in each box (1–5) is due again. */
export const BOX_INTERVAL_DAYS = [1, 2, 4, 8, 16] as const;
export const MAX_FLASHCARDS = 500;
const MS_PER_DAY = 86_400_000;

export const flashcardInputSchema = z
  .object({
    /** The problem or practice set whose note this card comes from. */
    contentVersionId: z.uuid(),
    front: z.string().trim().min(1).max(500),
    back: z.string().trim().min(1).max(2000),
  })
  .strict();

export const flashcardReviewSchema = z.object({ knewIt: z.boolean() }).strict();

export function nextReview(box: number, knewIt: boolean, now: Date): { box: number; dueAt: Date } {
  const next = knewIt ? Math.min(BOX_INTERVAL_DAYS.length, box + 1) : 1;
  return { box: next, dueAt: new Date(now.getTime() + BOX_INTERVAL_DAYS[next - 1] * MS_PER_DAY) };
}
