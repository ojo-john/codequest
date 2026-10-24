import type { NextRequest } from "next/server";
import { engagementService } from "@/lib/server/container";
import { handleApi, readJson } from "@/lib/server/http";

/** PUT /api/v1/engagement/notifications — reminder level, consent and quiet hours. */
export async function PUT(request: NextRequest) {
  return handleApi("engagement.notifications", async ({ user }) => engagementService().saveNotificationPrefs(user.userId, await readJson(request)));
}
