import { z } from "zod";
import { CONTENT_ID, contentIdSchema, skillDimensionSchema } from "@/lib/content/schema";

/**
 * The CodeQuest archive, format version 1 (spec §47, §61, §63, §68): a learner's progress and
 * projects as one JSON document. Field names mirror the database columns that
 * export_user_data() produces; content is referenced by (content_id, version) so an archive can
 * be restored into a different database that synced the same content.
 *
 * Every row is validated here, at the import boundary, so the database only ever receives
 * well-formed values. Bounds keep a hostile or corrupt file from exhausting memory.
 */

export const ARCHIVE_FORMAT = "codequest.archive";
export const ARCHIVE_VERSION = 1;

/** Row caps per table: generous for one learner over years, small enough to bound an import. */
export const ARCHIVE_ROW_LIMITS = {
  sessions: 20_000,
  sessionItems: 100_000,
  attempts: 20_000,
  masteryEvidence: 100_000,
  skillStates: 5_000,
  recommendations: 20_000,
  xpEvents: 50_000,
  achievements: 1_000,
  hintRequests: 50_000,
  projects: 500,
  projectFiles: 10_000,
  projectCheckpoints: 10_000,
  notes: 10_000,
  reflections: 20_000,
  recommendationFeedback: 20_000,
  followUpAnswers: 100_000,
} as const;

const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const shortText = (max: number) => z.string().min(1).max(max);
const jsonObject = z.record(z.string(), z.unknown());
const contentRef = { content_id: contentIdSchema, content_version: z.number().int().min(1) };

const sessionSchema = z.object({
  id: uuid,
  budget_minutes: z.union([z.literal(5), z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(90)]),
  state: z.enum(["active", "completed", "abandoned"]),
  client_request_key: z.string().min(8).max(100),
  policy_version: shortText(100),
  started_at: timestamp,
  completed_at: timestamp.nullable(),
}).strict().refine((s) => (s.state === "completed") === (s.completed_at !== null), "completed_at must be set exactly when completed");

const sessionItemSchema = z.object({
  id: uuid,
  session_id: uuid,
  ...contentRef,
  ordinal: z.number().int().min(0).max(1000),
  state: z.enum(["pending", "in_progress", "completed", "skipped"]),
  estimated_minutes: z.number().int().min(1).max(90),
}).strict();

const attemptSchema = z.object({
  id: uuid,
  session_item_id: uuid.nullable(),
  ...contentRef,
  response: jsonObject,
  hint_level: z.number().int().min(0).max(5),
  active_seconds: z.number().int().min(0).max(2_147_483_647),
  state: z.enum(["submitted", "graded", "infrastructure_error"]),
  outcome: z.string().max(100).nullable(),
  rubric_version: z.string().max(100).nullable(),
  created_at: timestamp,
  graded_at: timestamp.nullable(),
}).strict().refine((a) => (a.state === "graded") === (a.graded_at !== null), "graded_at must be set exactly when graded");

const evidenceSchema = z.object({
  id: uuid,
  attempt_id: uuid,
  skill_id: contentIdSchema,
  dimension: skillDimensionSchema,
  outcome: z.enum(["pass", "partial", "fail"]),
  independence: z.enum(["independent", "hinted", "solution_revealed", "accessibility_supported"]),
  model_version: shortText(100),
  created_at: timestamp,
}).strict();

const skillStateSchema = z.object({
  skill_id: contentIdSchema,
  dimension: skillDimensionSchema,
  estimate: z.number().min(0).max(1),
  evidence_count: z.number().int().min(0),
  review_due_at: timestamp.nullable(),
  scheduler_version: shortText(100),
  model_version: shortText(100),
  updated_at: timestamp,
}).strict();

const recommendationSchema = z.object({
  id: uuid,
  session_id: uuid.nullable(),
  reason_codes: z.array(shortText(100)).min(1).max(50),
  evidence_ids: z.array(uuid).max(500),
  policy_version: shortText(100),
  created_at: timestamp,
}).strict();

const xpEventSchema = z.object({
  event_key: shortText(200),
  delta: z.number().int().min(0).max(1000),
  created_at: timestamp,
}).strict();

const achievementSchema = z.object({ achievement_id: shortText(100), awarded_at: timestamp }).strict();

const hintRequestSchema = z.object({ ...contentRef, tier: z.number().int().min(1).max(5), requested_at: timestamp }).strict();

const projectSchema = z.object({
  id: uuid,
  content_id: contentIdSchema.nullable(),
  campaign_id: z.string().regex(CONTENT_ID).max(120).nullable(),
  title: shortText(120),
  created_at: timestamp,
  updated_at: timestamp,
}).strict();

/** Path and size rules are re-checked per project with validateSourceFiles (archive-service). */
const projectFileSchema = z.object({
  project_id: uuid,
  path: shortText(200),
  revision: z.number().int().min(1),
  source: z.string(),
  updated_at: timestamp,
}).strict();

const checkpointSchema = z.object({
  id: uuid,
  project_id: uuid,
  files: z.record(z.string().max(200), z.string()),
  label: z.string().max(120).nullable(),
  created_at: timestamp,
}).strict();

const noteSchema = z.object({
  id: uuid,
  content_id: contentIdSchema,
  body: shortText(20_000),
  created_at: timestamp,
  updated_at: timestamp,
}).strict();

const reflectionSchema = z.object({ id: uuid, attempt_id: uuid, body: jsonObject, created_at: timestamp }).strict();

const feedbackSchema = z.object({
  id: uuid,
  recommendation_id: uuid,
  feedback: z.enum(["accepted", "dismissed", "corrected"]),
  note: z.string().max(2000).nullable(),
  created_at: timestamp,
}).strict();

const followUpAnswerSchema = z.object({
  id: uuid,
  attempt_id: uuid,
  followup_id: shortText(60),
  choice: z.number().int().min(0).max(9),
  correct: z.boolean(),
  created_at: timestamp,
}).strict();

const L = ARCHIVE_ROW_LIMITS;

export const archiveDataSchema = z.object({
  profile: z.object({
    timezone: shortText(100),
    target_role: z.string().max(100).nullable(),
    settings: jsonObject,
  }).strict().nullable(),
  sessions: z.array(sessionSchema).max(L.sessions),
  session_items: z.array(sessionItemSchema).max(L.sessionItems),
  attempts: z.array(attemptSchema).max(L.attempts),
  mastery_evidence: z.array(evidenceSchema).max(L.masteryEvidence),
  skill_states: z.array(skillStateSchema).max(L.skillStates),
  recommendations: z.array(recommendationSchema).max(L.recommendations),
  xp_events: z.array(xpEventSchema).max(L.xpEvents),
  achievements: z.array(achievementSchema).max(L.achievements),
  hint_requests: z.array(hintRequestSchema).max(L.hintRequests),
  projects: z.array(projectSchema).max(L.projects),
  project_files: z.array(projectFileSchema).max(L.projectFiles),
  project_checkpoints: z.array(checkpointSchema).max(L.projectCheckpoints),
  notes: z.array(noteSchema).max(L.notes),
  reflections: z.array(reflectionSchema).max(L.reflections),
  recommendation_feedback: z.array(feedbackSchema).max(L.recommendationFeedback),
  // Added with rubric-v1. Optional with no default: filling it in would change the canonical
  // JSON of older archives and invalidate their signatures.
  followup_answers: z.array(followUpAnswerSchema).max(L.followUpAnswers).optional(),
}).strict();

export type ArchiveData = z.infer<typeof archiveDataSchema>;

export const archiveSignatureSchema = z.object({
  alg: z.literal("HMAC-SHA256"),
  keyId: z.string().regex(/^[0-9a-f]{16}$/),
  value: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();

export type ArchiveSignature = z.infer<typeof archiveSignatureSchema>;

/** The signed part: everything except the signature itself. */
export const unsignedArchiveSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  version: z.literal(ARCHIVE_VERSION),
  exportedAt: timestamp,
  /** The exporting learner's id; used only to decide whether ids need remapping on import. */
  subject: uuid,
  data: archiveDataSchema,
}).strict();

export type UnsignedArchive = z.infer<typeof unsignedArchiveSchema>;

export const archiveSchema = unsignedArchiveSchema.extend({ signature: archiveSignatureSchema.nullable() }).strict();

export type Archive = z.infer<typeof archiveSchema>;

/** Only the envelope; used to report a wrong format or a newer version before full validation. */
export const archiveEnvelopeSchema = z.object({ format: z.string(), version: z.number() }).loose();
