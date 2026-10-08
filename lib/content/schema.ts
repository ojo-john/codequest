import { z } from "zod";
import { contractDefinitionSchema } from "@/lib/execution/contract";

/**
 * Curriculum content schemas (spec §42–45, §62, §69, §71). Content is versioned data in the
 * repository: `content/public/<id>/` may be shown to learners; `content/private/<id>/` (reference
 * solutions, hidden contract expectations, curated hints) never leaves the server.
 */

export const CONTENT_ID = /^[a-z0-9]+(\.[a-z0-9-]+)*$/;
export const contentIdSchema = z.string().regex(CONTENT_ID).max(120);

export const skillDimensionSchema = z.enum([
  "concept", "recognition", "implementation", "complexity", "explanation", "testing", "communication", "design",
]);

export const skillsFileSchema = z
  .object({
    skills: z
      .array(
        z.object({
          id: contentIdSchema,
          category: z.string().min(1),
          name: z.string().min(1),
          definition: z.string().min(10),
          difficulty: z.number().int().min(1).max(6),
          prerequisites: z
            .array(z.object({ skill: contentIdSchema, kind: z.enum(["strict", "recommended"]) }).strict())
            .default([]),
        }).strict(),
      )
      .min(1),
  })
  .strict();

export type SkillsFile = z.infer<typeof skillsFileSchema>;

/**
 * Review status must be truthful (spec §45, §71): anything at or past human review names a human
 * reviewer and a date. Agent or automated review can never be recorded as human review.
 */
export const reviewSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("draft") }).strict(),
  z.object({ status: z.literal("ai_reviewed"), notes: z.string().optional() }).strict(),
  z.object({ status: z.literal("human_reviewed"), reviewer: z.string().min(1), reviewedAt: z.iso.date() }).strict(),
  z.object({ status: z.literal("published"), reviewer: z.string().min(1), reviewedAt: z.iso.date() }).strict(),
  z.object({ status: z.literal("deprecated"), reviewer: z.string().min(1), reviewedAt: z.iso.date() }).strict(),
]);

export const provenanceSchema = z
  .object({
    author: z.string().min(1),
    license: z.string().min(1),
    /** "original" for content written for CodeQuest; otherwise where it came from. */
    source: z.string().min(1),
  })
  .strict();

/** The scaffold-removal ladder every essential Java objective goes through (spec §69). */
export const questStageSchema = z.enum([
  "worked_example", "completion", "guided", "independent", "change_request", "delayed_transfer",
]);

export const questManifestSchema = z
  .object({
    kind: z.literal("quest"),
    id: contentIdSchema,
    version: z.number().int().min(1),
    title: z.string().min(3).max(120),
    summary: z.string().min(10).max(400),
    campaign: z.object({ id: contentIdSchema, order: z.number().int().min(1) }).strict(),
    stage: questStageSchema,
    estimatedMinutes: z.number().int().min(1).max(90),
    skills: z.array(z.object({ skill: contentIdSchema, dimension: skillDimensionSchema }).strict()).min(1),
    /** Markdown file in the item directory. */
    instructions: z.string().regex(/^[a-z0-9-]+\.md$/),
    /** Directory (relative to the item) holding the starter Java sources the learner edits. */
    starterDir: z.literal("starter"),
    /** Whether the untouched starter compiles (a completion task may intentionally not). */
    starterCompiles: z.boolean(),
    review: reviewSchema,
    provenance: provenanceSchema,
  })
  .strict();

export type QuestManifest = z.infer<typeof questManifestSchema>;

export const MAX_FOLLOW_UPS = 5;
export const MAX_FOLLOW_UP_OPTIONS = 5;
/** Rubric criteria a follow-up question can assess. */
export const followUpCriterionSchema = z.enum(["explanation", "time_complexity", "space_complexity", "algorithm_choice"]);

/** Each mutant costs a compile and a test run inside the submission's sandbox lifetime. */
export const MAX_MUTANTS = 6;
const CONTENT_ID_SEGMENT = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);

export const hintTierSchema = z.enum(["direction", "pattern", "key_insight", "pseudocode", "solution"]);

export const questPrivateSchema = z
  .object({
    contract: contractDefinitionSchema,
    /** Progressive, curated hints (spec §15, §16): served one tier at a time by the server. */
    hints: z.array(z.object({ tier: hintTierSchema, text: z.string().min(5) }).strict()).min(1),
    referenceDir: z.literal("reference"),
    /** Rubric inputs beyond correctness (spec §14): edge-case checks and follow-up questions. */
    rubric: z
      .object({
        /** Hidden contract case ids that exercise edge cases (scored as the edge-cases criterion). */
        edgeCases: z.array(z.string().min(1)).max(200).default([]),
        /** Objective questions asked after a pass, graded against `answer` (spec §43, §46). */
        followUps: z
          .array(
            z
              .object({
                id: CONTENT_ID_SEGMENT,
                criterion: followUpCriterionSchema,
                skill: contentIdSchema,
                prompt: z.string().min(10).max(400),
                options: z.array(z.string().min(1).max(300)).min(2).max(MAX_FOLLOW_UP_OPTIONS),
                answer: z.number().int().min(0),
                why: z.string().min(10).max(600),
              })
              .strict(),
          )
          .max(MAX_FOLLOW_UPS)
          .default([]),
      })
      .strict()
      .optional(),
    /** Grading the learner's own tests against the reference and buggy variants (spec §19). */
    testQuality: z
      .object({
        /** Project path of the file the variants replace. */
        target: z.string().regex(/^src\/main\/java\/.+\.java$/),
        passRatio: z.number().gt(0).lte(1),
        /** JUnit tests that pass on the reference and catch every mutant (checked by the gate). */
        referenceTestsDir: z.literal("reference-tests"),
        mutants: z
          .array(z.object({ id: CONTENT_ID_SEGMENT, description: z.string().min(5).max(120), file: z.string().regex(/^mutants\/[a-z0-9-]+\.java$/) }).strict())
          .min(1)
          .max(MAX_MUTANTS),
      })
      .strict()
      .optional(),
  })
  .strict();

export type QuestPrivate = z.infer<typeof questPrivateSchema>;
