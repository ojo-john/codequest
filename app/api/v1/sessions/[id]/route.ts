import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, handleApi } from "@/lib/server/http";
import { learningService } from "@/lib/server/container";

/** GET /api/v1/sessions/:id — resume an owned session. */
export async function GET(_request: NextRequest, context: RouteContext<"/api/v1/sessions/[id]">) {
  return handleApi("sessions.get", async ({ user }) => {
    const id = z.uuid().parse((await context.params).id);
    const session = await learningService().getSession(user.userId, id);
    if (session === undefined) throw new ApiError(404, "not_found", "No such session.");
    return session;
  });
}
