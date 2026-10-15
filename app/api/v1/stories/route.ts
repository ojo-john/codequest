import type { NextRequest } from "next/server";
import { storyService } from "@/lib/server/container";
import { handleApi, readJson } from "@/lib/server/http";

/** GET /api/v1/stories — the learner's stories, competency coverage and the question bank. */
export async function GET() {
  return handleApi("stories.list", async ({ user }) => storyService().overview(user.userId));
}

/** POST /api/v1/stories — add a story. */
export async function POST(request: NextRequest) {
  return handleApi("stories.create", async ({ user }) => storyService().create(user.userId, await readJson(request)));
}
