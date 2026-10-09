import type { NextRequest } from "next/server";
import { exerciseService } from "@/lib/server/container";
import { answerExerciseSchema } from "@/lib/server/exercise-service";
import { handleApi, readJson } from "@/lib/server/http";

/** POST /api/v1/exercises/answers — grade one exercise question (idempotent per requestKey). */
export async function POST(request: NextRequest) {
  return handleApi("exercises.answer", async ({ user }) => exerciseService().answer(user.userId, answerExerciseSchema.parse(await readJson(request))));
}
