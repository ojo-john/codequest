import type { NextRequest } from "next/server";
import { z } from "zod";
import { mockService } from "@/lib/server/container";
import { handleApi, readJson } from "@/lib/server/http";

/** PUT /api/v1/mocks/:id/plan — save the interview workflow notes while the mock runs. */
export async function PUT(request: NextRequest, context: RouteContext<"/api/v1/mocks/[id]/plan">) {
  return handleApi("mocks.plan", async ({ user }) => {
    const id = z.uuid().parse((await context.params).id);
    return mockService().savePlan(user.userId, id, await readJson(request));
  });
}
