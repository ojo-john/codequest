import type { NextRequest } from "next/server";
import { z } from "zod";
import { mockService } from "@/lib/server/container";
import { handleApi } from "@/lib/server/http";

/** POST /api/v1/mocks/:id/finish — end the mock and score it (idempotent). */
export async function POST(_request: NextRequest, context: RouteContext<"/api/v1/mocks/[id]/finish">) {
  return handleApi("mocks.finish", async ({ user }) => mockService().finish(user.userId, z.uuid().parse((await context.params).id)));
}
