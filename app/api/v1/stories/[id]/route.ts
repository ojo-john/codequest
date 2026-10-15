import type { NextRequest } from "next/server";
import { z } from "zod";
import { storyService } from "@/lib/server/container";
import { handleApi, readJson } from "@/lib/server/http";

type Context = RouteContext<"/api/v1/stories/[id]">;
const storyId = async (context: Context) => z.uuid().parse((await context.params).id);

/** GET /api/v1/stories/:id — one story with its structure checks. */
export async function GET(_request: NextRequest, context: Context) {
  return handleApi("stories.get", async ({ user }) => storyService().get(user.userId, await storyId(context)));
}

/** PUT /api/v1/stories/:id — replace a story's text and tags (last write wins). */
export async function PUT(request: NextRequest, context: Context) {
  return handleApi("stories.update", async ({ user }) => storyService().update(user.userId, await storyId(context), await readJson(request)));
}

/** DELETE /api/v1/stories/:id */
export async function DELETE(_request: NextRequest, context: Context) {
  return handleApi("stories.delete", async ({ user }) => storyService().remove(user.userId, await storyId(context)));
}
