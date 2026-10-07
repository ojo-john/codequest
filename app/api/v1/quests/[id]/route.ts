import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/lib/server/http";
import { learningService } from "@/lib/server/container";

/** GET /api/v1/quests/:contentVersionId — the public quest (instructions, starter, visible-sample ids). */
export async function GET(_request: NextRequest, context: RouteContext<"/api/v1/quests/[id]">) {
  return handleApi("quests.get", async ({ user }) => {
    const id = z.uuid().parse((await context.params).id);
    return learningService().getQuest(user.userId, id);
  });
}
