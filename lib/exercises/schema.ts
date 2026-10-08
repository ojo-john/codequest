import { z } from "zod";
import { contentIdSchema, provenanceSchema, reviewSchema, skillDimensionSchema } from "@/lib/content/schema";

/**
 * Exercise sets (spec §43): short questions with one deterministic grader per type. The public
 * part (shown to learners) holds only what's needed to answer; canonical answers, explanations
 * and skill tags live in the private part and never leave the server before an answer is graded.
 * Hiding tags is what lets mixed mode (spec §25) present neutral challenges later.
 */

export const QUESTION_ID = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);

/** Canonical Big-O choices (spec §7), in order of growth. */
export const BIG_O_CLASSES = ["O(1)", "O(log n)", "O(n)", "O(n log n)", "O(n^2)", "O(n^3)", "O(2^n)", "O(n!)"] as const;

/** Blank marker inside fill_blank code. */
export const BLANK = "____";

const prompt = z.string().min(5).max(800);
const code = z.string().min(1).max(4000);
const options = z.array(z.string().min(1).max(300)).min(2).max(6);

export const publicQuestionSchema = z.discriminatedUnion("type", [
  z.object({ id: QUESTION_ID, type: z.literal("single_choice"), prompt, code: code.optional(), options }).strict(),
  z.object({ id: QUESTION_ID, type: z.literal("multi_choice"), prompt, code: code.optional(), options }).strict(),
  z.object({ id: QUESTION_ID, type: z.literal("true_false"), prompt, code: code.optional() }).strict(),
  /** `code` is a complete program with `public class Main`; the gate runs it to verify the answer. */
  z.object({ id: QUESTION_ID, type: z.literal("predict_output"), prompt, code }).strict(),
  z.object({ id: QUESTION_ID, type: z.literal("big_o"), prompt, code: code.optional(), ask: z.enum(["time", "space"]), options: options.optional() }).strict(),
  /** Pattern Hunter (spec §10): approaches to a problem statement, graded optimal/valid/incorrect. */
  z.object({ id: QUESTION_ID, type: z.literal("pattern"), prompt, options }).strict(),
  /** Steps shown in this (authored, shuffled) order; the learner reorders them. */
  z.object({ id: QUESTION_ID, type: z.literal("order"), prompt, steps: z.array(z.string().min(1).max(300)).min(3).max(8) }).strict(),
  z.object({ id: QUESTION_ID, type: z.literal("fill_blank"), prompt, code }).strict(),
]);

export type PublicQuestion = z.infer<typeof publicQuestionSchema>;
export type QuestionType = PublicQuestion["type"];

export const approachGradeSchema = z.enum(["optimal", "valid", "incorrect"]);

const answerBase = {
  /** Shown after the learner answers. */
  why: z.string().min(10).max(800),
  skill: contentIdSchema,
  dimension: skillDimensionSchema,
};

export const privateAnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("single_choice"), answer: z.number().int().min(0), ...answerBase }).strict(),
  z.object({ type: z.literal("multi_choice"), answer: z.array(z.number().int().min(0)).min(1), ...answerBase }).strict(),
  z.object({ type: z.literal("true_false"), answer: z.boolean(), ...answerBase }).strict(),
  z.object({ type: z.literal("predict_output"), answer: z.string().max(4000), ...answerBase }).strict(),
  z.object({ type: z.literal("big_o"), answer: z.string().min(1).max(40), ...answerBase }).strict(),
  z.object({ type: z.literal("pattern"), grades: z.array(approachGradeSchema).min(2).max(6), ...answerBase }).strict(),
  /** answer[i] = index (into the shown steps) of the i-th step in the correct order. */
  z.object({ type: z.literal("order"), answer: z.array(z.number().int().min(0)).min(3).max(8), ...answerBase }).strict(),
  /** Accepted answers per blank, in order. */
  z.object({ type: z.literal("fill_blank"), answer: z.array(z.array(z.string().min(1).max(200)).min(1)).min(1), ...answerBase }).strict(),
]);

export type PrivateAnswer = z.infer<typeof privateAnswerSchema>;

export const exerciseSetManifestSchema = z
  .object({
    kind: z.literal("exercise-set"),
    id: contentIdSchema,
    version: z.number().int().min(1),
    title: z.string().min(3).max(120),
    summary: z.string().min(10).max(400),
    /** World (spec §2) and position within it. */
    world: z.object({ id: contentIdSchema, order: z.number().int().min(1) }).strict(),
    estimatedMinutes: z.number().int().min(1).max(30),
    questions: z.array(publicQuestionSchema).min(1).max(20),
    review: reviewSchema,
    provenance: provenanceSchema,
  })
  .strict();

export type ExerciseSetManifest = z.infer<typeof exerciseSetManifestSchema>;

export const exerciseSetPrivateSchema = z.object({ answers: z.record(QUESTION_ID, privateAnswerSchema) }).strict();

export type ExerciseSetPrivate = z.infer<typeof exerciseSetPrivateSchema>;

/** What learners receive: the manifest minus review/provenance bookkeeping. */
export const exerciseSetPayloadSchema = z.object({
  kind: z.literal("exercise-set"),
  title: z.string(),
  summary: z.string(),
  world: z.object({ id: z.string(), order: z.number().int() }),
  estimatedMinutes: z.number().int(),
  questions: z.array(publicQuestionSchema),
});

export type ExerciseSetPayload = z.infer<typeof exerciseSetPayloadSchema>;
