import { z } from "zod";
import { contentIdSchema, questStageSchema, skillDimensionSchema } from "./schema";

/**
 * The public payload stored in content_versions for a quest. Written by content:sync
 * (lib/content/sync.ts) and read by the server (lib/server/learning-store.ts); one schema keeps
 * both sides in agreement.
 */
export const questPayloadSchema = z.object({
  title: z.string(),
  summary: z.string(),
  campaign: z.object({ id: contentIdSchema, order: z.number().int() }),
  stage: questStageSchema,
  estimatedMinutes: z.number().int(),
  skills: z.array(z.object({ skill: contentIdSchema, dimension: skillDimensionSchema })),
  instructions: z.string(),
  starter: z.array(z.object({ path: z.string(), content: z.string() })),
  starterCompiles: z.boolean(),
});

export type QuestPayload = z.infer<typeof questPayloadSchema>;
