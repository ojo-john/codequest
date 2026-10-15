import type { NextRequest } from "next/server";
import { engagementService } from "@/lib/server/container";
import { timeZoneSchema } from "@/lib/server/engagement-service";
import { handleApi, readJson } from "@/lib/server/http";

/** PUT /api/v1/engagement/timezone — the zone streak days are counted in. */
export async function PUT(request: NextRequest) {
  return handleApi("engagement.timezone", async ({ user }) => engagementService().setTimeZone(user.userId, timeZoneSchema.parse(await readJson(request)).timeZone));
}
