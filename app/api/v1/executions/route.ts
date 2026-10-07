import type { NextRequest } from "next/server";
import { handleApi, readJson } from "@/lib/server/http";
import { learningService } from "@/lib/server/container";
import { executeRequestSchema } from "@/lib/server/learning-service";

// Enough for the 60 s sandbox lifetime plus admission and recording (spec §67).
export const maxDuration = 90;

/** POST /api/v1/executions — Run (visible samples) or Submit (all hidden cases) code for a quest. */
export async function POST(request: NextRequest) {
  return handleApi("executions.create", async ({ user, requestId, log }) => {
    const body = executeRequestSchema.parse(await readJson(request));
    return learningService().execute(user.userId, body, requestId, log, request.signal);
  });
}
