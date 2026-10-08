import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/lib/server/http";
import { learningService } from "@/lib/server/container";

/** POST /api/v1/quests/:contentVersionId/hints — reveal the next curated hint tier. */
export async function POST(_request: NextRequest, context: RouteContext<"/api/v1/quests/[id]/hints">) {
  return handleApi("hints.next", async ({ user }) => {
    const id = z.uuid().parse((await context.params).id);
    return learningService().nextHint(user.userId, id);
  });
}
