import type { NextRequest } from "next/server";
import { z } from "zod";
import { mockService } from "@/lib/server/container";
import { handleApi } from "@/lib/server/http";

/** GET /api/v1/mocks/:id — one mock; an expired one is scored on read. */
export async function GET(_request: NextRequest, context: RouteContext<"/api/v1/mocks/[id]">) {
  return handleApi("mocks.get", async ({ user }) => mockService().get(user.userId, z.uuid().parse((await context.params).id)));
}
