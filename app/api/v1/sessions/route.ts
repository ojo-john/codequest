import type { NextRequest } from "next/server";
import { handleApi, readJson } from "@/lib/server/http";
import { learningService } from "@/lib/server/container";
import { createSessionSchema } from "@/lib/server/learning-service";

/** POST /api/v1/sessions — plan a session for a time budget (idempotent per clientRequestKey). */
export async function POST(request: NextRequest) {
  return handleApi("sessions.create", async ({ user }) => {
    const body = createSessionSchema.parse(await readJson(request));
    return learningService().createSession(user.userId, body);
  });
}
