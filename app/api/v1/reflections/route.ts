import type { NextRequest } from "next/server";
import { journalService } from "@/lib/server/container";
import { handleApi, readJson } from "@/lib/server/http";
import { saveReflectionSchema } from "@/lib/server/journal-service";

/** POST /api/v1/reflections — the reflection card for a graded submission (idempotent per submission). */
export async function POST(request: NextRequest) {
  return handleApi("reflections.save", async ({ user }) => journalService().saveReflection(user.userId, saveReflectionSchema.parse(await readJson(request))));
}
