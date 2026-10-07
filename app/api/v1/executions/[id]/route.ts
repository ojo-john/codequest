import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/lib/server/http";
import { learningService } from "@/lib/server/container";

/** GET /api/v1/executions/:id — a run's state and result (survives reloads). */
export async function GET(_request: NextRequest, context: RouteContext<"/api/v1/executions/[id]">) {
  return handleApi("executions.get", async ({ user }) => {
    const id = z.uuid().parse((await context.params).id);
    return learningService().getJob(user.userId, id);
  });
}
