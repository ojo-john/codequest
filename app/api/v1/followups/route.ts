import type { NextRequest } from "next/server";
import { learningService } from "@/lib/server/container";
import { handleApi, readJson } from "@/lib/server/http";
import { answerFollowUpsSchema } from "@/lib/server/learning-service";

/** POST /api/v1/followups — answer a passed submission's follow-up questions (first answers count). */
export async function POST(request: NextRequest) {
  return handleApi("followups.answer", async ({ user }) => learningService().answerFollowUps(user.userId, answerFollowUpsSchema.parse(await readJson(request))));
}
