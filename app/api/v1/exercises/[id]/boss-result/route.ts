import type { NextRequest } from "next/server";
import { z } from "zod";
import { exerciseService } from "@/lib/server/container";
import { handleApi } from "@/lib/server/http";

/** GET /api/v1/exercises/:contentVersionId/boss-result?since=ISO — a mastery exam's result for one sitting. */
export async function GET(request: NextRequest, context: RouteContext<"/api/v1/exercises/[id]/boss-result">) {
  return handleApi("exercises.boss_result", async ({ user }) => {
    const id = z.uuid().parse((await context.params).id);
    const since = z.iso.datetime({ offset: true }).parse(request.nextUrl.searchParams.get("since"));
    return exerciseService().bossResult(user.userId, id, new Date(since));
  });
}
