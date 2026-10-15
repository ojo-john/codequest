import type { NextRequest } from "next/server";
import { mockService } from "@/lib/server/container";
import { handleApi, readJson } from "@/lib/server/http";
import { startMockSchema } from "@/lib/server/mock-service";

/** GET /api/v1/mocks — the running mock (if any) and recent results. */
export async function GET() {
  return handleApi("mocks.list", async ({ user }) => mockService().recent(user.userId));
}

/** POST /api/v1/mocks — start a coding mock on an unseen problem (idempotent per requestKey). */
export async function POST(request: NextRequest) {
  return handleApi("mocks.start", async ({ user }) => {
    const body = startMockSchema.parse(await readJson(request));
    return mockService().start(user.userId, body);
  });
}
