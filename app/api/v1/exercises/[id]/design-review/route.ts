import type { NextRequest } from "next/server";
import { z } from "zod";
import { exerciseService } from "@/lib/server/container";
import { handleApi } from "@/lib/server/http";

/** GET /api/v1/exercises/:contentVersionId/design-review?since=ISO — key considerations, once the probes are answered. */
export async function GET(request: NextRequest, context: RouteContext<"/api/v1/exercises/[id]/design-review">) {
  return handleApi("exercises.design_review", async ({ user }) => {
    const id = z.uuid().parse((await context.params).id);
    const since = z.iso.datetime({ offset: true }).parse(request.nextUrl.searchParams.get("since"));
    return exerciseService().designReview(user.userId, id, new Date(since));
  });
}
